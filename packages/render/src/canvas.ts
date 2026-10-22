import { easeInOutCubic } from "./geometry";
import {
  boardLabels,
  checkerSquares,
  DEFAULT_FONT,
  LABEL_SIZE,
  splitProgress,
  toPx,
  type BoardOptions,
  type Rect,
} from "./layout";
import { rgba } from "./color";
import type { Paint, PaintOp } from "./paint";
import { seeded } from "./random";
import type { Scene } from "./scene";
import type { Theme } from "./themes";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// Draws the whole frame: background, board, labels and moves up to `progress`.
export function drawScene(ctx: Ctx, scene: Scene, opts: BoardOptions): void {
  drawBoard(ctx, scene, opts);
  drawMoves(ctx, scene, opts.rect, 0, opts.progress ?? scene.shapes.length, opts.ease);
}

export function drawBoard(ctx: Ctx, scene: Scene, opts: BoardOptions): void {
  const { rect } = opts;
  const { theme } = scene;
  const unit = rect.size / 9;
  ctx.save();
  ctx.globalAlpha = 1;
  if (opts.background ?? true) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(rect.x, rect.y, rect.size, rect.size);
    drawTexture(ctx, theme, rect.x, rect.y, rect.size, rect.size);
  }
  if ((opts.board ?? true) && theme.checker) {
    ctx.fillStyle = theme.checker;
    for (const sq of checkerSquares()) {
      const p = toPx(rect, sq);
      ctx.fillRect(p.x, p.y, unit, unit);
    }
  }
  if (opts.labels) {
    ctx.fillStyle = theme.muted;
    ctx.font = `500 ${LABEL_SIZE * unit}px ${opts.font ?? DEFAULT_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const label of boardLabels()) {
      const p = toPx(rect, label.at);
      ctx.fillText(label.text, p.x, p.y);
    }
  }
  ctx.restore();
}

// Draws moves [from, progress). Lets callers cache finished moves and only add new ones.
export function drawMoves(
  ctx: Ctx,
  scene: Scene,
  rect: Rect,
  from: number,
  progress: number,
  ease: (t: number) => number = easeInOutCubic,
): void {
  const { full, frac } = splitProgress(progress, scene.shapes.length);
  for (let i = from; i < full; i++) drawMark(ctx, scene, i, rect, 1);
  if (frac > 0) drawMark(ctx, scene, full, rect, ease(frac));
}

// Draws move `index` swept to t (0..1) in whatever style the scene uses.
export function drawMark(ctx: Ctx, scene: Scene, index: number, rect: Rect, t: number): void {
  if (t <= 0) return;
  paintOps(ctx, scene.style.paint(scene.shapes[index]!, rect, t, scene));
}

function toCanvasPaint(ctx: Ctx, paint: Paint): string | CanvasGradient {
  if (typeof paint === "string") return paint;
  const g =
    paint.kind === "linear"
      ? ctx.createLinearGradient(paint.from.x, paint.from.y, paint.to.x, paint.to.y)
      : ctx.createRadialGradient(paint.center.x, paint.center.y, 0, paint.center.x, paint.center.y, paint.radius);
  for (const [offset, color, opacity] of paint.stops) g.addColorStop(offset, opacity === undefined ? color : rgba(color, opacity));
  return g;
}

// Canvas blur filters exist in Chrome, Edge and Firefox; elsewhere soft shadows are left out
// rather than drawn as hard-edged copies.
const filterSupport = new WeakMap<object, boolean>();
function canBlur(ctx: Ctx): boolean {
  let ok = filterSupport.get(ctx);
  if (ok === undefined) {
    const before = ctx.filter;
    ctx.filter = "blur(1px)";
    ok = ctx.filter === "blur(1px)";
    ctx.filter = before;
    filterSupport.set(ctx, ok);
  }
  return ok;
}

export function paintOps(ctx: Ctx, ops: PaintOp[]): void {
  for (const op of ops) {
    if (!op.d) continue;
    if (op.blur && !canBlur(ctx)) continue;
    const path = new Path2D(op.d);
    ctx.save();
    if (op.blur) ctx.filter = `blur(${op.blur}px)`;
    ctx.globalAlpha = op.opacity ?? 1;
    if (op.fill) {
      ctx.fillStyle = toCanvasPaint(ctx, op.fill);
      ctx.fill(path);
    }
    if (op.stroke) {
      ctx.strokeStyle = toCanvasPaint(ctx, op.stroke);
      ctx.lineWidth = op.width ?? 1;
      ctx.lineCap = op.cap ?? "round";
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
    ctx.restore();
  }
}

// Paper grain: fine speckle and a few fibres, generated once (seeded, so it never changes) and tiled.
let paperTile: OffscreenCanvas | null = null;

function paperPattern(ctx: Ctx): CanvasPattern | null {
  if (!paperTile) {
    const size = 256;
    paperTile = new OffscreenCanvas(size, size);
    const g = paperTile.getContext("2d")!;
    const rand = seeded(7);
    const img = g.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rand();
      const dark = v < 0.5;
      img.data[i] = dark ? 110 : 255;
      img.data[i + 1] = dark ? 92 : 252;
      img.data[i + 2] = dark ? 66 : 245;
      img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 26);
    }
    g.putImageData(img, 0, 0);
    g.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const a = rand() * Math.PI * 2;
      const len = 6 + rand() * 22;
      g.strokeStyle = rand() < 0.5 ? "rgba(120,100,70,0.08)" : "rgba(255,255,250,0.18)";
      g.lineWidth = 0.6 + rand() * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a + 0.4) * len * 0.5, y + Math.sin(a + 0.4) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  }
  return ctx.createPattern(paperTile, "repeat");
}

// Draws the theme's surface texture (if it has one) over an area already filled with its background.
export function drawTexture(ctx: Ctx, theme: Theme, x: number, y: number, w: number, h: number): void {
  if (theme.texture !== "paper" || typeof OffscreenCanvas === "undefined") return;
  const pattern = paperPattern(ctx);
  if (!pattern) return;
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}
