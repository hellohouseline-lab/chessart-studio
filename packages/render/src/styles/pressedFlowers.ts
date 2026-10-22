import { darken, lighten, mix } from "../color";
import { squareCenter, type Pt } from "../geometry";
import { toPx } from "../layout";
import { PathBuilder, type PaintOp } from "../paint";
import { gauss, offset, stemShape, StrokePath } from "../paths";
import { hashString, seeded, type Random } from "../random";
import type { ArtStyle, Mark } from "../scene";
import { PIECE_VALUE } from "./brushStrokes";
import { stopsFor } from "./classicArcs";
import { drawHead, petalColors, planHead, shadowOp, type HeadColors, type HeadPlan } from "./flowers";
export { FLOWER_KEY, flowerNames } from "./flowers";

type LeafShape = "lance" | "oval" | "serrated";

interface Leaf {
  at: number; // position along the stem, 0 … 1
  side: 1 | -1;
  length: number; // board units
  width: number;
  tilt: number; // radians away from the stem
  shape: LeafShape;
  color: string;
  skew: number; // one half wider: leaves never press perfectly flat
  bend: number; // midrib curvature
  veins: number;
}

export interface FlowerMark extends Mark {
  stem: StrokePath;
  stemWidth: number; // at the base, board units
  stemColors: [base: string, tip: string];
  leaves: Leaf[];
  head: HeadPlan;
  colors: HeadColors;
  angle: number; // the way the flower faces
  size: number;
  shadow: boolean;
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Overshoots slightly before settling: a bloom opening.
const easeOutBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

const LEAF_GREENS = ["#5E7A45", "#6B8A4E", "#7C9A5C", "#566E3E", "#819C63"];

function planLeaves(rand: Random, length: number): Leaf[] {
  // Sparse foliage: the flowers should lead, with leaves as an accent rather than a vine.
  const count = length < 1.6 ? (rand() < 0.15 ? 1 : 0) : Math.min(3, Math.max(0, Math.round(length / 2.4 + rand.range(-0.6, 0.4))));
  const leaves: Leaf[] = [];
  let side: 1 | -1 = rand.sign();
  for (let i = 0; i < count; i++) {
    const shape: LeafShape = rand() < 0.45 ? "lance" : rand() < 0.6 ? "oval" : "serrated";
    leaves.push({
      at: clamp((i + 0.6 + gauss(rand) * 0.15) / (count + 0.6), 0.12, 0.78),
      side,
      length: rand.range(0.18, 0.34),
      width: shape === "oval" ? rand.range(0.065, 0.1) : rand.range(0.045, 0.075),
      tilt: rand.range(0.45, 0.95),
      shape,
      // Some leaves yellow a little as they dry.
      color: mix(LEAF_GREENS[rand.int(0, LEAF_GREENS.length - 1)]!, "#B8A15A", Math.pow(rand(), 3) * 0.6),
      skew: rand.range(-0.25, 0.25),
      bend: rand.range(-0.25, 0.25),
      veins: rand.int(3, 6),
    });
    if (rand() < 0.75) side = side === 1 ? -1 : 1;
  }
  return leaves;
}

const LEAF_SHAPES: Record<LeafShape, (t: number) => number> = {
  lance: (t) => Math.pow(Math.sin(Math.PI * t), 0.8) * (1 - 0.25 * t),
  oval: (t) => Math.pow(Math.sin(Math.PI * t), 0.55),
  serrated: (t) => Math.pow(Math.sin(Math.PI * t), 0.7) * (1 + 0.14 * Math.abs(Math.sin(Math.PI * 7 * t)) * Math.min(1, t * 4)),
};

// A leaf's outline and veins, in board units, grown to `open` (0 … 1).
function leafGeometry(stem: StrokePath, leaf: Leaf, open: number) {
  const base = stem.at(leaf.at);
  const dir = stem.angle(leaf.at) + leaf.side * leaf.tilt;
  const f = { x: Math.cos(dir), y: Math.sin(dir) };
  const n = { x: -f.y, y: f.x };
  const len = leaf.length * open;
  const axis = (t: number) => offset(offset(base, f, t * len), n, leaf.bend * len * Math.sin(Math.PI * t) * 0.3);
  const shape = LEAF_SHAPES[leaf.shape];
  const N = 12;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = leaf.width * open * shape(t);
    left.push(offset(axis(t), n, w * (1 + leaf.skew)));
    right.push(offset(axis(t), n, -w * (1 - leaf.skew)));
  }
  const rib = Array.from({ length: 7 }, (_, i) => axis((i / 6) * 0.9));
  const laterals: Array<[Pt, Pt, Pt]> = [];
  for (let j = 1; j <= leaf.veins; j++) {
    const t = j / (leaf.veins + 1);
    for (const s of [1, -1]) {
      const w = leaf.width * open * shape(t) * 0.8;
      const start = axis(t * 0.92);
      laterals.push([start, offset(axis(t + 0.06), n, s * w * 0.5), offset(axis(t + 0.14), n, s * w)]);
    }
  }
  return { outline: [...left, ...right.reverse()], rib, laterals, base, tip: axis(1) };
}

