// "Abdusattorov, Nodirbek" → { first: "Nodirbek", last: "Abdusattorov" }
export function splitName(name: string): { first: string; last: string } {
  const [last, first] = name.split(",").map((s) => s.trim());
  if (first) return { first, last: last ?? "" };
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? { first: words.slice(0, -1).join(" "), last: words.at(-1)! } : { first: "", last: name };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function resultText(result: string, white: string, black: string): { score: string; line: string } | null {
  if (result === "1-0") return { score: "1–0", line: `${splitName(white).last} wins` };
  if (result === "0-1") return { score: "0–1", line: `${splitName(black).last} wins` };
  if (result === "1/2-1/2" || result === "½-½") return { score: "½–½", line: "Draw" };
  return null;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
