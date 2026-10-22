import { getPalette, getStyle, getTheme, palettes, styles, themes } from "@chessart/render";

// Viewer settings live in the URL so a kiosk can be pointed at one link and simply reloaded.
export interface Settings {
  style: string;
  theme: string;
  palette: string;
  panel: boolean;
  labels: boolean;
}

export function readSettings(params = new URLSearchParams(location.search)): Settings {
  const style = getStyle(params.get("style") ?? undefined);
  return {
    style: style.id,
    theme: getTheme(params.get("theme") ?? style.defaults?.theme).id,
    palette: getPalette(params.get("palette") ?? style.defaults?.palette).id,
    panel: params.get("panel") !== "0",
    labels: params.get("labels") !== "0",
  };
}

export function writeSettings(s: Settings) {
  const params = new URLSearchParams(location.search);
  params.set("style", s.style);
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

// Switching style also switches to the theme and palette it was designed for, if it has one.
export function nextStyle(s: Settings): Settings {
  const style = getStyle(next(styles, s.style));
  return {
    ...s,
    style: style.id,
    theme: style.defaults?.theme ?? s.theme,
    palette: style.defaults?.palette ?? s.palette,
  };
}
