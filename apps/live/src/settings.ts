import { getPalette, getTheme, palettes, themes } from "@chessart/render";

// Viewer settings live in the URL so a kiosk can be pointed at one link and simply reloaded.
export interface Settings {
  theme: string;
  palette: string;
  panel: boolean;
  labels: boolean;
}

export function readSettings(params = new URLSearchParams(location.search)): Settings {
  return {
    theme: getTheme(params.get("theme") ?? undefined).id,
    palette: getPalette(params.get("palette") ?? undefined).id,
    panel: params.get("panel") !== "0",
    labels: params.get("labels") !== "0",
  };
}

export function writeSettings(s: Settings) {
  const params = new URLSearchParams(location.search);
  params.set("theme", s.theme);
  params.set("palette", s.palette);
  s.panel ? params.delete("panel") : params.set("panel", "0");
  s.labels ? params.delete("labels") : params.set("labels", "0");
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

const next = <T extends { id: string }>(list: readonly T[], id: string) =>
  list[(list.findIndex((x) => x.id === id) + 1) % list.length]!.id;

export const nextTheme = (id: string) => next(themes, id);
export const nextPalette = (id: string) => next(palettes, id);
