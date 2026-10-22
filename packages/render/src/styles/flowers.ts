import { darken, lighten, mix } from "../color";
import type { PieceType } from "../game";
import type { Pt } from "../geometry";
import { PathBuilder, type GradientStops, type PaintOp } from "../paint";
import { gauss } from "../paths";
import type { Random } from "../random";

// Pressed Flowers: one real species per piece, each chosen for a reason (see FLOWER_KEY), each with a
// silhouette nothing else shares, and sized by the piece: a pawn's sprig is tiny, a king's sunflower
// dominates its square. Every petal and floret is planned individually when the scene is built, so
// each specimen is unique but identical from frame to frame. Heads are drawn in a local frame:
// u along the way the flower faces, v across it, in board units.

export const FLOWER_KEY: Record<PieceType, { name: string; latin: string; reason: string }> = {
  p: {
    name: "Forget-me-not",
    latin: "Myosotis",
    reason: "A flower of remembrance that grows in multitudes. Pawns are the many, the first to fall, and the ones to remember.",
  },
  n: {
    name: "Larkspur",
    latin: "Delphinium",
    reason: "In German it is Rittersporn, the knight's spur. Each floret's spur hooks back on itself, like the knight's L-shaped leap.",
  },
  b: {
    name: "Tulip",
    latin: "Tulipa",
    reason: "Its name comes from the Persian word for turban, and its closed cup has the profile of a bishop's mitre.",
  },
  r: {
    name: "Daisy",
    latin: "Bellis perennis",
    reason: "Its petals run out in straight lines from the centre, like the rook's files and ranks. Hardy and dependable, it is always there.",
  },
  q: {
    name: "Rose",
    latin: "Rosa",
    reason: "The queen of flowers since antiquity, a title traditionally credited to Sappho. The most powerful and the most celebrated.",
  },
  k: {
    name: "Sunflower",
    latin: "Helianthus annuus",
    reason: "The young sunflower turns to follow the sun. On the board, everything turns on the king.",
  },
};

// Which flower each piece becomes, for legends.
export const flowerNames = Object.fromEntries(Object.entries(FLOWER_KEY).map(([p, f]) => [p, f.name])) as Record<PieceType, string>;

// How big each piece's flower is drawn: a clear step up from pawn to king.
export const FLOWER_SCALE: Record<PieceType, number> = { p: 0.85, n: 1.05, b: 1.05, r: 1.15, q: 1.55, k: 1.6 };

export interface PetalPlan {
  phi: number; // direction from the centre of its flower
  len: number;
  width: number; // max half-width
  tint: number; // -1 … 1: darker … lighter than its base colour
  wave: [freq: number, phase: number, amount: number]; // edge ripple
  skew: number; // one side wider: a petal folded slightly when pressed
  notch: number; // depth of a notch at the tip (daisy rays), 0 for none
}

// A small flower within a head (forget-me-not sprigs, larkspur spikes): offset from the head centre.
export interface Floret {
  u: number;
  v: number;
  size: number;
  rot: number;
  petals: PetalPlan[];
  bud: boolean;
}

export interface HeadPlan {
  species: PieceType;
  size: number; // per-specimen variation on top of FLOWER_SCALE
  petals: PetalPlan[][]; // groups drawn back to front
  florets: Floret[];
  stalk: number; // larkspur spike length
  disc: number; // radius of a daisy or sunflower centre
  seeds: number;
  age: number; // 0 … 1 browning
  twist: number;
}

export interface HeadColors {
  inner: string;
  outer: string;
}

type At = (u: number, v: number) => Pt;
type Shape = (t: number) => number;

const TAU = Math.PI * 2;
const AGED = "#8B6B3D";

function petal(
  rand: Random,
  phi: number,
  len: number,
  width: number,
  opts: { wave?: number; freq?: [number, number]; skew?: number; notch?: number } = {},
): PetalPlan {
  const [f0, f1] = opts.freq ?? [1, 3];
  return {
    phi,
    len: len * rand.range(0.88, 1.12),
    width: width * rand.range(0.88, 1.12),
    tint: rand.range(-1, 1),
    wave: [rand.range(f0, f1), rand(), (opts.wave ?? 0.06) * rand.range(0.6, 1.4)],
    skew: (opts.skew ?? 0.08) * rand.range(-1, 1),
    notch: opts.notch ? opts.notch * rand.range(0.5, 1.3) : 0,
  };
}

