import { FRAME_UNITS, type Pt } from "./geometry";

// Where the 9×9 board frame lands in output pixels.
export interface Rect {
  x: number;
  y: number;
  size: number;
}

export interface BoardOptions {
  rect: Rect;
  progress?: number; // moves to draw; the fractional part is how far the next move has swept
  background?: boolean; // fill the frame with the theme background (default true)
  board?: boolean; // checker squares, when the theme has them (default true)
  labels?: boolean; // rank numbers and file letters (default false)
  font?: string; // CSS font family for labels
  ease?: (t: number) => number;
}

export const DEFAULT_FONT = "Montserrat, Helvetica, Arial, sans-serif";

export function toPx(rect: Rect, p: Pt): Pt {
  const k = rect.size / FRAME_UNITS;
  return { x: rect.x + p.x * k, y: rect.y + p.y * k };
}

// Squares that get the checker fill: the light squares (a8, h1, …), as on the prints.
export function checkerSquares(): Pt[] {
  const out: Pt[] = [];
  for (let file = 1; file <= 8; file++) {
    for (let rank = 1; rank <= 8; rank++) {
      if ((file + rank) % 2 === 1) out.push({ x: file - 0.5, y: FRAME_UNITS - rank - 0.5 });
    }
  }
  return out;
}

export interface Label {
  text: string;
  at: Pt; // centre, board units
}

export function boardLabels(): Label[] {
  const out: Label[] = [];
  for (let rank = 1; rank <= 8; rank++) out.push({ text: String(rank), at: { x: 0.2, y: FRAME_UNITS - rank } });
  for (let file = 1; file <= 8; file++) out.push({ text: String.fromCharCode(64 + file), at: { x: file, y: 8.8 } });
  return out;
}

export const LABEL_SIZE = 0.16; // board units

// Splits progress into fully drawn moves and the sweep of the one in flight.
export function splitProgress(progress: number, total: number): { full: number; frac: number } {
  const clamped = Math.max(0, Math.min(progress, total));
  const full = Math.floor(clamped);
  return { full, frac: full < total ? clamped - full : 0 };
}
