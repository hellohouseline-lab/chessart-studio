import type { ArtGame } from "./game";
import { getPalette } from "./palettes";
import type { ArtStyle, Scene } from "./scene";
import { classicArcs } from "./styles/classicArcs";
import { getTheme } from "./themes";

export * from "./game";
export * from "./geometry";
export * from "./layout";
export * from "./palettes";
export * from "./themes";
export * from "./canvas";
export * from "./svg";
export type { ArtStyle, LensShape, Scene, StyleOptions } from "./scene";

// Register new styles here.
export const styles: readonly ArtStyle[] = [classicArcs];

export function getStyle(id: string | undefined): ArtStyle {
  return styles.find((s) => s.id === id) ?? styles[0]!;
}

export function buildScene(
  game: ArtGame,
  ids: { style?: string; theme?: string; palette?: string } = {},
): Scene {
  return getStyle(ids.style).buildScene(game, { theme: getTheme(ids.theme), palette: getPalette(ids.palette) });
}