// A ring of petals, with jittered spacing and the odd one lost in pressing.
function ring(rand: Random, count: number, twist: number, len: number, width: number, opts: Parameters<typeof petal>[4] & { jitter?: number; lose?: number } = {}) {
  const out: PetalPlan[] = [];
  for (let i = 0; i < count; i++) {
    const p = petal(rand, twist + (i * TAU) / count + gauss(rand) * (opts.jitter ?? 0.05), len, width, opts);
    if (rand() >= (opts.lose ?? 0)) out.push(p);
  }
  return out;
}

export function planHead(species: PieceType, rand: Random): HeadPlan {
  const twist = rand() * TAU;
  const plan: HeadPlan = { species, size: rand.range(0.85, 1.15), petals: [], florets: [], stalk: 0, disc: 0, seeds: 0, age: Math.pow(rand(), 2) * 0.7, twist };
  switch (species) {
    case "p": {
      // Forget-me-not: a little sprig of one to four florets on short stalks, with a bud or two.
      const count = [1, 2, 2, 3, 3, 4][rand.int(0, 5)]!;
      for (let i = 0; i < count; i++) {
        const a = i === 0 ? 0 : rand.sign() * rand.range(0.5, 1.3);
        const r = i === 0 ? 0 : rand.range(0.09, 0.13);
        const rot = rand() * TAU;
        plan.florets.push({ u: Math.cos(a) * r, v: Math.sin(a) * r, size: rand.range(0.8, 1.1), rot, petals: ring(rand, 5, rot, 0.064, 0.042, { wave: 0.05 }), bud: false });
      }
      for (let i = 0; i < rand.int(0, 2); i++) {
        plan.florets.push({ u: rand.range(0.1, 0.15), v: rand.range(-0.07, 0.07), size: rand.range(0.7, 1), rot: 0, petals: [], bud: true });
      }
      break;
    }
    case "n": {
      // Larkspur: open spurred florets up a spike, closed buds at the tip.
      plan.stalk = rand.range(0.42, 0.6);
      const open = rand.int(4, 8);
      const buds = rand.int(2, 5);
      let side = rand.sign();
      for (let i = 0; i < open + buds; i++) {
        const f = i / (open + buds - 1);
        const bud = i >= open;
        plan.florets.push({
          u: 0.07 + (plan.stalk - 0.07) * f,
          v: bud ? side * 0.012 : side * rand.range(0.03, 0.05) * (1 - 0.5 * f),
          size: (1 - 0.5 * f) * rand.range(0.9, 1.1),
          rot: rand() * TAU,
          petals: bud ? [] : ring(rand, 5, rand() * TAU, 0.05, 0.03, { jitter: 0.08 }),
          bud,
        });
        side = side === 1 ? -1 : 1;
      }
      break;
    }
    case "b": {
      // Tulip, side on: two tepals behind and one broad tepal in front. Some still closed, some
      // starting to flare. Tulips have no sepals.
      const open = Math.pow(rand(), 1.5) * 0.3;
      plan.petals = [
        [petal(rand, -0.2 - open + gauss(rand) * 0.03, 0.29, 0.075, { wave: 0.03 }), petal(rand, 0.2 + open + gauss(rand) * 0.03, 0.29, 0.075, { wave: 0.03 })],
        [petal(rand, gauss(rand) * 0.04, 0.31, 0.1 + open * 0.08, { wave: 0.03 })],
      ];
      break;
    }
    case "r": {
      // Daisy: slim notched white rays, tipped with colour, around a golden disc.
      plan.petals = [ring(rand, rand.int(18, 30), twist, 0.19, 0.022, { jitter: 0.07, notch: 0.06, wave: 0.06, lose: 0.06 })];
      plan.disc = rand.range(0.05, 0.06);
      plan.seeds = 40;
      break;
    }
    case "q": {
      // Rose: petals spiralling in by the golden angle, shrinking and deepening towards the heart.
      // Fewer petals make a looser, more open bloom.
      const n = rand.int(14, 26);
      const openness = rand.range(0.9, 1.15);
      const golden = Math.PI * (3 - Math.sqrt(5));
      const all = Array.from({ length: n }, (_, i) => {
        const f = i / n;
        return petal(rand, twist + i * golden, (0.03 + 0.2 * (1 - 0.8 * f)) * openness, 0.025 + 0.11 * (1 - 0.7 * f), { wave: 0.12, freq: [1.5, 3], skew: 0.15 });
      });
      const cut = (x: number) => Math.round(n * x);
      plan.petals = [all.slice(0, cut(0.35)), all.slice(cut(0.35), cut(0.7)), all.slice(cut(0.7))];
      break;
    }
    case "k": {
      // Sunflower: two rings of rays around a big seed head.
      plan.petals = [
        ring(rand, rand.int(20, 28), twist, 0.26, 0.042, { jitter: 0.06, skew: 0.15, lose: 0.05 }),
        ring(rand, rand.int(18, 24), twist + 0.13, 0.23, 0.04, { jitter: 0.06, skew: 0.15, lose: 0.05 }),
      ];
      plan.disc = rand.range(0.11, 0.13);
      plan.seeds = 150;
      break;
    }
  }
  return plan;
}

