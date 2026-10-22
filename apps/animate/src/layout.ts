import type { Rect } from "@chessart/render";

export type Aspect = "9:16" | "4:5" | "1:1" | "16:9";

export const SIZES: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export interface TextOptions {
  title: string;
  subtitle: string;
  players: boolean;
  counter: boolean;
  logo: boolean;
}

export interface FrameOptions {
  width: number;
  height: number;
  text: TextOptions;
  artOnly: boolean; // just the arcs: no text, board squares or labels
}

export interface TextAnchor {
  x: number; // left edge, or right edge when align is "right"
  y: number; // baseline of the first line
  width: number;
  align: "left" | "right";
}

export interface Layout {
  art: Rect;
  unit: number; // font sizes are fractions of this
  title?: TextAnchor;
  players?: TextAnchor;
  counter?: TextAnchor;
  logo?: TextAnchor; // y is the top of the logo here
}

// Font sizes as fractions of Layout.unit, shared by layout and drawing.
export const TYPE = {
  title: 0.05,
  subtitle: 0.028,
  player: 0.032,
  counter: 0.05,
  logo: 0.075, // logo height
  brand: 0.022,
};

export const LINE_GAP = 1.55; // line height as a multiple of font size

const LOGO_RATIO = 331 / 467; // ChessArt_Logo_*.png
const BRAND_EM = 6.9; // approximate width of "chessart.me" in ems

// Portrait/square headers stack the logo over "chessart.me"; this is that block's width.
const logoBlockWidth = (u: number) => Math.max(TYPE.logo * LOGO_RATIO, TYPE.brand * BRAND_EM) * u;

export function layoutFor({ width: W, height: H, text, artOnly }: FrameOptions): Layout {
  const hasTitle = !artOnly && !!(text.title || text.subtitle);
  const hasFooter = !artOnly && (text.players || text.counter);
  const hasLogo = !artOnly && text.logo;

  if (!hasTitle && !hasFooter && !hasLogo) {
    const size = Math.floor(Math.min(W, H) * 0.92);
    return { art: { x: Math.round((W - size) / 2), y: Math.round((H - size) / 2), size }, unit: Math.min(W, H) };
  }

  if (W / H > 1.2) return landscape(W, H, hasTitle, hasFooter, hasLogo, text);

  // Portrait and square: header (title, logo) above the art, players and move counter below.
  const u = W;
  const margin = 0.06 * u;
  const headerH = hasTitle || hasLogo ? 0.15 * u : 0;
  const footerH = hasFooter ? 0.15 * u : 0;
  const size = Math.floor(Math.min(W - 2 * margin, H - headerH - footerH - 2 * margin));
  const top = (H - (headerH + size + footerH)) / 2;
  const art = { x: Math.round((W - size) / 2), y: Math.round(top + headerH), size };

  // Line text up with the board's a- and h-file edges rather than the art frame.
  const left = art.x + (art.size * 0.5) / 9;
  const right = art.x + (art.size * 8.5) / 9;
  const textW = right - left;
  const layout: Layout = { art, unit: u };

  const logoW = hasLogo ? logoBlockWidth(u) : 0;
  if (hasTitle) {
    const width = textW - (hasLogo ? logoW + 0.03 * u : 0);
    layout.title = { x: left, y: top + TYPE.title * u * 1.4, width, align: "left" };
  }
  if (hasLogo) layout.logo = { x: right, y: top + TYPE.title * u * 0.2, width: logoW, align: "right" };
  if (hasFooter) {
    const fy = art.y + size + TYPE.player * u * 1.6;
    if (text.players) layout.players = { x: left, y: fy, width: textW * 0.62, align: "left" };
    if (text.counter) layout.counter = { x: right, y: fy + TYPE.counter * u * 0.25, width: textW * 0.36, align: "right" };
  }
  return layout;
}

function landscape(W: number, H: number, hasTitle: boolean, hasFooter: boolean, hasLogo: boolean, text: TextOptions): Layout {
  // Art on the left, details in a column on the right, like the live viewer.
  const u = H;
  const margin = 0.06 * u;
  const size = Math.floor(H - 2 * margin);
  const art = { x: Math.round(0.07 * W), y: Math.round(margin), size };
  const x = art.x + size + 0.06 * W;
  const width = W - x - 0.07 * W;
  const layout: Layout = { art, unit: u };
  if (hasTitle) layout.title = { x, y: art.y + size * 0.1, width, align: "left" };
  if (hasFooter && text.players) layout.players = { x, y: art.y + size * 0.42, width, align: "left" };
  if (hasFooter && text.counter) layout.counter = { x, y: art.y + size * 0.72, width, align: "left" };
  if (hasLogo) layout.logo = { x, y: art.y + size - TYPE.logo * u, width, align: "left" };
  return layout;
}
