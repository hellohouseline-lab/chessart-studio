import { darken, lighten, mix } from "../color";
import type { PieceType } from "../game";
import { squareCenter, type Pt } from "../geometry";
import { toPx } from "../layout";
import { PathBuilder, type GradientStops, type PaintOp } from "../paint";
import type { Stops } from "../palettes";
import { decisiveShape, gauss, offset, StrokePath } from "../paths";
import { hashString, seeded, type Random } from "../random";
import type { ArtStyle, Mark } from "../scene";
import { stopsFor } from "./classicArcs";

// Material value sets the stroke weight. The king has no material value; 4 is its usual
// "fighting value", heavy enough to matter without endgame king walks swamping the picture.
export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 4 };

type Brush = "flat" | "round" | "filbert" | "dry" | "slash";

// Per-brush character: how wide it lands, how far it tapers, and how square its ends are.
const BRUSHES: Record<Brush, { land: number; tip: number; cap: number }> = {
  flat: { land: 0.85, tip: 0.38, cap: 0.16 },
  round: { land: 0.22, tip: 0.05, cap: 0.75 },
  filbert: { land: 0.55, tip: 0.16, cap: 0.5 },
  dry: { land: 0.75, tip: 0.32, cap: 0.22 },
  slash: { land: 0.95, tip: 0.2, cap: 0.3 }, // captures: a fast, loaded strike
};

interface Pass {
  offset: number; // across the stroke, fraction of width
  scale: number; // fraction of the stroke width
  alpha: number;
  from: number;
  to: number;
}

interface Bristle {
  offset: number;
  segments: Array<[number, number]>; // continuous where the paint is wet, broken where it's dry
  width: number; // fraction of stroke width
  tone: "paint" | "light" | "dark";
  group: 0 | 1;
}

interface Hair {
  side: 1 | -1;
  at: number;
  length: number;
  lean: number;
}

interface Drop {
  at: Pt;
  r: number;
  tail: number; // how far the drop stretches back towards the impact (0 = round)
  angle: number; // direction of flight
  lobes: [number, number, number]; // edge irregularity: count, phase, amount
  big: boolean;
}

export interface BrushMark extends Mark {
  path: StrokePath;
  brush: Brush;
  width: number; // board units
  load: number; // 0 … 1, how much paint the brush carried
  attack: number;
  release: number;
  swell: number;
  rough: number;
  wobble: [number, number, number, number];
  pressure: [freq: number, phase: number, amount: number]; // hand pressure drifting along the stroke
  dry: number; // where the paint starts running out
  end: number; // where the solid body ends; bristles may drag further
  passes: Pass[];
  bristles: Bristle[];
  hairs: Hair[];
  drops: Drop[];
  stops: Stops;
  edge: number; // how strongly wet edges darken
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

function pick<T>(rand: Random, weighted: Array<[T, number]>): T {
  let r = rand() * weighted.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of weighted) if ((r -= w) <= 0) return value;
  return weighted[0]![0];
}

// Width multiplier along the stroke: landing, optional swell, then lifting off.
function profile(m: BrushMark, s: number): number {
  const b = BRUSHES[m.brush];
  const press = b.land + (1 - b.land) * smooth(0, m.attack, s);
  const swell = 1 + m.swell * Math.sin(Math.PI * clamp(s / m.end));
  const lift = 1 - (1 - b.tip) * smooth(m.release, m.end, s);
  const [f, p, amount] = m.pressure;
  return press * swell * lift * (1 + amount * Math.sin(2 * Math.PI * (f * s + p)));
}

function edgeNoise(m: BrushMark, s: number, side: number): number {
  const [f1, f2, p1, p2] = m.wobble;
  return 1 + m.rough * (0.65 * Math.sin(2 * Math.PI * (f1 * s + p1 + side * 0.37)) + 0.35 * Math.sin(2 * Math.PI * (f2 * s + p2 + side * 0.61)));
}

