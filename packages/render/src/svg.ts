import { easeInOutCubic, partialLens, type Pt } from "./geometry";
import {
  boardLabels,
  checkerSquares,
  DEFAULT_FONT,
  LABEL_SIZE,
  splitProgress,
  toPx,
  type BoardOptions,
} from "./layout";
import type { LensShape, Scene } from "./scene";

export interface SvgOptions extends BoardOptions {
  width: number;
  height: number;
  idPrefix?: string; // keeps gradient ids unique when several SVGs share a page
}

const n = (v: number) => Math.round(v * 100) / 100;
const pt = (p: Pt) => `${n(p.x)} ${n(p.y)}`;
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
    body.push(`<rect x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.size)}" height="${n(rect.size)}" fill="${theme.background}"/>`);
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
  const drawn: Array<[LensShape, number]> = scene.shapes.slice(0, full).map((s) => [s, 1]);
  if (frac > 0) drawn.push([scene.shapes[full]!, ease(frac)]);

  for (const [shape, t] of drawn) {
    const gid = `${id}${shape.index}`;
    const p0 = toPx(rect, shape.p0);
    const p2 = toPx(rect, shape.p2);
    defs.push(
      `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(p0.x)}" y1="${n(p0.y)}" x2="${n(p2.x)}" y2="${n(p2.y)}"><stop offset="0" stop-color="${shape.stops[0]}"/><stop offset="1" stop-color="${shape.stops[1]}"/></linearGradient>`,
    );
    let d: string;
    if (t >= 1) {
      d = `M ${pt(p0)} Q ${pt(toPx(rect, shape.c))} ${pt(p2)} Z`;
    } else {
      const part = partialLens(shape.p0, shape.c, shape.p2, t);
      d = `M ${pt(p0)} Q ${pt(toPx(rect, part.q))} ${pt(toPx(rect, part.tip))} L ${pt(toPx(rect, part.chord))} Z`;
    }
    body.push(`<path d="${d}" fill="url(#${gid})" opacity="${shape.opacity}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${body.join("")}</svg>`;
}