// Half-width along a petal, t = 0 at the base to 1 at the tip.
const SHAPES: Record<string, Shape> = {
  round: (t) => Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * t)), 0.55) * (0.65 + 0.45 * t), // forget-me-not
  broad: (t) => Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * t)), 0.5) * (0.55 + 0.55 * t), // rose
  cup: (t) => Math.pow(Math.sin(Math.PI * (0.03 + 0.94 * t)), 0.55) * (0.78 + 0.3 * t) * (1 - 0.25 * Math.pow(t, 6)), // tulip
  strap: (t) => Math.min(1, t * 6) * (t > 0.8 ? Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2)) : 1), // daisy ray
  lance: (t) => Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.3 * t), // sunflower ray, larkspur spur
  sepal: (t) => Math.pow(Math.sin(Math.PI * (0.05 + 0.95 * t)), 0.6), // larkspur sepal
};

function outline(p: PetalPlan, r0: number, shape: Shape, at: At, scale: number): Pt[] {
  const polar = (r: number, w: number) => at(r * Math.cos(p.phi) - w * Math.sin(p.phi), r * Math.sin(p.phi) + w * Math.cos(p.phi));
  const [f, ph, amount] = p.wave;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = (r0 + t * p.len) * scale;
    const w = p.width * shape(t) * scale;
    left.push(polar(r, w * (1 + amount * Math.sin(TAU * (f * t + ph))) * (1 + p.skew)));
    right.push(polar(r, -w * (1 + amount * Math.sin(TAU * (f * t + ph + 0.37))) * (1 - p.skew)));
  }
  const notch = p.notch ? [polar((r0 + p.len * (1 - p.notch)) * scale, 0)] : [];
  return [...left, ...notch, ...right.reverse()];
}

function veins(path: PathBuilder, p: PetalPlan, r0: number, at: At, count: number, scale: number, reach = 0.85) {
  const polar = (r: number, w: number) => at(r * Math.cos(p.phi) - w * Math.sin(p.phi), r * Math.sin(p.phi) + w * Math.cos(p.phi));
  for (let j = 0; j < count; j++) {
    const v = count === 1 ? 0 : (j / (count - 1) - 0.5) * p.width * 1.15;
    path.M(polar((r0 + p.len * 0.05) * scale, 0)).Q(polar((r0 + p.len * 0.5) * scale, v * 0.55 * scale), polar((r0 + p.len * reach) * scale, v * scale));
  }
}

const tinted = (c: string, tint: number, amount = 0.1) => (tint > 0 ? lighten(c, tint * amount) : darken(c, -tint * amount));

export interface HeadSpec {
  center: Pt;
  angle: number;
  scale: number; // includes the bloom animation
  colors: HeadColors;
  px: (p: Pt) => Pt;
  k: number; // px per board unit
  shadow: boolean;
}

// A soft shadow of the given outlines, offset down-right as if lit from the top left.
export function shadowOp(outlines: Pt[][], spec: { px: (p: Pt) => Pt; k: number }, strength = 0.2): PaintOp {
  const path = new PathBuilder(spec.px);
  for (const o of outlines) path.curve(o.map((p) => ({ x: p.x + 0.01, y: p.y + 0.015 })), true);
  return { d: path.toString(), fill: "#4B3A28", opacity: strength, blur: Math.max(1, 0.012 * spec.k) };
}

interface LayerOpts {
  veins?: number;
  opacity?: number;
  at?: At;
  size?: number;
  tint?: number;
  reach?: number;
  rim?: number;
  stops?: (c: string) => GradientStops; // override the default heart → petal → tip gradient
}

