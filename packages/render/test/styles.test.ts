import { Resvg } from "@resvg/resvg-js";
import { describe, expect, it } from "vitest";
import { buildScene, classicGames, flowerNames, parseGame, sceneToSVG, styles } from "../src/index";
import type { BrushMark } from "../src/styles/brushStrokes";
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

  it("renders as SVG through resvg (the print path)", () => {
    const svg = sceneToSVG(scene, { width: size, height: size, rect });
    const image = new Resvg(svg).render();
    expect(image.width).toBe(size);
    expect(image.height).toBe(size);
  });
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

  it("makes heavier pieces paint thicker strokes", () => {
    expect(avgWidth("q")).toBeGreaterThan(avgWidth("r"));
    expect(avgWidth("r")).toBeGreaterThan(avgWidth("n"));
    expect(avgWidth("n")).toBeGreaterThan(avgWidth("p"));
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
