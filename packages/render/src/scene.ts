import type { ArtGame, MoveKind, PieceType, Side } from "./game";
import type { Pt } from "./geometry";
import type { Rect } from "./layout";
import type { PaintOp } from "./paint";
import type { Palette, Stops } from "./palettes";
import type { Theme } from "./themes";

// One move's artwork. Each style extends this with whatever it needs to draw the move.
export interface Mark {
  index: number; // 0-based move index
  kind: MoveKind;
  side: Side;
  piece: PieceType;
}

// Classic Arcs: one move drawn as a gradient-filled lens. Coordinates are in board units (see geometry.ts).
export interface LensShape extends Mark {
  p0: Pt;
  c: Pt;
  p2: Pt;
  stops: Stops; // gradient runs p0 → p2
  opacity: number;
}

export interface Scene<M extends Mark = Mark> {
  style: ArtStyle<M>;
  theme: Theme;
  palette: Palette;
  shapes: M[];
}

export interface StyleOptions {
  theme: Theme;
  palette: Palette;
}

// Plug-in interface. A style turns a game into marks (one per move, built once, so any randomness is
// fixed), then paints a mark at a given sweep `t` (0 = not started, 1 = finished) as vector paint ops.
// Register styles in index.ts; the live viewer, animation tool and print renderer all pick them up.
export interface ArtStyle<M extends Mark = Mark> {
  id: string;
  name: string;
  defaults?: { theme?: string; palette?: string }; // the look a style is designed for
  buildScene(game: ArtGame, options: StyleOptions): Scene<M>;
  paint(mark: M, rect: Rect, t: number, scene: Scene<M>): PaintOp[];
}
