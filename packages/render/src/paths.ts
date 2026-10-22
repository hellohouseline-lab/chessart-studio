import type { Pt } from "./geometry";
import type { Random } from "./random";

// Hand-drawn paths between two squares. Every move gets its own character (straight, a bend either
// way, or an S) plus a little tremor, instead of every move sharing one geometric arc.

export interface PathShape {
  bend: number; // first control point offset, as a fraction of the move length (+ is left of travel)
  bend2: number; // second control point offset; opposite sign to bend makes an S
  tremor: number; // hand wobble amplitude, board units
  tremorFreq: number;
  tremorPhase: number;
}

export function randomShape(rand: Random, maxBend = 0.32, tremor = 0.012): PathShape {
  const r = rand();
  let bend: number;
  let bend2: number;
  if (r < 0.22) {
    bend = rand.range(-0.04, 0.04); // nearly straight
    bend2 = bend + rand.range(-0.03, 0.03);
  } else if (r < 0.75) {
    bend = rand.sign() * rand.range(0.08, maxBend); // a single bend
    bend2 = bend * rand.range(0.5, 1.2);
  } else {
    bend = rand.sign() * rand.range(0.1, maxBend * 0.85); // an S
    bend2 = -bend * rand.range(0.5, 1.1);
  }
  return { bend, bend2, tremor: tremor * rand.range(0.4, 1.6), tremorFreq: rand.range(0.5, 1.5), tremorPhase: rand() };
}

// A single committed line: straight, or one shallow bend, with no tremor and no S. For brush strokes
// played with intent, and for pressed stems, which dry almost straight.
export function decisiveShape(rand: Random, maxBend = 0.08, straightChance = 0.35): PathShape {
  const bend = rand() < straightChance ? rand.range(-0.015, 0.015) : rand.sign() * rand.range(0.02, maxBend);
  return { bend, bend2: bend * rand.range(0.7, 1.05), tremor: 0, tremorFreq: 0, tremorPhase: 0 };
}

// A pressed stem: mostly one gentle bend, now and then a soft S, with a trace of natural irregularity.
// Between ruler-straight and the looping arcs of a drawn vine.
export function stemShape(rand: Random): PathShape {
  const r = rand();
  let bend: number;
  let bend2: number;
  if (r < 0.15) {
    bend = rand.range(-0.03, 0.03);
    bend2 = bend * rand.range(0.6, 1.2);
  } else if (r < 0.88) {
    bend = rand.sign() * rand.range(0.06, 0.15);
    bend2 = bend * rand.range(0.55, 1.2);
  } else {
    bend = rand.sign() * rand.range(0.06, 0.11);
    bend2 = -bend * rand.range(0.4, 0.8);
  }
  return { bend, bend2, tremor: rand.range(0.002, 0.007), tremorFreq: rand.range(1, 2.2), tremorPhase: rand() };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

// A cubic path resampled by arc length, so `at(s)` moves evenly along it.
export class StrokePath {
  private pts: Pt[] = [];
  private cum: number[] = [0];
  readonly length: number;

  constructor(
    readonly from: Pt,
    readonly to: Pt,
    shape: PathShape,
    samples = 72,
  ) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1e-6;
    const n = { x: -dy / L, y: dx / L };
    const c1 = { x: from.x + dx / 3 + n.x * shape.bend * L, y: from.y + dy / 3 + n.y * shape.bend * L };
    const c2 = { x: from.x + (2 * dx) / 3 + n.x * shape.bend2 * L, y: from.y + (2 * dy) / 3 + n.y * shape.bend2 * L };
    for (let i = 0; i <= samples; i++) {
      const s = i / samples;
      const u = 1 - s;
      const a = u * u * u;
      const b = 3 * u * u * s;
      const c = 3 * u * s * s;
      const d = s * s * s;
      // Tremor fades out at both ends so the path still starts and ends on the square centres,
      // and is gentler on short moves, which a hand draws in one smooth flick.
      const w = shape.tremor * Math.min(1, L / 3) * Math.sin(2 * Math.PI * (shape.tremorFreq * s + shape.tremorPhase)) * Math.sin(Math.PI * s);
      this.pts.push({
        x: a * from.x + b * c1.x + c * c2.x + d * to.x + n.x * w,
        y: a * from.y + b * c1.y + c * c2.y + d * to.y + n.y * w,
      });
    }
    let total = 0;
    for (let i = 1; i < this.pts.length; i++) {
      total += Math.hypot(this.pts[i]!.x - this.pts[i - 1]!.x, this.pts[i]!.y - this.pts[i - 1]!.y);
      this.cum.push(total);
    }
    this.length = total;
  }

  // Point at fraction s (0 … 1) of the path's length.
  at(s: number): Pt {
    const target = clamp(s) * this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < target) lo = mid;
      else hi = mid;
    }
    const span = this.cum[hi]! - this.cum[lo]! || 1;
    const f = (target - this.cum[lo]!) / span;
    const p = this.pts[lo]!;
    const q = this.pts[hi]!;
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
  }

  // Unit tangent and left-hand normal at s.
  frame(s: number): { t: Pt; n: Pt } {
    const a = this.at(s - 0.005);
    const b = this.at(s + 0.005);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    return { t, n: { x: -t.y, y: t.x } };
  }

  angle(s: number): number {
    const { t } = this.frame(s);
    return Math.atan2(t.y, t.x);
  }

  // Evenly spaced fractions from `from` to `to`, about one sample per `step` board units.
  samples(from: number, to: number, step = 0.06): number[] {
    const n = Math.max(2, Math.ceil(((to - from) * this.length) / step));
    return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  }
}

// Offsets a point along a direction.
export const offset = (p: Pt, d: Pt, k: number): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });

// Approximately normal random numbers (mean 0, sd ≈ 1), from the same seeded stream.
export const gauss = (rand: Random) => (rand() + rand() + rand() + rand() - 2) * 1.73;
