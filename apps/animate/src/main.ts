import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/400-italic.css";
import "./style.css";
import { buildScene, classicGames, getStyle, getTheme, palettes, parseGame, styles, themes, type ArtGame } from "@chessart/render";
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

const firstClassic = Object.keys(classicGames)[0]!;

const state = {
  game: parseGame(classicGames[firstClassic]!),
  style: "classic-arcs",
  theme: "dark",
  palette: "classic",
  aspect: "9:16" as Aspect,
  fps: 30,
  intro: 0.8,
  perMove: 0.45,
  hold: 2.5,
  title: "",
  subtitle: "",
  players: true,
  counter: true,
  logo: true,
  labels: true,
  artOnly: true,
};

const logos: { white?: Logo; black?: Logo } = {};
const canvas = $<HTMLCanvasElement>("preview");
const ctx = canvas.getContext("2d")!;
let renderer: FrameRenderer;
let time = 0;
let playing = false;
let lastTick = 0;

// --- setup ------------------------------------------------------------------

const options = (el: HTMLSelectElement, items: readonly { id: string; name: string }[]) =>
  (el.innerHTML = items.map((i) => `<option value="${i.id}">${i.name}</option>`).join(""));

options($("style"), styles);
options($("theme"), themes);
options($("palette"), palettes);
options($("preset"), [
  ...Object.keys(classicGames).map((name) => ({ id: name, name })),
  { id: "", name: "Your own PGN…" },
]);

function loadLogo(src: string): Promise<Logo> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => ({ image: img, ratio: img.naturalWidth / img.naturalHeight }));
}

Promise.all([
  loadLogo(`${import.meta.env.BASE_URL}ChessArt_Logo_White.png`).then((l) => (logos.white = l)),
  loadLogo(`${import.meta.env.BASE_URL}ChessArt_Logo_Black.png`).then((l) => (logos.black = l)),
  ...["400", "500", "700", "italic 400"].map((w) => document.fonts.load(`${w} 40px Montserrat`)),
]).then(rebuild);

// --- game & text ------------------------------------------------------------

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

function setGame(pgn: string, name?: string): boolean {
  let game: ArtGame;
  try {
    game = parseGame(pgn);
    if (game.moves.length === 0) throw new Error("No moves found in that PGN.");
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
    return false;
  }
  showError("");
  state.game = game;
  Object.assign(state, defaultText(game, name));
  input("title").value = state.title;
  input("subtitle").value = state.subtitle;
  time = 0;
  rebuild();
  return true;
}

function showError(message: string) {
  const el = $("error");
  el.hidden = !message;
  el.textContent = message;
}

$("preset").addEventListener("change", (e) => {
  const name = (e.target as HTMLSelectElement).value;
  if (!name) return $<HTMLTextAreaElement>("pgn").focus();
  $<HTMLTextAreaElement>("pgn").value = classicGames[name]!;
  setGame(classicGames[name]!, name);
});

let typing = 0;
$("pgn").addEventListener("input", (e) => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    const pgn = (e.target as HTMLTextAreaElement).value.trim();
    if (!pgn) return;
    const preset = Object.keys(classicGames).find((k) => classicGames[k]!.trim() === pgn);
    $<HTMLSelectElement>("preset").value = preset ?? "";
    setGame(pgn, preset);
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
    $<HTMLSelectElement>("preset").value = "";
    setGame(pgn);
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});

// --- settings -----------------------------------------------------------------

for (const id of ["title", "subtitle"] as const) {
  input(id).addEventListener("input", (e) => {
    state[id] = (e.target as HTMLInputElement).value;
    rebuild();
  });
}
for (const id of ["players", "counter", "logo", "labels", "artOnly"] as const) {
  input(id).addEventListener("change", (e) => {
    state[id] = (e.target as HTMLInputElement).checked;
    rebuild();
  });
}
// A style switches to the theme and palette it was designed for; both stay changeable.
$("style").addEventListener("change", (e) => {
  const style = getStyle((e.target as HTMLSelectElement).value);
  state.style = style.id;
  if (style.defaults?.theme) state.theme = $<HTMLSelectElement>("theme").value = style.defaults.theme;
  if (style.defaults?.palette) state.palette = $<HTMLSelectElement>("palette").value = style.defaults.palette;
  rebuild();
});
for (const id of ["theme", "palette"] as const) {
  $(id).addEventListener("change", (e) => {
    state[id] = (e.target as HTMLSelectElement).value;
    rebuild();
  });
}
$("fps").addEventListener("change", (e) => {
  state.fps = Number((e.target as HTMLSelectElement).value);
  rebuild();
});
$("aspect").addEventListener("click", (e) => {
  const aspect = (e.target as HTMLElement).closest<HTMLElement>("[data-aspect]")?.dataset.aspect as Aspect | undefined;
  if (!aspect) return;
  state.aspect = aspect;
  rebuild();
});
input("perMove").addEventListener("input", (e) => {
  state.perMove = Number((e.target as HTMLInputElement).value);
  rebuild();
});
input("hold").addEventListener("change", (e) => {
  state.hold = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
  rebuild();
});
document.querySelectorAll<HTMLButtonElement>("[data-fit]").forEach((b) =>
  b.addEventListener("click", () => {
    state.perMove = Math.round(perMoveFor(Number(b.dataset.fit), state.game.moves.length, state) * 100) / 100;
    rebuild();
  }),
);