export function drawHead(plan: HeadPlan, spec: HeadSpec): PaintOp[] {
  const { center, angle, colors, px, k } = spec;
  const scale = spec.scale * FLOWER_SCALE[plan.species] * plan.size;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at: At = (u, v) => ({ x: center.x + u * cos - v * sin, y: center.y + u * sin + v * cos });
  // A sub-frame for florets: centred at (u0, v0) in the head frame and rotated by rot. It only
  // positions; petal sizes are scaled by the `size` passed to layer().
  const sub = (u0: number, v0: number, rot: number): At => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return (u, v) => at(u0 * scale + (u * c - v * s), v0 * scale + (u * s + v * c));
  };
  const age = (c: string) => mix(c, AGED, plan.age * 0.45);
  const thin = (w: number) => Math.max(0.4, w * scale * k);
  const ops: PaintOp[] = [];
  const shapes: Pt[][] = [];
  const { inner, outer } = colors;

  // Petals of one layer: individually tinted translucent fills, then shared rims and veins.
  const layer = (ps: PetalPlan[], r0: number, shape: Shape, base: string, heart: string, opts: LayerOpts = {}) => {
    const frame = opts.at ?? at;
    const size = opts.size ?? scale;
    const origin = px(frame(0, 0));
    const rims = new PathBuilder(px);
    const lines = new PathBuilder(px);
    for (const p of ps) {
      const o = outline(p, r0, shape, frame, size);
      shapes.push(o);
      const c = tinted(base, p.tint, opts.tint ?? 0.1);
      const stops: GradientStops = opts.stops?.(c) ?? [
        [0, heart],
        [0.4, c],
        [1, age(lighten(c, 0.05))],
      ];
      const d = new PathBuilder(px).curve(o, true).toString();
      ops.push({ d, fill: { kind: "radial", center: origin, radius: (r0 + p.len) * size * k, stops }, opacity: opts.opacity ?? 0.84 });
      rims.curve(o, true);
      if (opts.veins) veins(lines, p, r0, frame, opts.veins, size, opts.reach);
    }
    ops.push({ d: rims.toString(), stroke: darken(base, 0.35), width: thin(0.004), opacity: (opts.rim ?? 0.22) + plan.age * 0.25 });
    if (opts.veins) ops.push({ d: lines.toString(), stroke: darken(base, 0.24), width: thin(0.0028), opacity: 0.24 });
  };

  const disc = (r: number, colorsOf: { inner: string; outer: string; rim: string; seed: string; pollen: string }) => {
    const path = new PathBuilder(px).ellipse(center, r * scale, r * scale * 0.97, angle);
    shapes.push(Array.from({ length: 12 }, (_, i) => at(Math.cos((i / 12) * TAU) * r * scale, Math.sin((i / 12) * TAU) * r * scale)));
    const seeds = new PathBuilder(px);
    const rimSeeds = new PathBuilder(px);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 1; i <= plan.seeds; i++) {
      const rr = r * 0.92 * Math.sqrt(i / plan.seeds);
      const a = i * golden + plan.twist;
      const dot = (0.004 + 0.003 * (rr / r)) * (r / 0.12) ** 0.5;
      (rr > r * 0.72 ? rimSeeds : seeds).ellipse(at(rr * Math.cos(a) * scale, rr * Math.sin(a) * scale), dot * scale, dot * scale);
    }
    ops.push(
      { d: path.toString(), fill: { kind: "radial", center: px(center), radius: r * scale * k, stops: [[0, colorsOf.inner], [0.75, colorsOf.outer], [1, colorsOf.rim]] }, opacity: 0.96 },
      { d: seeds.toString(), fill: colorsOf.seed, opacity: 0.55 },
      { d: rimSeeds.toString(), fill: colorsOf.pollen, opacity: 0.7 },
      { d: path.toString(), stroke: colorsOf.rim, width: thin(0.006), opacity: 0.5 },
    );
  };

  const eye = (c: Pt, r: number, fill: string, opacity = 0.9) =>
    ops.push({ d: new PathBuilder(px).ellipse(c, r, r).toString(), fill, opacity });

  switch (plan.species) {
    case "p": {
      const stalks = new PathBuilder(px);
      for (const f of plan.florets) if (f.u || f.v) stalks.M(at(0, 0)).L(at(f.u * scale, f.v * scale));
      if (!stalks.empty) ops.push({ d: stalks.toString(), stroke: "#6F8556", width: thin(0.006), opacity: 0.85 });
      for (const f of plan.florets) {
        const size = scale * f.size;
        const c = at(f.u * scale, f.v * scale);
        if (f.bud) {
          ops.push({ d: new PathBuilder(px).ellipse(c, 0.022 * size, 0.016 * size, angle).toString(), fill: mix(outer, "#E7B8C4", 0.4), opacity: 0.9 });
          continue;
        }
        layer(f.petals, 0.006, SHAPES.round!, outer, mix(inner, "#FFFFFF", 0.4), { at: sub(f.u, f.v, 0), size, veins: 3, opacity: 0.88, tint: 0.12 });
        eye(c, 0.024 * size, "#FBF3D2", 0.95); // the white ring
        eye(c, 0.013 * size, "#EBC23F", 0.95); // the yellow eye
      }
      break;
    }
    case "n": {
      ops.push({ d: new PathBuilder(px).M(at(0, 0)).L(at(plan.stalk * scale, 0)).toString(), stroke: "#6F8556", width: thin(0.009), opacity: 0.85 });
      const pedicels = new PathBuilder(px);
      for (const f of plan.florets) pedicels.M(at(f.u * scale * 0.94, 0)).L(at(f.u * scale, f.v * scale));
      ops.push({ d: pedicels.toString(), stroke: "#6F8556", width: thin(0.005), opacity: 0.8 });
      for (const f of plan.florets) {
        const size = scale * f.size;
        if (f.bud) {
          const bud = new PathBuilder(px).ellipse(at(f.u * scale, f.v * scale), 0.022 * size, 0.012 * size, angle + 0.15 * Math.sign(f.v));
          ops.push({ d: bud.toString(), fill: mix(outer, "#6F8556", 0.35), opacity: 0.9 });
          continue;
        }
        // The spur: a slim tube hooking back down the spike and away from the stalk.
        const spur: PetalPlan = { phi: 0, len: 0.06, width: 0.01, tint: 0, wave: [1, 0, 0], skew: 0, notch: 0 };
        layer([spur], 0.004, SHAPES.lance!, darken(outer, 0.1), darken(outer, 0.2), { at: sub(f.u, f.v, Math.atan2(Math.sign(f.v || 1) * 0.5, -1)), size, opacity: 0.85 });
        layer(f.petals, 0.004, SHAPES.sepal!, outer, lighten(inner, 0.15), { at: sub(f.u, f.v, f.rot), size, veins: 1, opacity: 0.86, tint: 0.14 });
        eye(at(f.u * scale, f.v * scale), 0.009 * size, darken(outer, 0.5), 0.75);
      }
      break;
    }
    case "b": {
      const [back, front] = plan.petals;
      const base = mix(inner, "#E9C46A", 0.4); // tulips warm towards the base
      layer(back!, 0, SHAPES.cup!, darken(outer, 0.14), base, { veins: 6, opacity: 0.9, reach: 0.95 });
      layer(front!, 0, SHAPES.cup!, outer, base, { veins: 8, opacity: 0.88, reach: 0.95 });
      break;
    }
    case "r": {
      // White rays blushing to the palette colour at the tips, as common daisies do.
      const cream = "#FBF7EC";
      const blush = mix(outer, cream, 0.35);
      layer(plan.petals[0]!, plan.disc * 0.8, SHAPES.strap!, cream, cream, {
        veins: 2,
        opacity: 0.9,
        rim: 0.18,
        stops: (c) => [
          [0, c],
          [0.6, c],
          [1, age(mix(blush, c, 0.5 + 0.25 * (c === cream ? 0 : 1)))],
        ],
      });
      disc(plan.disc, { inner: "#F6CB4E", outer: "#D99A26", rim: "#A56B12", seed: "#A86D12", pollen: "#F3D27A" });
      break;
    }
    case "q": {
      const [outerRing, middle, heart] = plan.petals;
      layer(outerRing!, 0.01, SHAPES.broad!, lighten(outer, 0.18), darken(outer, 0.05), { veins: 4, opacity: 0.84 });
      layer(middle!, 0.006, SHAPES.broad!, outer, darken(outer, 0.18), { veins: 3, opacity: 0.86, rim: 0.3 });
      layer(heart!, 0.003, SHAPES.broad!, darken(outer, 0.2), darken(outer, 0.35), { opacity: 0.9, rim: 0.4 });
      break;
    }
    case "k": {
      const [back, front] = plan.petals;
      layer(back!, plan.disc * 0.75, SHAPES.lance!, darken(outer, 0.12), darken(outer, 0.25), { veins: 3, opacity: 0.86 });
      layer(front!, plan.disc * 0.75, SHAPES.lance!, outer, darken(outer, 0.15), { veins: 3, opacity: 0.88 });
      disc(plan.disc, { inner: "#2A180B", outer: "#4E2F15", rim: "#24140A", seed: "#3B2414", pollen: "#B8862E" });
      break;
    }
  }
  return spec.shadow ? [shadowOp(shapes, spec), ...ops] : ops;
}

// Petal colours from a palette pair: the saturated end at the edge, a softer blend at the heart.
export function petalColors(stops: readonly [string, string]): HeadColors {
  return { inner: mix(stops[0], stops[1], 0.55), outer: stops[1] };
}
