import { Chess } from "chess.js";
import { gameIdOf, parseTags, splitPgns } from "@chessart/render";

const API = "https://lichess.org";

export interface BroadcastPlayer {
  name: string;
  title?: string;
  rating?: number;
  fed?: string;
}

export interface BroadcastGame {
  id: string;
  name: string;
  players?: [BroadcastPlayer, BroadcastPlayer];
  status?: string; // "*", "1-0", "0-1", "½-½"
}

export interface RoundInfo {
  round: { id: string; name: string; ongoing?: boolean; finished?: boolean; startsAt?: number; url: string };
  tour: { id: string; name: string; info?: { location?: string; tc?: string } };
  games: BroadcastGame[];
}

export interface TopBroadcast {
  tour: { id: string; name: string; info?: { location?: string; players?: string } };
  round: { id: string; name: string; ongoing?: boolean; finished?: boolean; startsAt?: number };
}

export type Target = { kind: "broadcast"; roundId: string; gameId?: string } | { kind: "game"; gameId: string };

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Lichess ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

export const fetchTopBroadcasts = () => getJson<{ active: TopBroadcast[] }>("/api/broadcast/top?page=1");
export const fetchRound = (roundId: string) => getJson<RoundInfo>(`/api/broadcast/-/-/${roundId}`);

// Accepts lichess.org/broadcast/<tour-slug>/<round-slug>/<roundId>[/<gameId>] or lichess.org/<gameId>.
export function parseLichessUrl(input: string): Target | null {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith("lichess.org")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const isId = (s: string | undefined) => !!s && /^[A-Za-z0-9]{8}$/.test(s);
  if (parts[0] === "broadcast") {
    if (!isId(parts[3])) return null;
    return { kind: "broadcast", roundId: parts[3]!, gameId: isId(parts[4]) ? parts[4] : undefined };
  }
  const id = parts[0]?.slice(0, 8);
  return isId(id) ? { kind: "game", gameId: id! } : null;
}

export type Status = "connecting" | "live" | "reconnecting" | "ended";

export interface LiveUpdate {
  pgn: string;
  clocks?: { w: number; b: number }; // seconds, when the source knows them outside the PGN
}

export interface LiveHandlers {
  onUpdate(update: LiveUpdate): void;
  onStatus(status: Status): void;
}

// Lichess asks clients to wait a full minute after a 429 before trying again.
class RateLimited extends Error {}
const RATE_LIMIT_WAIT = 65_000;

async function open(url: string, signal: AbortSignal, headers?: HeadersInit): Promise<Response> {
  const res = await fetch(url, { signal, headers });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) throw new Error(`Lichess ${res.status} for ${url}`);
  return res;
}

// Feeds decoded text to `onText` until the stream ends or `onText` returns true to stop.
async function readStream(res: Response, onText: (text: string) => boolean | void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    if (onText(decoder.decode(value, { stream: true }))) {
      await reader.cancel().catch(() => {});
      return;
    }
  }
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

// Keeps a stream open for as long as the viewer runs, reconnecting with backoff.
// `connect` resolves "stop" once the game is over and there is nothing left to watch.
async function keepAlive(
  connect: (signal: AbortSignal) => Promise<"again" | "stop">,
  onStatus: (s: Status) => void,
  signal: AbortSignal,
) {
  let backoff = 2000;
  onStatus("connecting");
  while (!signal.aborted) {
    const started = Date.now();
    const conn = new AbortController();
    const stop = () => conn.abort();
    signal.addEventListener("abort", stop, { once: true });
    let outcome: "again" | "stop" = "again";
    let rateLimited = false;
    try {
      outcome = await connect(conn.signal);
    } catch (e) {
      // Network drop or Lichess hiccup: reconnect below.
      rateLimited = e instanceof RateLimited;
    } finally {
      signal.removeEventListener("abort", stop);
    }
    if (signal.aborted) return;
    if (outcome === "stop") return onStatus("ended");
    if (Date.now() - started > 60_000) backoff = 2000;
    onStatus("reconnecting");
    await wait(rateLimited ? RATE_LIMIT_WAIT : backoff, signal);
    backoff = Math.min(backoff * 2, 30_000);
  }
}

// Broadcast round stream: Lichess sends every game's PGN on connect, then each game again
// whenever it changes. Games are separated by two blank lines.
export function watchBroadcast(roundId: string, gameId: string, handlers: LiveHandlers): () => void {
  const ctrl = new AbortController();

  keepAlive(
    async (signal) => {
      const res = await open(`${API}/api/stream/broadcast/round/${roundId}.pgn`, signal);
      let buffer = "";
      let finished = false;
      await readStream(res, (text) => {
        buffer += text;
        const cut = buffer.lastIndexOf("\n\n\n");
        if (cut < 0) return;
        const complete = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 3);
        for (const pgn of splitPgns(complete)) {
          const tags = parseTags(pgn);
          if (gameIdOf(tags) !== gameId) continue;
          handlers.onStatus("live");
          handlers.onUpdate({ pgn });
          finished = (tags.Result ?? "*") !== "*";
        }
        return finished; // the game is over: stop listening to the rest of the round
      });
      return finished ? "stop" : "again";
    },
    handlers.onStatus,
    ctrl.signal,
  );
  return () => ctrl.abort();
}

function tryMove(chess: Chess, uci: string): boolean {
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}

// Regular Lichess game: export the PGN, then apply moves from the position stream.
export function watchGame(gameId: string, handlers: LiveHandlers): () => void {
  const ctrl = new AbortController();
  let chess = new Chess();
  const board = (fen: string) => fen.split(" ")[0];

  const resync = async (signal: AbortSignal) => {
    const res = await open(`${API}/game/export/${gameId}?clocks=true&evals=false`, signal, {
      Accept: "application/x-chess-pgn",
    });
    const pgn = await res.text();
    chess = new Chess();
    chess.loadPgn(pgn);
    handlers.onUpdate({ pgn });
  };

  keepAlive(
    async (signal) => {
      await resync(signal);
      const res = await open(`${API}/api/stream/game/${gameId}`, signal);
      let buffer = "";
      let over = false;
      await readStream(res, (text) => {
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as {
            fen?: string;
            lm?: string;
            wc?: number;
            bc?: number;
            status?: { name: string };
          };
          handlers.onStatus("live");
          if (msg.status && !["created", "started"].includes(msg.status.name)) over = true;
          if (!msg.fen || board(msg.fen) === board(chess.fen())) continue;
          if (!msg.lm || !tryMove(chess, msg.lm) || board(chess.fen()) !== board(msg.fen)) {
            resync(signal).catch(() => {});
            continue;
          }
          const clocks = msg.wc !== undefined && msg.bc !== undefined ? { w: msg.wc, b: msg.bc } : undefined;
          handlers.onUpdate({ pgn: chess.pgn(), clocks });
        }
      });
      if (over) {
        await resync(signal).catch(() => {});
        return "stop";
      }
      return "again";
    },
    handlers.onStatus,
    ctrl.signal,
  );
  return () => ctrl.abort();
}
