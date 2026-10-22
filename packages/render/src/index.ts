import type { ArtGame } from "./game";
import { getPalette } from "./palettes";
import type { ArtStyle, Scene } from "./scene";
import { brushStrokes } from "./styles/brushStrokes";
import { classicArcs } from "./styles/classicArcs";
import { pressedFlowers } from "./styles/pressedFlowers";
import { getTheme } from "./themes";

export * from "./classics";
export * from "./color";
export * from "./game";
export * from "./geometry";
export * from "./layout";
export * from "./paint";
export * from "./palettes";
export * from "./random";
export * from "./themes";
export * from "./canvas";
export * from "./svg";
export type { ArtStyle, LensShape, Mark, Scene, StyleOptions } from "./scene";
export { FLOWER_KEY, flowerNames } from "./styles/flowers";

// Register new styles here.
export const styles: readonly ArtStyle[] = [classicArcs, brushStrokes, pressedFlowers] as readonly ArtStyle[];

export function getStyle(id: string | undefined): ArtStyle {
  return styles.find((s) => s.id === id) ?? styles[0]!;
}

export function buildScene(
  game: ArtGame,
  ids: { style?: string; theme?: string; palette?: string } = {},
): Scene {
  return getStyle(ids.style).buildScene(game, { theme: getTheme(ids.theme), palette: getPalette(ids.palette) });
}