const timing = (): Timing => ({ intro: state.intro, perMove: state.perMove, hold: state.hold, fps: state.fps });
const duration = () => durationOf(state.game.moves.length, timing());

function frameSpec(overrides: Partial<FrameSpec> = {}): FrameSpec {
  const theme = getTheme(state.theme);
  return {
    ...SIZES[state.aspect],
    game: state.game,
    scene: buildScene(state.game, state),
    transparent: false,
    artOnly: false,
    labels: state.labels,
    text: { title: state.title, subtitle: state.subtitle, players: state.players, counter: state.counter, logo: state.logo },
    logo: theme.dark ? logos.white : logos.black,
    ...overrides,
  };
}

// Any setting change: new renderer, refreshed controls, redraw.
function rebuild() {
  const spec = frameSpec();
  renderer = new FrameRenderer(spec);
  canvas.width = spec.width;
  canvas.height = spec.height;
  document.querySelectorAll<HTMLElement>("[data-aspect]").forEach((b) =>
    b.setAttribute("aria-checked", String(b.dataset.aspect === state.aspect)),
  );
  input("perMove").value = String(state.perMove);
  $("perMoveOut").textContent = `${state.perMove.toFixed(2)}s`;
  const t = timing();
  const moves = state.game.moves.length;
  $("estimate").textContent = `${moves} moves · ${duration().toFixed(1)}s · ${frameCount(moves, t)} frames at ${spec.width}×${spec.height}`;
  const scrub = input("scrub");
  scrub.max = String(duration());
  scrub.step = String(1 / state.fps);
  time = Math.min(time, duration());
  draw();
}

// --- preview playback ------------------------------------------------------------

function draw() {
  renderer.render(ctx, progressAt(time, state.game.moves.length, timing()));
  input("scrub").value = String(time);
  $("time").textContent = `${time.toFixed(1)}s / ${duration().toFixed(1)}s`;
}

function setPlaying(on: boolean) {
  playing = on;
  $("play").textContent = on ? "Pause" : "Play";
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
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
  if (e.code !== "Space" || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)) return;
  e.preventDefault();
  setPlaying(!playing);
});

// --- export -------------------------------------------------------------------------

const slug = () =>
  (state.title || "chessart")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "chessart";

function job(spec: FrameSpec, onProgress: ExportJob["onProgress"], signal: AbortSignal): ExportJob {
  const r = new FrameRenderer(spec);
  const t = timing();
  const moves = state.game.moves.length;
  return {
    width: spec.width,
    height: spec.height,
    fps: t.fps,
    frames: frameCount(moves, t),
    renderFrame: (c, i) => r.render(c, progressAt(i / t.fps, moves, t)),
    onProgress,
    signal,
  };
}

const makeMp4 = (onProgress?: ExportJob["onProgress"], signal = new AbortController().signal) =>
  encodeMp4(job(frameSpec(), onProgress, signal));

const pngSpec = () => frameSpec({ transparent: true, artOnly: state.artOnly });

const makePngZip = (onProgress?: ExportJob["onProgress"], signal = new AbortController().signal) =>
  encodePngZip(job(pngSpec(), onProgress, signal), framesFolder());

const framesFolder = () => `${slug()}-${state.aspect.replace(":", "x")}-frames`;

async function runExport(label: string, work: (onProgress: ExportJob["onProgress"], signal: AbortSignal) => Promise<void>) {
  setPlaying(false);
  const overlay = $("progress");
  const bar = $<HTMLProgressElement>("progressBar");
  const text = $("progressText");
  const ctrl = new AbortController();
  $("cancel").onclick = () => ctrl.abort();
  overlay.hidden = false;
  try {
    await work((done, total) => {
      bar.value = done / total;
      text.textContent = `${label}: frame ${done} of ${total}`;
    }, ctrl.signal);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) showError(e instanceof Error ? e.message : String(e));
  } finally {
    overlay.hidden = true;
  }
}

$("exportMp4").addEventListener("click", () =>
  runExport("Rendering MP4", async (onProgress, signal) => {
    const blob = await makeMp4(onProgress, signal);
    download(blob, `${slug()}-${state.aspect.replace(":", "x")}.mp4`);
  }),
);

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
  runExport("Rendering PNG frames", async (onProgress, signal) => {
    if (dir) return writePngFolder(job(pngSpec(), onProgress, signal), dir);
    download(await makePngZip(onProgress, signal), `${framesFolder()}.zip`);
  });
});

// Scripting hook for testing exports without the download dialog (dev server only).
if (import.meta.env.DEV) Object.assign(window, { __animate: { makeMp4, makePngZip, state, rebuild } });

$<HTMLSelectElement>("preset").value = firstClassic;
$<HTMLTextAreaElement>("pgn").value = classicGames[firstClassic]!;
Object.assign(state, defaultText(state.game, firstClassic));
input("title").value = state.title;
input("subtitle").value = state.subtitle;
rebuild();
