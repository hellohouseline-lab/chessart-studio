import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { buildScene, classicGames, flowerNames, parseGame, sceneToSVG, squareCenter, styles, type Scene } from "../src/index";
import { brushStrokes, PIECE_WIDTH, type BrushMark } from "../src/styles/brushStrokes";
import type { FlowerMark } from "../src/styles/pressedFlowers";
import { FLOWER_SCALE } from "../src/styles/flowers";

const game = parseGame(classicGames["Game of The Century"]!);
const size = 900;
const rect = { x: 0, y: 0, size };
const numbers = (d: string) => [...d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));

describe.each(styles.map((s) => [s.id, s] as const))("%s", (id, style) => {
  const scene = buildScene(game, { style: id, ...style.defaults });

  // Path data includes curve control points, which can sit outside what's drawn: a king's arc on
  // the h-file puts its control point at 9.5 of 9 units while the curve itself peaks at 8.75.
  const margin = 0.06 * size;

  it("draws every move, inside the frame", () => {
    expect(scene.shapes).toHaveLength(game.moves.length);
    scene.shapes.forEach((mark, i) => {
      const ops = style.paint(mark, rect, 1, scene);
      expect(ops.length, `move ${i + 1}`).toBeGreaterThan(0);
      const vs = ops.flatMap((op) => numbers(op.d));
      const lo = Math.min(...vs);
      const hi = Math.max(...vs);
      expect(lo, `move ${i + 1} (${game.moves[i]!.san}) min`).toBeGreaterThan(-margin);
      expect(hi, `move ${i + 1} (${game.moves[i]!.san}) max`).toBeLessThan(size + margin);
    });
  });

  it("draws nothing before a move starts", () => {
    expect(style.paint(scene.shapes[0]!, rect, 0, scene)).toEqual([]);
  });

  it("is identical every time (no frame-to-frame shimmer)", () => {
    const again = buildScene(game, { style: id, ...style.defaults });
    const svg = (s: typeof scene) => sceneToSVG(s, { width: size, height: size, rect, progress: 30.4 });
    expect(svg(again)).toBe(svg(scene));
  });

  // Pressed Flowers takes a few seconds in resvg, more on CI runners.
  it("renders as SVG through resvg (the print path)", () => {
    const svg = sceneToSVG(scene, { width: size, height: size, rect });
    const image = new Resvg(svg).render();
    expect(image.width).toBe(size);
    expect(image.height).toBe(size);
  }, 30_000);
});

describe("pressed flowers", () => {
  const scene = buildScene(game, { style: "pressed-flowers" });
  const style = scene.style;

  it("grows the stem before the flower blooms", () => {
    const early = style.paint(scene.shapes[0]!, rect, 0.3, scene);
    const done = style.paint(scene.shapes[0]!, rect, 1, scene);
    expect(early.length).toBeLessThan(done.length);
  });

  it("gives every piece its own flower", () => {
    expect(new Set(Object.values(flowerNames)).size).toBe(6);
  });
});

describe("brush strokes: weight and power", () => {
  const scene = buildScene(game, { style: "brush-strokes" });
  const marks = scene.shapes as BrushMark[];
  const avgWidth = (piece: string, kind = "normal") => {
    const ws = marks.filter((m) => m.piece === piece && m.kind === kind).map((m) => m.width);
    return ws.reduce((a, b) => a + b, 0) / ws.length;
  };

  // King thickest, then queen, rook, bishop and knight, pawns thinnest: every stroke of a rank is
  // wider than every stroke below it, captures and castling rooks included.
  it.each(Object.keys(classicGames))("paints by rank in %s", (name) => {
    const rank = { p: 0, n: 1, b: 1, r: 2, q: 3, k: 4 } as const;
    const all = (buildScene(parseGame(classicGames[name]!), { style: "brush-strokes" }).shapes as BrushMark[]).flatMap((m) =>
      m.rook ? [m, m.rook] : [m],
    );
    for (let r = 1; r <= 4; r++) {
      const above = all.filter((m) => rank[m.piece] >= r).map((m) => m.width);
      const below = all.filter((m) => rank[m.piece] < r).map((m) => m.width);
      expect(Math.min(...above), `rank ${r} and up vs below`).toBeGreaterThan(Math.max(...below));
    }
  });

  it("paints bishops and knights alike", () => {
    expect(PIECE_WIDTH.b).toBe(PIECE_WIDTH.n);
    expect(avgWidth("b") / avgWidth("n")).toBeCloseTo(1, 1);
  });

  it("makes a capture a little heavier than the same piece's quiet moves", () => {
    for (const piece of ["p", "n", "b", "q"]) expect(avgWidth(piece, "capture"), piece).toBeGreaterThan(avgWidth(piece));
  });

  it("splatters only on captures, more for bigger prizes", () => {
    expect(marks.filter((m) => m.kind !== "capture").every((m) => m.drops.length === 0)).toBe(true);
    const captures = marks.filter((m) => m.kind === "capture");
    expect(captures.every((m) => m.drops.length > 0)).toBe(true);
    const byPrize = (p: string) => captures.filter((m) => game.moves[m.index]!.captured === p).map((m) => m.drops.length);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(byPrize("q"))).toBeGreaterThan(avg(byPrize("p")));
  });

  it("varies from stroke to stroke", () => {
    const pawns = marks.filter((m) => m.piece === "p" && m.kind === "normal");
    expect(new Set(pawns.map((m) => m.brush)).size).toBeGreaterThan(1);
    expect(new Set(pawns.map((m) => m.width)).size).toBe(pawns.length);
  });
});

