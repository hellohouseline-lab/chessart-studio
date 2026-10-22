import { easeInOutCubic, partialLens } from "./geometry";
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
import type { LensShape, Scene } from "./scene";

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
  for (let i = from; i < full; i++) drawLens(ctx, scene.shapes[i]!, rect, 1);
  if (frac > 0) drawLens(ctx, scene.shapes[full]!, rect, ease(frac));
}

export function drawLens(ctx: Ctx, shape: LensShape, rect: Rect, t: number): void {
  if (t <= 0) return;
  const p0 = toPx(rect, shape.p0);
  const p2 = toPx(rect, shape.p2);
  const grad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
  grad.addColorStop(0, shape.stops[0]);
  grad.addColorStop(1, shape.stops[1]);

  ctx.save();
  ctx.globalAlpha = shape.opacity;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  if (t >= 1) {
    const c = toPx(rect, shape.c);
    ctx.quadraticCurveTo(c.x, c.y, p2.x, p2.y);
  } else {
    const part = partialLens(shape.p0, shape.c, shape.p2, t);
    const q = toPx(rect, part.q);
    const tip = toPx(rect, part.tip);
    const chord = toPx(rect, part.chord);
    ctx.quadraticCurveTo(q.x, q.y, tip.x, tip.y);
    ctx.lineTo(chord.x, chord.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
