import { Chess } from "chess.js";

export type Side = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type MoveKind = "normal" | "capture" | "castle";

export interface ArtMove {
  ply: number; // 1-based half-move number
  san: string;
  from: string;
  to: string;
  piece: PieceType;
  side: Side;
  kind: MoveKind;
  captured?: PieceType; // what was taken, for captures
  clock?: number; // seconds left on the mover's clock after the move, from [%clk]
}

export interface ArtGame {
  tags: Record<string, string>;
  moves: ArtMove[];
  result: string; // "1-0" | "0-1" | "1/2-1/2" | "*"
}

const TAG_RE = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;
const CLOCK_RE = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;

export function parseTags(pgn: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [, key, value] of pgn.matchAll(TAG_RE)) {
    tags[key!] = value!.replace(/\\(.)/g, "$1");
  }
  return tags;
}

export function parseClock(comment: string): number | undefined {
  const m = CLOCK_RE.exec(comment);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// Removes variations (nested parentheses) while leaving {comments} intact,
// since comments carry the [%clk] times we need.
export function stripVariations(pgn: string): string {
  let out = "";
  let depth = 0;
  let inComment = false;
  for (const ch of pgn) {
    if (inComment) {
      if (depth === 0) out += ch;
      if (ch === "}") inComment = false;
    } else if (ch === "{") {
      inComment = true;
      if (depth === 0) out += ch;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

// Lichess annotates finished games with several comments per move
// ("Be3?! { [%eval -0.15] } { Inaccuracy. } { [%clk 0:11:21] }"), which chess.js rejects.
export function mergeComments(pgn: string): string {
  return pgn.replace(/\}\s*\{/g, " ");
}

const stripComments = (pgn: string) => pgn.replace(/\{[^}]*\}/g, " ");

// Splits a multi-game PGN (e.g. a Lichess broadcast round or stream buffer) into single games.
export function splitPgns(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n(?=\[Event\s)/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

export function parseGame(pgn: string): ArtGame {
  const tags = parseTags(pgn);
  const chess = new Chess();
  const clean = mergeComments(stripVariations(pgn));
  try {
    chess.loadPgn(clean);
  } catch {
    // Last resort for odd annotations: the art only needs the moves, so drop comments
    // (and with them the clocks) rather than fail. Genuinely illegal games still throw.
    chess.loadPgn(stripComments(clean));
  }

  const comments = new Map(chess.getComments().map((c) => [c.fen, c.comment]));

  // Replay to get each position's FEN, which is how chess.js keys comments.
  const replay = tags.FEN ? new Chess(tags.FEN) : new Chess();
  const moves: ArtMove[] = chess.history({ verbose: true }).map((m, i) => {
    replay.move(m.san);
    const comment = comments.get(replay.fen());
    const castle = m.flags.includes("k") || m.flags.includes("q");
    return {
      ply: i + 1,
      san: m.san,
      from: m.from,
      to: m.to,
      piece: m.piece as PieceType,
      side: m.color as Side,
      kind: m.captured ? "capture" : castle ? "castle" : "normal",
      captured: m.captured as PieceType | undefined,
      clock: comment ? parseClock(comment) : undefined,
    };
  });

  return { tags, moves, result: resultOf(tags, chess, moves) };
}

function resultOf(tags: Record<string, string>, chess: Chess, moves: ArtMove[]): string {
  const tagged = tags.Result;
  if (tagged && tagged !== "*") return tagged;
  if (chess.isCheckmate()) return moves[moves.length - 1]?.side === "w" ? "1-0" : "0-1";
  if (chess.isDraw()) return "1/2-1/2";
  return "*";
}

// Lichess broadcast PGNs carry the game id at the end of GameURL / Site.
export function gameIdOf(tags: Record<string, string>): string | undefined {
  const url = tags.GameURL ?? tags.Site ?? "";
  const m = /\/([A-Za-z0-9]{8})\/?$/.exec(url);
  return m?.[1];
}