// Outline of the paint between `from` and `to`, offset and scaled for layered passes.
function outline(m: BrushMark, from: number, to: number, across = 0, scale = 1): Pt[] {
  const ss = m.path.samples(from, to, 0.04);
  const side = (k: 1 | -1) =>
    ss.map((s) => {
      const p = m.path.at(s);
      const { n } = m.path.frame(s);
      const w = m.width * profile(m, s);
      return offset(p, n, across * w + (k * scale * w * edgeNoise(m, s, k)) / 2);
    });
  const cap = (s: number, dir: 1 | -1) => {
    const p = offset(m.path.at(s), m.path.frame(s).n, across * m.width * profile(m, s));
    const { t, n } = m.path.frame(s);
    const r = (scale * m.width * profile(m, s)) / 2;
    const depth = BRUSHES[m.brush].cap;
    return Array.from({ length: 5 }, (_, i) => {
      const a = (Math.PI * (i + 1)) / 6;
      return offset(offset(p, n, r * Math.cos(a) * dir), t, r * depth * Math.sin(a) * dir);
    });
  };
  return [...side(1), ...cap(to, 1), ...side(-1).reverse(), ...cap(from, -1)];
}

function bristleLine(m: BrushMark, b: Bristle, from: number, to: number): Pt[] {
  const floor = m.width * 0.42; // past the body, bristles keep their spread: the dry, split tail
  return m.path.samples(from, to, 0.05).map((s) => {
    const w = Math.max(m.width * profile(m, s), s > m.end ? floor : 0);
    return offset(m.path.at(s), m.path.frame(s).n, b.offset * w);
  });
}

function planBristles(rand: Random, m: Pick<BrushMark, "width" | "dry" | "end" | "brush">): Bristle[] {
  const count = Math.round((12 + m.width * 70) * (m.brush === "dry" ? 1.5 : 1));
  return Array.from({ length: count }, (): Bristle => {
    const roll = rand();
    const tone = roll < 0.08 ? "light" : roll < 0.22 ? "dark" : "paint";
    const start = rand.range(0, 0.12);
    const stop = tone === "paint" ? rand.range(m.dry, 1) : rand.range(0.35, m.end);
    const segments: Array<[number, number]> = [];
    for (let at = start; at < stop - 0.01; ) {
      const wet = at < m.dry;
      // Short dabs where the paint is wet (no full-length ridges), broken flecks where it's dry.
      const len = wet ? rand.range(0.12, 0.45) : rand.range(0.02, 0.14);
      const seg: [number, number] = [at, Math.min(stop, at + len)];
      segments.push(seg);
      at = seg[1] + (wet ? rand.range(0.02, 0.09) : rand.range(0.015, 0.07));
    }
    return { offset: rand.range(-0.48, 0.48), segments, width: rand.range(0.02, 0.075), tone, group: rand() < 0.5 ? 0 : 1 };
  });
}

// Paint thrown forward from a capture's impact: a few big drops and many fine ones, the far ones
// stretched in the direction of travel.
function planSplatter(rand: Random, path: StrokePath, width: number, captured: number): Drop[] {
  const end = path.at(1);
  const dir = path.angle(1);
  const reach = (0.25 + 0.06 * captured) * rand.range(0.8, 1.2);
  const drops: Drop[] = [
    {
      at: offset(end, { x: Math.cos(dir), y: Math.sin(dir) }, width * 0.12),
      r: width * rand.range(0.38, 0.5),
      tail: 0.2,
      angle: dir,
      lobes: [rand.int(4, 7), rand(), rand.range(0.07, 0.13)],
      big: true,
    },
  ];
  const count = Math.round(Math.min(34, 6 + 3 * captured) * rand.range(0.8, 1.2));
  for (let i = 0; i < count; i++) {
    const forward = rand() < 0.8;
    const angle = forward ? dir + gauss(rand) * 0.45 : rand() * Math.PI * 2;
    const dist = reach * Math.pow(rand(), 0.7);
    const r = (0.005 + 0.032 * Math.pow(rand(), 3)) * (1 + captured / 9);
    const at = {
      x: clamp(end.x + Math.cos(angle) * dist, 0.15, 8.85),
      y: clamp(end.y + Math.sin(angle) * dist, 0.15, 8.85),
    };
    drops.push({ at, r, tail: 2.5 * rand() * (dist / reach), angle, lobes: [rand.int(3, 6), rand(), rand.range(0.03, 0.12)], big: r > 0.02 });
  }
  return drops;
}

