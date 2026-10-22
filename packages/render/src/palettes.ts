export type Stops = readonly [string, string];

export interface Palette {
  id: string;
  name: string;
  white: Stops;
  black: Stops;
  capture: Stops;
  castle: Stops;
}

export const palettes: readonly Palette[] = [
  {
    // The original ChessArt colours, as on the shop prints.
    id: "classic",
    name: "Classic",
    white: ["#74FFFF", "#006294"],
    black: ["#000000", "#E6E7E8"],
    capture: ["#FEE700", "#FF0000"],
    castle: ["#FFD400", "#51DC00"],
  },
  {
    id: "aurora",
    name: "Aurora",
    white: ["#7CFFCB", "#00A6A6"],
    black: ["#2B1055", "#D3B8FF"],
    capture: ["#FF9AD5", "#FF2E63"],
    castle: ["#FFF59D", "#FFC400"],
  },
  {
    id: "ember",
    name: "Ember",
    white: ["#FFE08A", "#FF7A00"],
    black: ["#2A0E0E", "#F2C6B4"],
    capture: ["#FF3D00", "#B00020"],
    castle: ["#9CFF57", "#2E7D32"],
  },
  {
    id: "noir",
    name: "Noir",
    white: ["#FFFFFF", "#7A7A7A"],
    black: ["#1A1A1A", "#BDBDBD"],
    capture: ["#FF4D4D", "#B30000"],
    castle: ["#F5D06F", "#B8860B"],
  },
  {
    id: "neon",
    name: "Neon",
    white: ["#00F5FF", "#7B61FF"],
    black: ["#3D0066", "#FF00E5"],
    capture: ["#FAFF00", "#FF5C00"],
    castle: ["#39FF14", "#00B36B"],
  },
];

export function getPalette(id: string | undefined): Palette {
  return palettes.find((p) => p.id === id) ?? palettes[0]!;
}
