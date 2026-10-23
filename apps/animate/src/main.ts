import "@fontsource/syne/400.css";
import "@fontsource/syne/500.css";
import "@fontsource/syne/600.css";
import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "./style.css";
import {
  buildScene,
  classicGames,
  drawScene,
  getPalette,
  getStyle,
  getTheme,
  palettes,
  parseGame,
  styles,
  themes,
  type ArtGame,
} from "@chessart/render";
import { FrameRenderer, type FrameSpec, type Logo } from "./compose";
import { download, encodeMp4, encodePngZip, writePngFolder, type ExportJob } from "./export";
import { SIZES, type Aspect } from "./layout";
import { durationOf, frameCount, perMoveFor, progressAt, type Timing } from "./timeline";

declare global {
  interface Window {
    showDirectoryPicker?(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The classic games as cards: display name and a one-line who/where/when.
const CLASSICS: Record<string, { name: string; meta: string }> = {
  "The Immortal Game": { name: "The Immortal Game", meta: "Anderssen v Kieseritzky · London, 1851" },
  "Evergreen Game": { name: "Evergreen Game", meta: "Anderssen v Dufresne · Berlin, 1852" },
  "The Opera Game": { name: "The Opera Game", meta: "Morphy v the Duke and Count · Paris, 1858" },
  "Game of The Century": { name: "Game of the Century", meta: "Byrne v Fischer · New York, 1956" },
};

const STYLE_BLURBS: Record<string, string> = {
  "classic-arcs": "The original ChessArt look",
  "brush-strokes": "Painted with intent",
  "pressed-flowers": "A flower for every piece",
};

const THEME_SWATCH: Record<string, string> = {
  dark: "#000000",
  light: "#ffffff",
  "dark-checkers": "repeating-conic-gradient(#000 0 25%, #333 0 50%) 0 0 / 10px 10px",
  paper: "#f3ede1",
  "light-checkers": "repeating-conic-gradient(#fff 0 25%, #e6e6e6 0 50%) 0 0 / 10px 10px",
};

const FORMATS: Array<{ aspect: Aspect; use: string; w: number; h: number }> = [
  { aspect: "9:16", use: "Reels · TikTok", w: 22, h: 40 },
  { aspect: "4:5", use: "Feed", w: 32, h: 40 },
  { aspect: "1:1", use: "Square", w: 38, h: 38 },
  { aspect: "16:9", use: "YouTube", w: 54, h: 30 },
];

const firstClassic = Object.keys(classicGames)[0]!;

const state = {
  game: parseGame(classicGames[firstClassic]!),
  classic: firstClassic as string | null, // which classic is loaded, if any
  source: "classic" as "classic" | "pgn" | "lichess",
  style: "classic-arcs",
  theme: "dark",
  palette: "classic",
  aspect: "9:16" as Aspect,
  fps: 30,
  length: 24, // target video length in seconds
  intro: 0.8,
  hold: 2.5,
  title: "",
  subtitle: "",
  showTitle: true,
  players: true,
  counter: true,
  logo: true,
  labels: false,
  artOnly: true,
};

const logos: { white?: Logo; black?: Logo } = {};
const canvas = $<HTMLCanvasElement>("preview");
const ctx = canvas.getContext("2d")!;
let renderer: FrameRenderer;
let time = 0;
let playing = false;
let lastTick = 0;

// --- timing --------------------------------------------------------------------

const moves = () => state.game.moves.length;
const perMove = () => perMoveFor(state.length, moves(), state);
const timing = (): Timing => ({ intro: state.intro, perMove: perMove(), hold: state.hold, fps: state.fps });
const duration = () => durationOf(moves(), timing());

// --- game & text ------------------------------------------------------------------

const known = (v?: string) => (v && !/^[?\-.]+$/.test(v) && !/^https?:/.test(v) ? v : undefined);

function defaultText(game: ArtGame, name?: string) {
  const t = game.tags;
  const event = known(t.Event);
  const generic = !event || /^(rated|casual)\b/i.test(event);
  const title = name ?? (generic ? `${t.White ?? "White"} vs ${t.Black ?? "Black"}` : event);
  const place = known(t.Site)?.split(",")[0]?.replace(/\s+[A-Z]{3}$/, "");
  const year = /^\d{4}/.exec(t.Date ?? "")?.[0];
  return { title, subtitle: [place, year].filter(Boolean).join(", ") };
}

function setGame(pgn: string, classic: string | null = null): boolean {
  let game: ArtGame;
  try {
    game = parseGame(pgn);
  } catch {
    showError("That doesn't look like a chess game. Check the PGN and try again.");
    return false;
  }
  if (game.moves.length === 0) {
    showError("No moves found in that PGN.");
    return false;
  }
  showError("");
  state.game = game;
  state.classic = classic;
  Object.assign(state, defaultText(game, classic ? CLASSICS[classic]?.name : undefined));
  input("title").value = state.title;
  input("subtitle").value = state.subtitle;
  time = 0;
  drawThumbnails();
  rebuild();
  return true;
}

function showError(message: string) {
  const el = $("error");
  el.hidden = !message;
  el.textContent = message;
}

// --- choice lists (rendered once; selection is kept in aria-pressed) ---------------------

$("source-classic").innerHTML = Object.entries(CLASSICS)
  .map(([key, c]) => `<button type="button" class="card" data-classic="${esc(key)}" aria-pressed="false"><span class="name">${esc(c.name)}</span><span class="meta">${esc(c.meta)}</span></button>`)
  .join("");

$("styles").innerHTML = styles
  .map((s) => `<button type="button" class="card" data-style="${s.id}" aria-pressed="false"><canvas width="240" height="240" aria-hidden="true"></canvas><span class="name">${esc(s.name)}</span><span class="meta">${esc(STYLE_BLURBS[s.id] ?? "")}</span></button>`)
  .join("");

$("themes").innerHTML = themes
  .map((t) => `<button type="button" class="chip" data-theme="${t.id}" aria-pressed="false"><span class="swatch" style="background:${THEME_SWATCH[t.id] ?? t.background}"></span>${esc(t.name)}</button>`)
  .join("");

$("palettes").innerHTML = palettes
  .map((p) => {
    const g = `linear-gradient(90deg, ${p.white[0]}, ${p.white[1]} 50%, ${p.capture[0]} 50%, ${p.capture[1]})`;
    return `<button type="button" class="chip" data-palette="${p.id}" aria-pressed="false"><span class="swatch pill" style="background:${g}"></span>${esc(p.name)}</button>`;
  })
  .join("");

$("formats").innerHTML = FORMATS.map(
  (f) => `<button type="button" class="card" data-aspect="${f.aspect}" aria-pressed="false"><span class="shape-box"><span class="shape" style="width:${f.w}px;height:${f.h}px"></span></span><span class="ratio">${f.aspect}</span><span class="meta">${esc(f.use)}</span></button>`,
).join("");

// Each style's thumbnail is the current game drawn in that style's own look.
function drawThumbnails() {
  document.querySelectorAll<HTMLButtonElement>("[data-style]").forEach((card) => {
    const style = getStyle(card.dataset.style);
    const c = card.querySelector("canvas")!;
    const size = Math.round(240 * Math.min(2, window.devicePixelRatio || 1));
    c.width = c.height = size;
    const scene = buildScene(state.game, { style: style.id, theme: style.defaults?.theme ?? "dark", palette: style.defaults?.palette ?? "classic" });
    drawScene(c.getContext("2d")!, scene, { rect: { x: 0, y: 0, size } });
  });
}

const press = (selector: string, attr: string, value: string | number | null) =>
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => el.setAttribute("aria-pressed", String(el.dataset[attr] === String(value))));

// --- events -------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>("[data-source]").forEach((tab) =>
  tab.addEventListener("click", () => {
    state.source = tab.dataset.source as typeof state.source;
    document.querySelectorAll<HTMLButtonElement>("[data-source]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
    for (const id of ["classic", "pgn", "lichess"]) $(`source-${id}`).hidden = id !== state.source;
    if (state.source === "pgn") $<HTMLTextAreaElement>("pgn").focus();
    if (state.source === "lichess") input("lichess").focus();
  }),
);

$("source-classic").addEventListener("click", (e) => {
  const key = (e.target as HTMLElement).closest<HTMLElement>("[data-classic]")?.dataset.classic;
  if (!key) return;
  $<HTMLTextAreaElement>("pgn").value = classicGames[key]!;
  setGame(classicGames[key]!, key);
});

let typing = 0;
$("pgn").addEventListener("input", (e) => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    const pgn = (e.target as HTMLTextAreaElement).value.trim();
    if (!pgn) return;
    setGame(pgn, Object.keys(classicGames).find((k) => classicGames[k]!.trim() === pgn) ?? null);
  }, 350);
});

