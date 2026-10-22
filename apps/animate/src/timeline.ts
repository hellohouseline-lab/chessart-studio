// Timing of an animation: a short intro on the empty board, one sweep per move, then a hold
// on the finished artwork.
export interface Timing {
  intro: number; // seconds before the first move starts
  perMove: number; // seconds each move takes to sweep in
  hold: number; // seconds the finished artwork stays on screen
  fps: number;
}

export const MIN_PER_MOVE = 0.05;

export const durationOf = (moves: number, t: Timing) => t.intro + moves * t.perMove + t.hold;

export const frameCount = (moves: number, t: Timing) => Math.max(1, Math.round(durationOf(moves, t) * t.fps));

// Moves drawn at `time`; the fractional part is how far the current move has swept.
export function progressAt(time: number, moves: number, t: Timing): number {
  return Math.max(0, Math.min(moves, (time - t.intro) / t.perMove));
}

// Seconds per move that make the whole video last `total` seconds.
export function perMoveFor(total: number, moves: number, t: Pick<Timing, "intro" | "hold">): number {
  const available = total - t.intro - t.hold;
  return Math.max(MIN_PER_MOVE, available / Math.max(1, moves));
}
