export interface Theme {
  id: string;
  name: string;
  background: string;
  foreground: string;
  muted: string;
  checker?: string; // fill for the shaded squares; absent means no board
  texture?: "paper"; // surface grain drawn over the background
  dark: boolean;
}

export const themes: readonly Theme[] = [
  { id: "dark", name: "Dark", background: "#000000", foreground: "#FFFFFF", muted: "#8C8C8C", dark: true },
  { id: "light", name: "Light", background: "#FFFFFF", foreground: "#000000", muted: "#6E6E6E", dark: false },
  {
    id: "dark-checkers",
    name: "Dark Checkers",
    background: "#000000",
    foreground: "#FFFFFF",
    muted: "#8C8C8C",
    checker: "#262626",
    dark: true,
  },
  {
    // Warm, slightly aged paper: made for Pressed Flowers, works with any style.
    id: "paper",
    name: "Paper",
    background: "#F3EDE1",
    foreground: "#2B2620",
    muted: "#8C8273",
    texture: "paper",
    dark: false,
  },
  {
    id: "light-checkers",
    name: "Light Checkers",
    background: "#FFFFFF",
    foreground: "#000000",
    muted: "#6E6E6E",
    checker: "#E9E9E9",
    dark: false,
  },
];

export function getTheme(id: string | undefined): Theme {
  return themes.find((t) => t.id === id) ?? themes[0]!;
}