$("import").addEventListener("click", async () => {
  const id = /lichess\.org\/([A-Za-z0-9]{8})/.exec(input("lichess").value)?.[1];
  if (!id) return showError("Paste a Lichess game link, like lichess.org/abcd1234.");
  try {
    const res = await fetch(`https://lichess.org/game/export/${id}?clocks=false&evals=false`, {
      headers: { Accept: "application/x-chess-pgn" },
    });
    if (res.status === 429) throw new Error("Lichess is rate-limiting requests. Wait a minute and try again.");
    if (!res.ok) throw new Error(`Lichess couldn't find that game (${res.status}).`);
    const pgn = await res.text();
    $<HTMLTextAreaElement>("pgn").value = pgn;
    setGame(pgn);
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

// A style switches to the theme and palette it was designed for; both stay changeable.
$("styles").addEventListener("click", (e) => {
  const style = getStyle((e.target as HTMLElement).closest<HTMLElement>("[data-style]")?.dataset.style);
  if (!(e.target as HTMLElement).closest("[data-style]")) return;
  state.style = style.id;
  if (style.defaults?.theme) state.theme = style.defaults.theme;
  if (style.defaults?.palette) state.palette = style.defaults.palette;
  rebuild();
});

const pick = (container: string, attr: "theme" | "palette" | "aspect") =>
  $(container).addEventListener("click", (e) => {
    const value = (e.target as HTMLElement).closest<HTMLElement>(`[data-${attr}]`)?.dataset[attr];
    if (!value) return;
    (state as Record<string, unknown>)[attr] = value;
    rebuild();
  });
pick("themes", "theme");
pick("palettes", "palette");
pick("formats", "aspect");

input("length").addEventListener("input", (e) => {
  state.length = Number((e.target as HTMLInputElement).value);
  rebuild();
});
document.querySelectorAll<HTMLButtonElement>("[data-length]").forEach((b) =>
  b.addEventListener("click", () => {
    state.length = Number(b.dataset.length);
    rebuild();
  }),
);
document.querySelectorAll<HTMLButtonElement>("[data-fps]").forEach((b) =>
  b.addEventListener("click", () => {
    state.fps = Number(b.dataset.fps);
    rebuild();
  }),
);

for (const id of ["title", "subtitle"] as const) {
  input(id).addEventListener("input", (e) => {
    state[id] = (e.target as HTMLInputElement).value;
    rebuild();
  });
}
for (const id of ["showTitle", "players", "counter", "logo", "labels", "artOnly"] as const) {
  input(id).checked = state[id];
  input(id).addEventListener("change", (e) => {
    state[id] = (e.target as HTMLInputElement).checked;
    rebuild();
  });
}

// --- render ----------------------------------------------------------------------------

function frameSpec(overrides: Partial<FrameSpec> = {}): FrameSpec {
  const theme = getTheme(state.theme);
  return {
    ...SIZES[state.aspect],
    game: state.game,
    scene: buildScene(state.game, state),
    transparent: false,
    artOnly: false,
    labels: state.labels,
    text: {
      title: state.showTitle ? state.title : "",
      subtitle: state.showTitle ? state.subtitle : "",
      players: state.players,
      counter: state.counter,
      logo: state.logo,
    },
    logo: theme.dark ? logos.white : logos.black,
    ...overrides,
  };
}

const fmtLength = (s: number) => `${Math.round(s)} seconds`;

// Any setting change: new renderer, refreshed controls and summaries, redraw.
function rebuild() {
  const spec = frameSpec();
  renderer = new FrameRenderer(spec);
  canvas.width = spec.width;
  canvas.height = spec.height;

  press("[data-classic]", "classic", state.classic);
  press("[data-style]", "style", state.style);
  press("[data-theme]", "theme", state.theme);
  press("[data-palette]", "palette", state.palette);
  press("[data-aspect]", "aspect", state.aspect);
  press("[data-length]", "length", state.length);
  press("[data-fps]", "fps", state.fps);

  const t = timing();
  const total = duration();
  const frames = frameCount(moves(), t);
  input("length").value = String(state.length);
  $("lengthOut").textContent = fmtLength(total);
  $("pacing").textContent = `${t.perMove.toFixed(2)}s per move · finished art holds for ${state.hold}s`;
  $("summary").textContent = `${frames} frames · ${spec.width} × ${spec.height} · ${state.fps} fps · about ${Math.round(total)} seconds. Made in your browser, nothing is uploaded. Works best in Chrome or Edge.`;

  const format = FORMATS.find((f) => f.aspect === state.aspect)!;
  $("gameChoice").textContent = state.title || "Your game";
  $("styleChoice").textContent = `${getStyle(state.style).name} · ${getTheme(state.theme).name} · ${getPalette(state.palette).name}`;
  $("formatChoice").textContent = `${format.aspect} ${format.use} · ${Math.round(total)}s`;
  $("downloadChoice").textContent = `MP4 · ${spec.width} × ${spec.height}`;

  const scrub = input("scrub");
  scrub.max = String(total);
  scrub.step = String(1 / state.fps);
  time = Math.min(time, total);
  draw();
}

const RESULT: Record<string, string> = { "1-0": "White wins 1–0", "0-1": "Black wins 0–1", "1/2-1/2": "Draw ½–½" };

function moveStatus(progress: number): string {
  const n = moves();
  if (progress <= 0) return `${n} moves · press play to watch it draw`;
  if (progress >= n) return [`${n} of ${n} moves`, RESULT[state.game.result]].filter(Boolean).join(" · ");
  const i = Math.ceil(progress);
  const m = state.game.moves[i - 1]!;
  return `Move ${Math.ceil(m.ply / 2)}${m.side === "w" ? "." : "…"} ${m.san} · ${i} of ${n}`;
}

function draw() {
  const progress = progressAt(time, moves(), timing());
  renderer.render(ctx, progress);
  input("scrub").value = String(time);
  $("time").textContent = `${time.toFixed(1)} / ${duration().toFixed(1)}s`;
  $("moveStatus").textContent = moveStatus(progress);
}

// --- preview playback ---------------------------------------------------------------------

function setPlaying(on: boolean) {
  playing = on;
  const button = $("play");
  button.classList.toggle("playing", on);
  button.setAttribute("aria-label", on ? "Pause" : "Play");
  if (on) {
    if (time >= duration()) time = 0;
    lastTick = performance.now();
    requestAnimationFrame(tick);
  }
}

function tick(now: number) {
  if (!playing) return;
  time = Math.min(duration(), time + (now - lastTick) / 1000);
  lastTick = now;
  draw();
  if (time >= duration()) setPlaying(false);
  else requestAnimationFrame(tick);
}

$("play").addEventListener("click", () => setPlaying(!playing));
input("scrub").addEventListener("input", (e) => {
  setPlaying(false);
  time = Number((e.target as HTMLInputElement).value);
  draw();
});
window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"].includes(tag)) return;
  e.preventDefault();
  setPlaying(!playing);
});

// --- export ---------------------------------------------------------------------------------

const slug = () =>
  (state.title || "chessart")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "chessart";

function job(spec: FrameSpec, onProgress: ExportJob["onProgress"], signal: AbortSignal): ExportJob {
  const r = new FrameRenderer(spec);
  const t = timing();
  const n = moves();
  return {
    width: spec.width,
    height: spec.height,
    fps: t.fps,
    frames: frameCount(n, t),
    renderFrame: (c, i) => r.render(c, progressAt(i / t.fps, n, t)),
    onProgress,
    signal,
  };
}

const makeMp4 = (onProgress?: ExportJob["onProgress"], signal = new AbortController().signal) =>
  encodeMp4(job(frameSpec(), onProgress, signal));

const pngSpec = () => frameSpec({ transparent: true, artOnly: state.artOnly });

const framesFolder = () => `${slug()}-${state.aspect.replace(":", "x")}-frames`;

const makePngZip = (onProgress?: ExportJob["onProgress"], signal = new AbortController().signal) =>
  encodePngZip(job(pngSpec(), onProgress, signal), framesFolder());

async function runExport(heading: string, work: (onProgress: ExportJob["onProgress"], signal: AbortSignal) => Promise<void>) {
  setPlaying(false);
  const ctrl = new AbortController();
  const started = performance.now();
  $("progressTitle").textContent = heading;
  $("progressSummary").textContent = [
    state.title || "Your game",
    getStyle(state.style).name,
    state.aspect,
    `${Math.round(duration())} seconds`,
  ].join(" · ");
  $("progressFill").style.width = "0%";
  $("progressFrames").textContent = "Preparing…";
  $("progressEta").textContent = "";
  $("cancel").onclick = () => ctrl.abort();
  $("progress").hidden = false;
  $("cancel").focus();
  try {
    await work((done, total) => {
      const pct = Math.round((done / total) * 100);
      $("progressFill").style.width = `${pct}%`;
      $("progressBar").setAttribute("aria-valuenow", String(pct));
      $("progressFrames").textContent = `Frame ${done} of ${total}`;
      const elapsed = (performance.now() - started) / 1000;
      const left = done > 0 ? (elapsed / done) * (total - done) : 0;
      $("progressEta").textContent = done > 0 && done < total ? `About ${Math.max(1, Math.round(left))} seconds left` : "";
    }, ctrl.signal);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) showError(e instanceof Error ? e.message : String(e));
  } finally {
    $("progress").hidden = true;
  }
}

