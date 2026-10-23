import {
  buildScene,
  drawBoard,
  drawMark,
  drawMoves,
  easeInOutCubic,
  flowerNames,
  getPalette,
  getTheme,
  parseGame,
  splitProgress,
  type ArtGame,
  type Scene,
} from "@chessart/render";
import { esc, formatClock, resultText, splitName } from "./format";
import type { LiveHandlers, LiveUpdate, Status } from "./lichess";
import { openObsDialog, type Overlay } from "./overlay";
import { nextPalette, nextStyle, nextTheme, writeSettings, type Settings } from "./settings";

const SWEEP_SECONDS = 1.6; // how long one live move takes to draw
const INTRO_SECONDS = 5; // how long catching up on already-played moves takes
const REPLAY_SECONDS = 0.6; // per move, when an OBS overlay replays the game from move 1

export interface Heading {
  title?: string;
  subtitle?: string;
  fed?: { w?: string; b?: string };
}

export class Viewer {
  readonly handlers: LiveHandlers = {
    onUpdate: (u) => this.applyUpdate(u),
    onStatus: (s) => this.setStatus(s),
  };

  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cache = document.createElement("canvas");
  private cacheCtx = this.cache.getContext("2d")!;
  private game: ArtGame | null = null;
  private scene: Scene | null = null;
  private heading: Heading = {};
  private status: Status = "connecting";
  private shown = 0; // moves drawn; the fractional part is the sweep in flight
  private rate = 1 / SWEEP_SECONDS; // moves per second
  private cached = 0; // whole moves already baked into the cache canvas
  private cacheDirty = true;
  private sizePx = 0;
  private raf = 0;
  private lastFrame = 0;
  private clocks: { w?: number; b?: number; at: number } = { at: 0 };

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private overlay: Overlay | null = null,
  ) {
    parent.innerHTML = `
      <div class="viewer">
        <div class="art"><canvas></canvas><p class="waiting" hidden>Waiting for the first move</p></div>
        <aside class="panel">
          <header class="top">
            <span class="status"><i></i><b>Connecting</b></span>
            <h1 class="event"></h1>
            <p class="round"></p>
            <p class="opening"></p>
          </header>
          <section class="players">
            <div class="player" data-side="w"></div>
            <div class="player" data-side="b"></div>
          </section>
          <section class="result" hidden></section>
          <section class="moves"><p></p></section>
          <ul class="legend"></ul>
          <ul class="legend flowers" hidden></ul>
          <footer><img alt="ChessArt" /><span>chessart.me</span></footer>
        </aside>
        <button class="obs-open" type="button">OBS link</button>
        <p class="hint">F full screen · S style · T theme · P palette · H panel · L labels · O OBS link · B back</p>
      </div>`;
    this.root = parent.querySelector(".viewer")!;
    this.canvas = this.root.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    if (overlay) {
      this.root.classList.add("overlay");
      this.root.classList.toggle("transparent", overlay.transparent);
      document.documentElement.classList.toggle("transparent", overlay.transparent);
    }
    this.root.querySelector(".obs-open")!.addEventListener("click", () => this.openObs());

    new ResizeObserver(() => this.resize()).observe(this.root.querySelector(".art")!);
    document.fonts.load("500 16px Montserrat").then(() => this.invalidate());
    window.addEventListener("keydown", (e) => this.onKey(e));
    setInterval(() => this.renderClocks(), 1000);
    this.setupKiosk();
    this.applySettings();
  }

  setHeading(heading: Heading) {
    this.heading = { ...this.heading, ...heading };
    this.renderPanel();
  }

  private applyUpdate(update: LiveUpdate) {
    let game: ArtGame;
    try {
      game = parseGame(update.pgn);
    } catch {
      return; // a malformed or half-sent PGN; the next update will carry the full game
    }
    const prev = this.game?.moves ?? [];
    let common = 0;
    while (common < prev.length && common < game.moves.length && prev[common]!.san === game.moves[common]!.san) common++;
    if (common < prev.length) {
      // The broadcast corrected earlier moves (e.g. a DGT board glitch): roll the art back.
      this.shown = Math.min(this.shown, common);
      this.cacheDirty = true;
    }
    if (this.overlay && !this.game) {
      // An overlay either opens on the position as it stands or replays the game at a watchable pace.
      if (this.overlay.start === "now") this.shown = game.moves.length;
      else this.rate = 1 / REPLAY_SECONDS;
    } else {
      // One new move sweeps at the normal pace; a backlog (opening a game mid-way) plays out over INTRO_SECONDS.
      this.rate = Math.max(this.rate, (game.moves.length - this.shown) / INTRO_SECONDS);
    }

    this.game = game;
    this.scene = buildScene(game, this.settings);
    this.updateClocks(game, update.clocks);
    this.renderPanel();
    this.request();
  }

  private updateClocks(game: ArtGame, explicit?: { w: number; b: number }) {
    if (explicit) {
      this.clocks = { ...explicit, at: Date.now() };
      return;
    }
    const last = (side: "w" | "b") => [...game.moves].reverse().find((m) => m.side === side && m.clock !== undefined)?.clock;
    this.clocks = { w: last("w"), b: last("b"), at: Date.now() };
  }

  private setStatus(status: Status) {
    this.status = status;
    const label = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", ended: "Final" }[status];
    const el = this.root.querySelector(".status")!;
    el.className = `status ${status}`;
    el.querySelector("b")!.textContent = this.game && this.game.result !== "*" ? "Final" : label;
  }

  // --- drawing -------------------------------------------------------------

  private resize() {
    const art = this.root.querySelector<HTMLElement>(".art")!;
    const style = getComputedStyle(art);
    const w = art.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const h = art.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const css = Math.max(0, Math.floor(Math.min(w, h)));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = this.canvas.style.height = `${css}px`;
    this.sizePx = Math.round(css * dpr);
    this.canvas.width = this.canvas.height = this.cache.width = this.cache.height = this.sizePx;
    this.invalidate();
  }

  private invalidate() {
    this.cacheDirty = true;
    this.request();
  }

  private request() {
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.raf = 0;
    const target = this.scene?.shapes.length ?? 0;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    if (this.shown < target) this.shown = Math.min(target, this.shown + this.rate * dt);
    this.paint();
    if (this.shown < target) {
      this.lastFrame = now;
      this.request();
    } else {
      this.lastFrame = 0;
      this.rate = 1 / SWEEP_SECONDS;
    }
  }

  private paint() {
    const theme = getTheme(this.settings.theme);
    const rect = { x: 0, y: 0, size: this.sizePx };
    const scene = this.scene ?? buildScene({ tags: {}, moves: [], result: "*" }, this.settings);
    const { full, frac } = splitProgress(this.shown, scene.shapes.length);

    if (this.cacheDirty || full < this.cached) {
      this.cacheCtx.clearRect(0, 0, this.sizePx, this.sizePx);
      drawBoard(this.cacheCtx, scene, { rect, labels: this.settings.labels && !this.overlay, background: !this.overlay?.transparent });
      this.cached = 0;
      this.cacheDirty = false;
    }
    if (full > this.cached) {
      drawMoves(this.cacheCtx, scene, rect, this.cached, full);
      this.cached = full;
    }
    if (this.overlay?.transparent) {
      this.ctx.clearRect(0, 0, this.sizePx, this.sizePx);
    } else {
      this.ctx.fillStyle = theme.background;
      this.ctx.fillRect(0, 0, this.sizePx, this.sizePx);
    }
    this.ctx.drawImage(this.cache, 0, 0);
    if (frac > 0) drawMark(this.ctx, scene, full, rect, easeInOutCubic(frac));
  }

  // --- side panel ----------------------------------------------------------

  private renderPanel() {
    const game = this.game;
    const tags = game?.tags ?? {};
    const $ = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;

    // PGN uses "?" and "-" for unknown values.
    const tag = (key: string) => (tags[key] && !/^[?\-.]+$/.test(tags[key]!) ? tags[key] : undefined);
    $(".event").textContent = this.heading.title ?? tag("BroadcastName") ?? tag("Event") ?? "";
    $(".round").textContent = this.heading.subtitle ?? tag("Round") ?? tag("Date") ?? "";
    $(".opening").textContent = tags.Opening ?? "";
    $(".waiting").hidden = !game || game.moves.length > 0;

    for (const side of ["w", "b"] as const) {
      const key = side === "w" ? "White" : "Black";
      const { first, last } = splitName(tags[key] ?? (side === "w" ? "White" : "Black"));
      const meta = [tags[`${key}Title`], tags[`${key}Elo`], this.heading.fed?.[side]].filter(Boolean).join(" · ");
      $(`.player[data-side="${side}"]`).innerHTML = `
        <span class="dot ${side}"></span>
        <div class="who">
          <span class="first">${esc(first)}</span>
          <span class="last">${esc(last)}</span>
          <span class="meta">${esc(meta)}</span>
        </div>
        <span class="clock"></span>`;
    }
    this.renderClocks();

    const result = game ? resultText(game.result, tags.White ?? "", tags.Black ?? "") : null;
    const resultEl = $(".result");
    resultEl.hidden = !result;
    resultEl.innerHTML = result ? `<span class="score">${result.score}</span><span>${esc(result.line)}</span>` : "";
    this.setStatus(this.status);

    const moves = game?.moves ?? [];
    $(".moves p").innerHTML = moves
      .map((m, i) => {
        const num = m.side === "w" ? `<span class="num">${Math.ceil(m.ply / 2)}.</span>` : i === 0 ? `<span class="num">${Math.ceil(m.ply / 2)}…</span>` : "";
        return `${num}<span class="san${i === moves.length - 1 ? " last" : ""}">${esc(m.san)}</span>`;
      })
      .join(" ");

    const palette = getPalette(this.settings.palette);
    const swatch = (stops: readonly [string, string]) => `background:linear-gradient(90deg,${stops[0]},${stops[1]})`;
    $(".legend").innerHTML = [
      ["White", palette.white],
      ["Black", palette.black],
      ["O-O and O-O-O", palette.castle],
      ["Captures", palette.capture],
    ]
      .map(([label, stops]) => `<li><i style="${swatch(stops as [string, string])}"></i>${label}</li>`)
      .join("");

    // Pressed Flowers: which flower each piece grows.
    const flowers = $(".legend.flowers");
    flowers.hidden = this.settings.style !== "pressed-flowers";
    const glyphs = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" } as const;
    flowers.innerHTML = (Object.keys(glyphs) as Array<keyof typeof glyphs>)
      .map((p) => `<li><b>${glyphs[p]}</b>${flowerNames[p]}</li>`)
      .join("");
  }

  private renderClocks() {
    const game = this.game;
    const toMove = game && game.moves.length % 2 === 1 ? "b" : "w";
    const ticking = !!game && game.result === "*" && this.status === "live" && game.moves.length >= 2;
    for (const side of ["w", "b"] as const) {
      const el = this.root.querySelector<HTMLElement>(`.player[data-side="${side}"] .clock`);
      const base = this.clocks[side];
      if (!el) continue;
      if (base === undefined) {
        el.textContent = "";
        continue;
      }
      const running = ticking && side === toMove;
      el.textContent = formatClock(running ? base - (Date.now() - this.clocks.at) / 1000 : base);
      el.classList.toggle("running", running);
    }
  }

  // --- settings & kiosk ----------------------------------------------------

  private applySettings() {
    const theme = getTheme(this.settings.theme);
    const css = this.root.style;
    css.setProperty("--bg", theme.background);
    css.setProperty("--fg", theme.foreground);
    css.setProperty("--muted", theme.muted);
    document.body.style.background = this.overlay?.transparent ? "transparent" : theme.background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.background);
    this.root.classList.toggle("no-panel", !this.settings.panel);
    this.root.querySelector<HTMLImageElement>("footer img")!.src =
      `${import.meta.env.BASE_URL}ChessArt_Logo_${theme.dark ? "White" : "Black"}.png`;
    if (this.game) this.scene = buildScene(this.game, this.settings);
    writeSettings(this.settings);
    this.renderPanel();
    this.invalidate();
  }

  private openObs() {
    openObsDialog(this.root, { ...this.settings }, (s) => {
      Object.assign(this.settings, s);
      this.applySettings();
    });
  }

  private onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || this.overlay || this.root.querySelector("dialog[open]")) return;
    const s = this.settings;
    switch (e.key.toLowerCase()) {
      case "f":
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
        return;
      case "s":
        Object.assign(s, nextStyle(s));
        break;
      case "t":
        s.theme = nextTheme(s.theme);
        break;
      case "p":
        s.palette = nextPalette(s.palette);
        break;
      case "h":
        s.panel = !s.panel;
        break;
      case "l":
        s.labels = !s.labels;
        break;
      case "o":
        this.openObs();
        return;
      case "b":
        location.href = `${location.pathname}?style=${s.style}&theme=${s.theme}&palette=${s.palette}`;
        return;
      default:
        return;
    }
    this.applySettings();
  }

  private setupKiosk() {
    // Keep the screen awake and hide the cursor when the mouse is still.
    const lock = () => navigator.wakeLock?.request("screen").catch(() => {});
    lock();
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && lock());

    let idle = 0;
    const wake = () => {
      this.root.classList.remove("idle");
      clearTimeout(idle);
      idle = window.setTimeout(() => this.root.classList.add("idle"), 2500);
    };
    window.addEventListener("mousemove", wake);
    wake();
  }
}