// Strokes are played with intent and stems press flat: no wobble, at most one shallow bend.
describe("decisive lines", () => {
  const deviation = (path: { from: { x: number; y: number }; to: { x: number; y: number }; at(s: number): { x: number; y: number } }) => {
    const { from, to } = path;
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    let max = 0;
    for (let i = 1; i < 40; i++) {
      const p = path.at(i / 40);
      max = Math.max(max, Math.abs((to.x - from.x) * (from.y - p.y) - (from.x - p.x) * (to.y - from.y)) / len);
    }
    return max / len;
  };

  it("keeps brush strokes to a shallow bend, captures dead straight", () => {
    for (const m of buildScene(game, { style: "brush-strokes" }).shapes as BrushMark[]) {
      expect(deviation(m.path), game.moves[m.index]!.san).toBeLessThan(m.kind === "capture" ? 0.025 : 0.08);
    }
  });

  it("gives flower stems a gentle natural curve, never a loop", () => {
    const devs = (buildScene(game, { style: "pressed-flowers" }).shapes as FlowerMark[]).map((m) => deviation(m.stem));
    for (const d of devs) expect(d).toBeLessThan(0.13);
    // …and not ruler-straight either: most stems bend a little.
    expect(devs.filter((d) => d > 0.02).length).toBeGreaterThan(devs.length / 2);
  });

  it("sizes flowers by piece, from the pawn's sprig up to the king's sunflower", () => {
    const order = ["p", "n", "r", "q", "k"] as const;
    order.slice(1).forEach((piece, i) => expect(FLOWER_SCALE[piece]).toBeGreaterThan(FLOWER_SCALE[order[i]!]));
  });
});

describe("brush strokes", () => {
  it("lengthens the stroke as it sweeps", () => {
    const scene = buildScene(game, { style: "brush-strokes" });
    const body = (t: number) => scene.style.paint(scene.shapes[5]!, rect, t, scene)[0]!.d;
    const span = (d: string) => {
      const xs = numbers(d).filter((_, i) => i % 2 === 0);
      const ys = numbers(d).filter((_, i) => i % 2 === 1);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    };
    expect(span(body(0.3))).toBeLessThan(span(body(1)));
  });
});

describe("brush strokes: castling", () => {
  const castles = Object.values(classicGames).flatMap((pgn) => {
    const scene = buildScene(parseGame(pgn), { style: "brush-strokes" });
    return (scene.shapes as BrushMark[]).filter((m) => m.kind === "castle").map((mark) => ({ scene, mark }));
  });

  it("paints the rook's move with the king's, in the castle colour", () => {
    expect(castles.length).toBeGreaterThan(1);
    for (const { scene, mark } of castles) {
      const kingside = mark.path.to.x > mark.path.from.x;
      const rank = mark.path.from.y;
      expect(mark.piece).toBe("k");
      expect(mark.rook?.piece).toBe("r");
      // h→f or a→d, on the king's rank
      expect(mark.rook!.path.from).toEqual({ x: squareCenter(kingside ? "h1" : "a1").x, y: rank });
      expect(mark.rook!.path.to).toEqual({ x: squareCenter(kingside ? "f1" : "d1").x, y: rank });
      expect(mark.stops).toEqual(scene.palette.castle);
      expect(mark.rook!.stops).toEqual(scene.palette.castle);
      expect(mark.rook!.width).toBeLessThan(mark.width);
    }
  });

  it("paints two strokes as the move sweeps, the king's on top", () => {
    const { scene, mark } = castles[0]!;
    const paint = (m: BrushMark, t: number) => brushStrokes.paint(m, rect, t, scene as Scene<BrushMark>);
    for (const t of [0.5, 1]) {
      const king = paint({ ...mark, rook: undefined }, t);
      const both = paint(mark, t);
      const rook = paint(mark.rook!, t);
      expect(rook.length).toBeGreaterThan(0);
      expect(both).toEqual([...rook, ...king]);
    }
  });
});