const exportMp4 = () =>
  runExport("Making your video", async (onProgress, signal) => {
    const blob = await makeMp4(onProgress, signal);
    download(blob, `${slug()}-${state.aspect.replace(":", "x")}.mp4`);
  });

$("exportMp4").addEventListener("click", exportMp4);
$("exportMp4Mobile").addEventListener("click", exportMp4);

$("exportPng").addEventListener("click", async () => {
  // Ask for the folder first, while the click still counts as a user gesture.
  let dir: FileSystemDirectoryHandle | undefined;
  if (window.showDirectoryPicker) {
    try {
      const parent = await window.showDirectoryPicker({ mode: "readwrite" });
      dir = await parent.getDirectoryHandle(framesFolder(), { create: true });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      return showError(e instanceof Error ? e.message : String(e));
    }
  }
  runExport("Making your frames", async (onProgress, signal) => {
    if (dir) return writePngFolder(job(pngSpec(), onProgress, signal), dir);
    download(await makePngZip(onProgress, signal), `${framesFolder()}.zip`);
  });
});

// --- start ---------------------------------------------------------------------------------

// Phones start with only the first step open; the rest show their current choice.
if (window.matchMedia("(max-width: 860px)").matches) {
  document.querySelectorAll<HTMLDetailsElement>("details.step").forEach((d, i) => (d.open = i === 0));
} else {
  // On wide screens the steps are always open headings, not an accordion.
  document.querySelectorAll<HTMLElement>("details.step summary").forEach((s) =>
    s.addEventListener("click", (e) => {
      if (!window.matchMedia("(max-width: 860px)").matches) e.preventDefault();
    }),
  );
}

// onload rather than decode(): decode() can stall while the tab is in the background.
function loadLogo(src: string): Promise<Logo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ image: img, ratio: img.naturalWidth / img.naturalHeight });
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

// Scripting hook for testing exports without the download dialog (dev server only).
if (import.meta.env.DEV) Object.assign(window, { __animate: { makeMp4, makePngZip, state, rebuild } });

$<HTMLTextAreaElement>("pgn").value = classicGames[firstClassic]!;
Object.assign(state, defaultText(state.game, CLASSICS[firstClassic]?.name));
input("title").value = state.title;
input("subtitle").value = state.subtitle;
rebuild();
drawThumbnails();

// Redraw once the brand font and logos are in, so canvas text and logos use them.
Promise.allSettled([
  loadLogo(`${import.meta.env.BASE_URL}ChessArt_Logo_White.png`).then((l) => (logos.white = l)),
  loadLogo(`${import.meta.env.BASE_URL}ChessArt_Logo_Black.png`).then((l) => (logos.black = l)),
  ...["400", "500", "700"].map((w) => document.fonts.load(`${w} 40px Syne`)),
]).then(rebuild);
