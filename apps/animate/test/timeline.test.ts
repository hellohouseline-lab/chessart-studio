import { describe, expect, it } from "vitest";
import { classicGames, parseGame } from "@chessart/render";
import { counterText } from "../src/compose";
import { layoutFor, SIZES, type Aspect } from "../src/layout";
import { durationOf, frameCount, perMoveFor, progressAt, MIN_PER_MOVE } from "../src/timeline";

const timing = { intro: 0.8, perMove: 0.5, hold: 2, fps: 30 };

describe("timeline", () => {
  it("adds intro, moves and hold", () => {
    expect(durationOf(45, timing)).toBeCloseTo(0.8 + 22.5 + 2);
    expect(frameCount(45, timing)).toBe(Math.round(25.3 * 30));
  });

  it("maps time to moves drawn", () => {
    expect(progressAt(0, 45, timing)).toBe(0);
    expect(progressAt(0.8, 45, timing)).toBe(0);
    expect(progressAt(1.05, 45, timing)).toBeCloseTo(0.5);
    expect(progressAt(100, 45, timing)).toBe(45);
  });

  it("fits a game to a target length", () => {
    const perMove = perMoveFor(30, 45, timing);
    expect(durationOf(45, { ...timing, perMove })).toBeCloseTo(30);
    expect(perMoveFor(1, 200, timing)).toBe(MIN_PER_MOVE);
  });
});

describe("layout", () => {
  const text = { title: "The Immortal Game", subtitle: "London, 1851", players: true, counter: true, logo: true };

  for (const aspect of Object.keys(SIZES) as Aspect[]) {
    it(`keeps everything inside the ${aspect} frame`, () => {
      const { width, height } = SIZES[aspect];
      const l = layoutFor({ width, height, text, artOnly: false });
      expect(l.art.x).toBeGreaterThanOrEqual(0);
      expect(l.art.y).toBeGreaterThanOrEqual(0);
      expect(l.art.x + l.art.size).toBeLessThanOrEqual(width);
      expect(l.art.y + l.art.size).toBeLessThanOrEqual(height);
      expect(Number.isInteger(l.art.size)).toBe(true);
      for (const a of [l.title, l.players, l.counter, l.logo]) {
        expect(a).toBeDefined();
        expect(a!.y).toBeGreaterThan(0);
        expect(a!.y).toBeLessThan(height);
      }
    });
  }

  it("centres a larger artwork when there is no text", () => {
    const l = layoutFor({ ...SIZES["9:16"], text, artOnly: true });
    expect(l.title).toBeUndefined();
    expect(l.art.size).toBe(Math.floor(1080 * 0.92));
    expect(l.art.y).toBe(Math.round((1920 - l.art.size) / 2));
  });
});

describe("move counter", () => {
  const game = parseGame(classicGames["The Immortal Game"]!);

  it("shows the move being drawn, then the result", () => {
    expect(counterText(game, 0)).toBe("");
    expect(counterText(game, 0.3)).toBe("1. e4");
    expect(counterText(game, 1.5)).toBe("1… e5");
    expect(counterText(game, 44.5)).toBe("23. Be7#");
    expect(counterText(game, 45)).toBe("1–0");
  });
});
