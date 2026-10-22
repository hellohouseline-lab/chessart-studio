// Board space: a 9×9 unit frame. Square centres sit on whole units, with a1 at (1, 8)
// and h8 at (8, 1). This is the grid the original prints used (120px per unit).
export const FRAME_UNITS = 9;

export interface Pt {
  x: number;
  y: number;
}

export function squareCenter(square: string): Pt {
  const file = square.charCodeAt(0) - 96; // a → 1
  const rank = Number(square[1]);
  return { x: file, y: FRAME_UNITS - rank };
}

// Control point sits `bulge` units off the midpoint, perpendicular to the move.
// Same construction as calculateControlPoints() in the original chess-art/js/chessArt.js.
export function controlPoint(p0: Pt, p2: Pt, bulge: number): Pt {
  const mid = { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
  const perp = Math.atan2(p2.y - p0.y, p2.x - p0.x) + Math.PI / 2;
  return { x: mid.x + bulge * Math.cos(perp), y: mid.y + bulge * Math.sin(perp) };
}

export const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export interface PartialLens {
  p0: Pt;
  q: Pt; // control point of the curve truncated at t
  tip: Pt; // point on the curve at t
  chord: Pt; // point on the chord at t
}

// A lens is the area between the quadratic curve p0→c→p2 and its chord.
// Truncating both at t (de Casteljau) gives a lens that sweeps from origin to target;
// for a symmetric bulge the cut edge tip→chord is perpendicular to the move.
export function partialLens(p0: Pt, c: Pt, p2: Pt, t: number): PartialLens {
  const q = lerp(p0, c, t);
  const tip = lerp(q, lerp(c, p2, t), t);
  return { p0, q, tip, chord: lerp(p0, p2, t) };
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
