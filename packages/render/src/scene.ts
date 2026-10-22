import type { ArtGame, MoveKind, Side } from "./game";
import type { Pt } from "./geometry";
import type { Palette, Stops } from "./palettes";
import type { Theme } from "./themes";

// One move drawn as a gradient-filled lens. All coordinates are in board units (see geometry.ts).
export interface LensShape {
  index: number; // 0-based move index
  p0: Pt;
  c: Pt;
  p2: Pt;
  stops: Stops; // gradient runs p0 → p2
  opacity: number;
  kind: MoveKind;
  side: Side;
}

export interface Scene {
  styleId: string;
  theme: Theme;
  palette: Palette;
  shapes: LensShape[];
}

export interface StyleOptions {
  theme: Theme;
  palette: Palette;
}

// Plug-in interface: a style turns a game into a scene. New art styles implement this
// and register in styles/index.ts; every renderer (live, animation, print) picks them up.
export interface ArtStyle {
  id: string;
  name: string;
  buildScene(game: ArtGame, options: StyleOptions): Scene;
}
