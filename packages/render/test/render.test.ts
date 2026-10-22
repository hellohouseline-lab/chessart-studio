import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildScene,
  gameIdOf,
  parseClock,
  parseGame,
  partialLens,
  sceneToSVG,
  splitPgns,
  type LensShape,
  stripVariations,
} from "../src/index";
import { classicGames as classics } from "../src/classics";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseGame", () => {
  it("reads moves, tags and result", () => {
    const game = parseGame(classics["The Immortal Game"]!);
    expect(game.moves).toHaveLength(45);
    expect(game.tags.White).toBe("Adolf Anderssen");
    expect(game.result).toBe("1-0");
    expect(game.moves[2]).toMatchObject({ san: "f4", from: "f2", to: "f4", piece: "p", side: "w", kind: "normal" });
    expect(game.moves[3]).toMatchObject({ san: "exf4", kind: "capture", side: "b" });
  });

  it("marks castling by flag, not SAN text", () => {
    const evergreen = parseGame(classics["Evergreen Game"]!);
    expect(evergreen.moves[12]).toMatchObject({ san: "O-O", kind: "castle", piece: "k", from: "e1", to: "g1" });
    const opera = parseGame(classics["The Opera Game"]!);
    expect(opera.moves.find((m) => m.san === "O-O-O")).toMatchObject({ kind: "castle", from: "e1", to: "c1" });
  });

  it("drops variations but keeps comments", () => {
    const pgn = "1. e4 (1. d4 d5 (1... Nf6)) 1... e5 {a (bracketed) note [%clk 0:05:00]} 2. Nf3 *";
    expect(stripVariations(pgn)).not.toContain("d4");
    const game = parseGame(pgn);
    expect(game.moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(game.moves[1]!.clock).toBe(300);
  });

  it("derives the result from checkmate when the tag is missing", () => {
    expect(parseGame("1. f3 e5 2. g4 Qh4#").result).toBe("0-1");
  });
});

describe("Lichess broadcast PGN", () => {
  const games = splitPgns(fixture("broadcast-round.pgn"));

  it("splits a round into games", () => {
    expect(games).toHaveLength(90);
  });

  it("parses clocks and game ids", () => {
    const game = parseGame(games[0]!);
    expect(gameIdOf(game.tags)).toBe("4dEqgzBB");
    expect(game.moves).toHaveLength(27);
    expect(game.moves[0]!.clock).toBe(1 * 3600 + 30 * 60 + 23);
    expect(game.moves[1]!.clock).toBe(1 * 3600 + 30 * 60 + 48);
    expect(game.result).toBe("*");
  });

  it("parses finished games carrying Lichess analysis comments", () => {
    const finished = splitPgns(fixture("broadcast-round-finished.pgn"));
    expect(finished).toHaveLength(90);
    const parsed = finished.map((pgn) => parseGame(pgn));
    const game = parsed.find((g) => gameIdOf(g.tags) === "5NPUQVEb")!;
    expect(game.moves).toHaveLength(205);
    expect(game.result).toBe("1-0");
    // 28. Be3?! { [%eval -0.15] } { Inaccuracy. g3 was best. } { [%clk 0:11:21] }
    expect(game.moves[54]).toMatchObject({ san: "Be3", clock: 11 * 60 + 21 });
  });

  it("parses clock comments", () => {
    expect(parseClock("[%clk 0:00:09.5]")).toBe(9.5);
    expect(parseClock("no clock")).toBeUndefined();
  });
});

describe("partialLens", () => {
  const p0 = { x: 5, y: 7 };
  const p2 = { x: 5, y: 5 };
  const c = { x: 5.5, y: 6 };

  it("is the full lens at t = 1", () => {
    const part = partialLens(p0, c, p2, 1);
    expect(part.tip).toEqual(p2);
    expect(part.chord).toEqual(p2);
    expect(part.q).toEqual(c);
  });

  it("cuts perpendicular to the move halfway through", () => {
    const part = partialLens(p0, c, p2, 0.5);
    expect(part.chord).toEqual({ x: 5, y: 6 });
    expect(part.tip.y).toBeCloseTo(6);
    expect(part.tip.x).toBeCloseTo(5.25);
  });
});

// The original print SVGs were drawn on a 120px grid with the same construction,
// so every arc must land on exactly the same points with the same colours.
describe("matches the original print artwork", () => {
  const PATH_RE = /<path fill="url\(#(\w+)\)"[^>]* d=" M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/g;

  for (const [name, pgn] of Object.entries(classics)) {
    it(name, () => {
      const svg = fixture(`${name}.svg`);
      const stops = new Map<string, string[]>();
      for (const [, id, body] of svg.matchAll(/<linearGradient id="(\w+)"[^>]*>(.*?)<\/linearGradient>/g)) {
        stops.set(id!, [...body!.matchAll(/stop-color="(#\w+)"/g)].map((m) => m[1]!.toUpperCase()));
      }
      const original = [...svg.matchAll(PATH_RE)].map(([, id, ...nums]) => ({ id: id!, n: nums.map(Number) }));
      const scene = buildScene(parseGame(pgn));

      expect(scene.shapes).toHaveLength(original.length);
      (scene.shapes as LensShape[]).forEach((shape, i) => {
        const o = original[i]!;
        const ours = [shape.p0.x, shape.p0.y, shape.c.x, shape.c.y, shape.p2.x, shape.p2.y].map((v) => v * 120);
        ours.forEach((v, j) => expect(v, `${name} move ${i + 1} coord ${j}`).toBeCloseTo(o.n[j]!, 3));
        expect([...shape.stops], `${name} move ${i + 1} colours`).toEqual(stops.get(o.id));
      });
    });
  }
});

describe("sceneToSVG", () => {
  const scene = buildScene(parseGame(classics["The Immortal Game"]!), { theme: "dark-checkers" });
  const rect = { x: 0, y: 0, size: 900 };

  it("draws every move by default", () => {
    const svg = sceneToSVG(scene, { width: 900, height: 900, rect });
    expect(svg.match(/<path /g)).toHaveLength(45);
    expect(svg.match(/<linearGradient /g)).toHaveLength(45);
    expect(svg).toContain('fill="#262626"');
  });

  it("draws a move in flight as a partial lens", () => {
    const svg = sceneToSVG(scene, { width: 900, height: 900, rect, progress: 10.5 });
    const paths = svg.match(/<path d="[^"]+"/g)!;
    expect(paths).toHaveLength(11);
    expect(paths[10]).toContain(" L ");
  });
});