// The stem as a tapered ribbon from its base to `reach`.
function stemOutline(m: FlowerMark, reach: number): Pt[] {
  const ss = m.stem.samples(0, reach, 0.05);
  const w = (s: number) => (m.stemWidth * (1 - 0.45 * s)) / 2;
  const left = ss.map((s) => offset(m.stem.at(s), m.stem.frame(s).n, w(s)));
  const right = ss.map((s) => offset(m.stem.at(s), m.stem.frame(s).n, -w(s)));
  return [...left, ...right.reverse()];
}

// Animation: the stem grows over the first 60%, leaves unfurl as it passes them, the head blooms last.
export const pressedFlowers: ArtStyle<FlowerMark> = {
  id: "pressed-flowers",
  name: "Pressed Flowers",
  defaults: { theme: "paper", palette: "botanical" },
  buildScene(game, { theme, palette }) {
    const shapes = game.moves.map((move, index): FlowerMark => {
      const rand = seeded(hashString(`flower:${index}:${move.from}${move.to}:${move.san}`));
      const from = squareCenter(move.from);
      const to = squareCenter(move.to);
      const stem = new StrokePath(from, to, stemShape(rand));
      const fresh = theme.dark ? "#8DB074" : "#6E8F4E";
      return {
        index,
        kind: move.kind,
        side: move.side,
        piece: move.piece,
        stem,
        stemWidth: (0.017 + 0.005 * Math.sqrt(PIECE_VALUE[move.piece])) * rand.range(0.8, 1.2),
        stemColors: [mix(fresh, "#7A6A3A", rand.range(0.25, 0.55)), fresh],
        leaves: planLeaves(rand, Math.hypot(to.x - from.x, to.y - from.y)),
        head: planHead(move.piece, rand),
        colors: petalColors(stopsFor(move, palette)),
        angle: stem.angle(1) + rand.range(-0.3, 0.3),
        size: rand.range(0.9, 1.1),
        shadow: !theme.dark,
      };
    });
    return { style: this, theme, palette, shapes };
  },

  paint(mark, rect, t) {
    if (t <= 0) return [];
    const px = (p: Pt) => toPx(rect, p);
    const k = rect.size / 9;
    const ops: PaintOp[] = [];
    const shadows: Pt[][] = [];

    // Stem: a tapered ribbon, olive at the cut end and fresher green towards the flower.
    const grown = smooth(0, 0.6, t);
    const stem = stemOutline(mark, Math.max(0.01, grown));
    shadows.push(stem);
    const [base, tip] = mark.stemColors;
    const stemD = new PathBuilder(px).curve(stem, true).toString();
    const stemFill = { kind: "linear" as const, from: px(mark.stem.from), to: px(mark.stem.to), stops: [[0, base], [1, tip]] as Array<[number, string]> };
    const stemOps: PaintOp[] = [
      { d: stemD, fill: stemFill, opacity: 0.92 },
      { d: stemD, stroke: darken(base, 0.3), width: Math.max(0.4, 0.003 * k), opacity: 0.35 },
      {
        d: new PathBuilder(px).line(mark.stem.samples(0.03, Math.max(0.04, grown * 0.97), 0.08).map((s) => offset(mark.stem.at(s), mark.stem.frame(s).n, mark.stemWidth * 0.18))).toString(),
        stroke: lighten(tip, 0.35),
        width: Math.max(0.4, 0.004 * k),
        opacity: 0.35,
      },
    ];

    // Leaves: varied shapes and greens with a pale midrib and side veins, unfurling as the stem passes.
    const leafOps: PaintOp[] = [];
    for (const leaf of mark.leaves) {
      const open = clamp((grown - leaf.at) / 0.2);
      if (open <= 0) continue;
      const g = leafGeometry(mark.stem, leaf, open);
      shadows.push(g.outline);
      const d = new PathBuilder(px).curve(g.outline, true).toString();
      const veins = new PathBuilder(px);
      for (const [a, c, b] of g.laterals) veins.M(a).Q(c, b);
      leafOps.push(
        {
          d,
          fill: { kind: "linear", from: px(g.base), to: px(g.tip), stops: [[0, darken(leaf.color, 0.12)], [1, lighten(leaf.color, 0.1)]] },
          opacity: 0.9,
        },
        { d, stroke: darken(leaf.color, 0.3), width: Math.max(0.4, 0.003 * k), opacity: 0.3 },
        { d: new PathBuilder(px).curve(g.rib, false).toString(), stroke: lighten(leaf.color, 0.3), width: Math.max(0.4, 0.005 * k), opacity: 0.5 },
        { d: veins.toString(), stroke: lighten(leaf.color, 0.22), width: Math.max(0.3, 0.0025 * k), opacity: 0.4 },
      );
    }

    if (mark.shadow) ops.push(shadowOp(shadows, { px, k }, 0.16));
    ops.push(...stemOps, ...leafOps);

    // Head: blooms open at the destination, turning slightly as it unfurls.
    const bloom = t >= 1 ? 1 : clamp(easeOutBack(clamp((t - 0.5) / 0.5)), 0, 1.15);
    if (bloom > 0) {
      ops.push(
        ...drawHead(mark.head, {
          center: mark.stem.to,
          angle: mark.angle - (1 - Math.min(1, bloom)) * 0.6,
          scale: mark.size * bloom,
          colors: mark.colors,
          px,
          k,
          shadow: mark.shadow,
        }),
      );
    }
    return ops;
  },
};
