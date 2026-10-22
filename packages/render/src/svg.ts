import { easeInOutCubic } from "./geometry";
import {
  boardLabels,
  checkerSquares,
  DEFAULT_FONT,
  LABEL_SIZE,
  splitProgress,
  toPx,
  type BoardOptions,
} from "./layout";
import type { Paint, PaintOp } from "./paint";
import type { Scene } from "./scene";

export interface SvgOptions extends BoardOptions {
  width: number;
  height: number;
  idPrefix?: string; // keeps gradient ids unique when several SVGs share a page
}

const n = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function sceneToSVG(scene: Scene, opts: SvgOptions): string {
  const { rect, width, height } = opts;
  const { theme } = scene;
  const unit = rect.size / 9;
  const id = opts.idPrefix ?? "ca";
  const ease = opts.ease ?? easeInOutCubic;
  const defs: string[] = [];
  const body: string[] = [];

  if (opts.background ?? true) {
    const box = `x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.size)}" height="${n(rect.size)}"`;
    body.push(`<rect ${box} fill="${theme.background}"/>`);
    if (theme.texture === "paper") {
      // Resolution-independent grain, so print files stay crisp at any size.
      defs.push(
        `<filter id="${id}paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${n(900 / rect.size)}" numOctaves="3" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.43 0 0 0 0 0.36 0 0 0 0 0.26 0.28 0 0 0 -0.11"/></filter>`,
      );
      body.push(`<rect ${box} filter="url(#${id}paper)"/>`);
    }
  }
  if ((opts.board ?? true) && theme.checker) {
    const squares = checkerSquares().map((sq) => {
      const p = toPx(rect, sq);
      return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(unit)}" height="${n(unit)}"/>`;
    });
    body.push(`<g fill="${theme.checker}">${squares.join("")}</g>`);
  }
  if (opts.labels) {
    const font = esc(opts.font ?? DEFAULT_FONT);
    const labels = boardLabels().map((l) => {
      const p = toPx(rect, l.at);
      return `<text x="${n(p.x)}" y="${n(p.y)}">${l.text}</text>`;
    });
    body.push(
      `<g fill="${theme.muted}" font-family="${font}" font-weight="500" font-size="${n(LABEL_SIZE * unit)}" text-anchor="middle" dominant-baseline="central">${labels.join("")}</g>`,
    );
  }

  const { full, frac } = splitProgress(opts.progress ?? scene.shapes.length, scene.shapes.length);
  const drawn: Array<[number, number]> = [];
  for (let i = 0; i < full; i++) drawn.push([i, 1]);
  if (frac > 0) drawn.push([full, ease(frac)]);

  const blurs = new Set<number>();
  for (const [index, t] of drawn) {
    const ops = scene.style.paint(scene.shapes[index]!, rect, t, scene);
    ops.forEach((op, j) => body.push(opToSVG(op, `${id}${index}${j ? `-${j}` : ""}`, defs, id, blurs)));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
}

// Gradients go into <defs>; solid colours are inlined.
function paintRef(paint: Paint, id: string, defs: string[]): string {
  if (typeof paint === "string") return paint;
  const stops = paint.stops
    .map(([o, c, a]) => `<stop offset="${n(o)}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${n(a)}"`}/>`)
    .join("");
  defs.push(
    paint.kind === "linear"
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(paint.from.x)}" y1="${n(paint.from.y)}" x2="${n(paint.to.x)}" y2="${n(paint.to.y)}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(paint.center.x)}" cy="${n(paint.center.y)}" r="${n(paint.radius)}">${stops}</radialGradient>`,
  );
  return `url(#${id})`;
}

function opToSVG(op: PaintOp, id: string, defs: string[], prefix: string, blurs: Set<number>): string {
  if (!op.d) return "";
  const attrs = [`d="${op.d}"`];
  if (op.blur) {
    const b = n(op.blur);
    if (!blurs.has(b)) {
      blurs.add(b);
      defs.push(`<filter id="${prefix}blur${String(b).replace(".", "_")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${b}"/></filter>`);
    }
    attrs.push(`filter="url(#${prefix}blur${String(b).replace(".", "_")})"`);
  }
  attrs.push(`fill="${op.fill ? paintRef(op.fill, id, defs) : "none"}"`);
  if (op.stroke) {
    attrs.push(`stroke="${paintRef(op.stroke, `${id}s`, defs)}"`);
    attrs.push(`stroke-width="${n(op.width ?? 1)}"`, `stroke-linecap="${op.cap ?? "round"}"`, `stroke-linejoin="round"`);
  }
  if (op.opacity !== undefined && op.opacity !== 1) attrs.push(`opacity="${op.opacity}"`);
  return `<path ${attrs.join(" ")}/>`;
}