// A drop of paint: round with an irregular edge, stretched into a tail pointing back the way it flew.
function dropOutline(d: Drop, scale: number): Pt[] {
  const [lobes, phase, amount] = d.lobes;
  const back = d.angle + Math.PI;
  return Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const toward = Math.max(0, Math.cos(a - back));
    // Two uneven ripples, so the edge is irregular rather than cog-like.
    const ripple = Math.sin(lobes * a + phase * 6.28) + 0.6 * Math.sin((2 * lobes + 1) * a + phase * 11.3);
    const r = d.r * scale * (1 + amount * ripple + d.tail * Math.pow(toward, 6));
    return { x: d.at.x + Math.cos(a) * r, y: d.at.y + Math.sin(a) * r };
  });
}

export const brushStrokes: ArtStyle<BrushMark> = {
  id: "brush-strokes",
  name: "Brush Strokes",
  buildScene(game, { theme, palette }) {
    const shapes = game.moves.map((move, index): BrushMark => {
      const rand = seeded(hashString(`brush:${index}:${move.from}${move.to}:${move.san}`));
      const capture = move.kind === "capture";
      const captured = move.captured ? PIECE_VALUE[move.captured] : 0;
      const brush: Brush = capture
        ? "slash"
        : pick<Brush>(rand, [
            ["flat", 1.5],
            ["round", 3],
            ["filbert", 3.5],
            ["dry", 2],
          ]);
      let width = (0.065 + 0.03 * PIECE_VALUE[move.piece]) * rand.range(0.85, 1.15);
      if (capture) width *= 1.2 + 0.06 * captured;
      const load = brush === "dry" ? rand.range(0.4, 0.6) : capture ? rand.range(0.85, 1) : rand.range(0.5, 0.9);
      const end = rand.range(0.86, 0.97);
      const dry = clamp(end - (0.12 + (1 - load) * 0.5) * rand.range(0.8, 1.2), 0.3, end - 0.04);
      const path = new StrokePath(
        squareCenter(move.from),
        squareCenter(move.to),
        // Played with intent: one committed line. Captures strike dead straight.
        capture ? decisiveShape(rand, 0.025, 0.7) : decisiveShape(rand, 0.09, 0.3),
      );
      const base = { width, dry, end, brush };
      const m: BrushMark = {
        index,
        kind: move.kind,
        side: move.side,
        piece: move.piece,
        path,
        brush,
        width,
        load,
        attack: rand.range(0.03, 0.1),
        // A long lift-off: confident and loaded at the start, fast and dry at the finish.
        release: rand.range(Math.max(dry - 0.25, 0.3), end - 0.1),
        swell: capture ? rand.range(0.06, 0.16) : rand.range(-0.03, 0.1),
        rough: brush === "dry" ? rand.range(0.04, 0.07) : rand.range(0.012, 0.04),
        wobble: [rand.range(1, 3), rand.range(4, 9), rand(), rand()],
        pressure: [rand.range(0.5, 1.2), rand(), rand.range(0, 0.03)],
        dry,
        end,
        passes: Array.from({ length: rand.int(2, 4) }, () => ({
          offset: rand.range(-0.22, 0.22),
          scale: rand.range(0.4, 0.85),
          alpha: rand.range(0.16, 0.38) * load,
          from: rand.range(0, 0.25),
          to: rand.range(dry - 0.1, end),
        })),
        bristles: planBristles(rand, base),
        hairs: Array.from({ length: rand.int(1, 5) }, () => ({
          side: rand.sign(),
          at: rand.range(0.08, end),
          length: rand.range(0.04, 0.16),
          lean: rand.range(0.1, 0.5),
        })),
        drops: capture ? planSplatter(rand, path, width, captured) : [],
        stops: stopsFor(move, palette),
        edge: rand.range(0.05, 0.16),
      };
      return m;
    });
    return { style: this, theme, palette, shapes };
  },

  paint(mark, rect, t) {
    if (t <= 0) return [];
    const px = (p: Pt) => toPx(rect, p);
    const k = rect.size / 9;
    const [c0, c1] = mark.stops;
    const mid = mix(c0, c1, 0.5);
    const reach = Math.min(t, mark.end);
    const from = px(mark.path.from);
    const to = px(mark.path.to);
    // Paint thins out as the brush runs dry.
    const fading: GradientStops = [
      [0, c0, 1],
      [mark.dry, mid, 1],
      [mark.end, c1, 0.35 + 0.4 * mark.load],
      [1, c1, 0.2],
    ];
    const paint = { kind: "linear" as const, from, to, stops: fading };
    const solid = { kind: "linear" as const, from, to, stops: [[0, c0], [1, c1]] as GradientStops };
    const ops: PaintOp[] = [];

    const body = new PathBuilder(px).curve(outline(mark, 0, reach), true).toString();
    ops.push({ d: body, fill: paint, opacity: 0.42 + 0.4 * mark.load });
    for (const pass of mark.passes) {
      const end = Math.min(reach, pass.to);
      if (end <= pass.from + 0.02) continue;
      ops.push({
        d: new PathBuilder(px).curve(outline(mark, pass.from, end, pass.offset, pass.scale), true).toString(),
        fill: paint,
        opacity: pass.alpha,
      });
    }
    // Wet paint pools at its edges.
    ops.push({ d: body, stroke: darken(mid, 0.3), width: Math.max(0.5, 0.012 * mark.width * k), opacity: mark.edge });

    const groups = new Map<string, { path: PathBuilder; width: number; b: Bristle }>();
    for (const b of mark.bristles) {
      const key = `${b.tone}${b.group}`;
      const g = groups.get(key) ?? { path: new PathBuilder(px), width: 0, b };
      for (const [s0, s1] of b.segments) {
        const s1t = Math.min(s1, t);
        if (s1t > s0 + 0.008) g.path.line(bristleLine(mark, b, s0, s1t));
      }
      g.width = Math.max(g.width, b.width);
      groups.set(key, g);
    }
    for (const { path, width, b } of groups.values()) {
      if (path.empty) continue;
      ops.push({
        d: path.toString(),
        stroke: b.tone === "paint" ? solid : b.tone === "light" ? lighten(mid, 0.55) : darken(mid, 0.42),
        width: width * mark.width * k * (b.group ? 0.65 : 1),
        opacity: b.tone === "paint" ? (b.group ? 0.85 : 0.55) * (0.6 + 0.4 * mark.load) : b.tone === "light" ? 0.18 : 0.26,
        cap: "round",
      });
    }

    // Frayed hairs escaping the edge.
    const hairs = new PathBuilder(px);
    for (const h of mark.hairs) {
      if (h.at > reach) continue;
      const p = mark.path.at(h.at);
      const { t: dir, n } = mark.path.frame(h.at);
      const w = (mark.width * profile(mark, h.at)) / 2;
      const root = offset(p, n, h.side * w * 0.85);
      const tip = offset(offset(root, dir, h.length), n, h.side * h.lean * w);
      hairs.M(root).Q(offset(offset(root, dir, h.length * 0.6), n, h.side * h.lean * w * 0.2), tip);
    }
    if (!hairs.empty) ops.push({ d: hairs.toString(), stroke: solid, width: Math.max(0.5, 0.012 * mark.width * k * 3), opacity: 0.5 });

    // Splatter lands as the strike arrives.
    const impact = clamp((t - 0.88) / 0.12);
    if (mark.drops.length && impact > 0) {
      const big = new PathBuilder(px);
      const small = new PathBuilder(px);
      for (const d of mark.drops) (d.big ? big : small).curve(dropOutline(d, impact), true);
      if (!big.empty) {
        ops.push({ d: big.toString(), fill: c1, opacity: 0.92 });
        ops.push({ d: big.toString(), stroke: darken(c1, 0.3), width: Math.max(0.5, 0.004 * k), opacity: 0.3 });
      }
      if (!small.empty) ops.push({ d: small.toString(), fill: c1, opacity: 0.78 });
    }
    return ops;
  },
};
