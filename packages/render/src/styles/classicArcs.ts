import type { ArtMove, PieceType } from "../game";
import { controlPoint, squareCenter } from "../geometry";
import type { Palette, Stops } from "../palettes";
import type { ArtStyle } from "../scene";

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

function stopsFor(move: ArtMove, palette: Palette): Stops {
  if (move.kind === "capture") return palette.capture;
  if (move.kind === "castle") return palette.castle;
  return move.side === "w" ? palette.white : palette.black;
}

// The original ChessArt look, ported from chess-art/js/chessArt.js (drawMove).
export const classicArcs: ArtStyle = {
  id: "classic-arcs",
  name: "Classic Arcs",
  buildScene(game, { theme, palette }) {
    const shapes = game.moves.map((move, index) => {
      const p0 = squareCenter(move.from);
      const p2 = squareCenter(move.to);
      return {
        index,
        p0,
        c: controlPoint(p0, p2, BULGE[move.piece]),
        p2,
        stops: stopsFor(move, palette),
        opacity: 0.9,
        kind: move.kind,
        side: move.side,
      };
    });
    return { styleId: this.id, theme, palette, shapes };
  },
};
