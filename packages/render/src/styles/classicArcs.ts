import type { ArtMove, PieceType } from "../game";
import { controlPoint, partialLens, squareCenter } from "../geometry";
import { toPx } from "../layout";
import { PathBuilder } from "../paint";
import type { Palette, Stops } from "../palettes";
import type { ArtStyle, LensShape } from "../scene";

// Bulge per piece in board units, measured from the original print SVGs
// (60/90/90/120/160/180px on a 120px grid). Heavier pieces sweep wider arcs.
export const BULGE: Record<PieceType, number> = {
  p: 0.5,
  n: 0.75,
  b: 0.75,
  r: 1,
  q: 4 / 3,
  k: 1.5,
};

export function stopsFor(move: ArtMove, palette: Palette): Stops {
  if (move.kind === "capture") return palette.capture;
  if (move.kind === "castle") return palette.castle;
  return move.side === "w" ? palette.white : palette.black;
}

// The original ChessArt look, ported from chess-art/js/chessArt.js (drawMove).
export const classicArcs: ArtStyle<LensShape> = {
  id: "classic-arcs",
  name: "Classic Arcs",
  buildScene(game, { theme, palette }) {
    const shapes = game.moves.map((move, index) => {
      const p0 = squareCenter(move.from);
      const p2 = squareCenter(move.to);
      return {
        index,
        kind: move.kind,
        side: move.side,
        piece: move.piece,
        p0,
        c: controlPoint(p0, p2, BULGE[move.piece]),
        p2,
        stops: stopsFor(move, palette),
        opacity: 0.9,
      };
    });
    return { style: this, theme, palette, shapes };
  },

  // A lens swept from its origin square: the curve and its chord truncated at t (see partialLens).
  paint(mark, rect, t) {
    if (t <= 0) return [];
    const path = new PathBuilder((p) => toPx(rect, p)).M(mark.p0);
    if (t >= 1) {
      path.Q(mark.c, mark.p2);
    } else {
      const part = partialLens(mark.p0, mark.c, mark.p2, t);
      path.Q(part.q, part.tip).L(part.chord);
    }
    return [
      {
        d: path.Z().toString(),
        fill: {
          kind: "linear",
          from: toPx(rect, mark.p0),
          to: toPx(rect, mark.p2),
          stops: [
            [0, mark.stops[0]],
            [1, mark.stops[1]],
          ],
        },
        opacity: mark.opacity,
      },
    ];
  },
};
