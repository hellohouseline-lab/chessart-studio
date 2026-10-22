// Renders the Pressed Flowers key: each piece's flower as a specimen with its name, Latin name
// and the reason it was chosen. Same drawing code as the art, so the key always matches it.
//   npm run key -w @chessart/render -- --out <dir> [--palette botanical]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { darken, FLOWER_KEY, getPalette, mix, PathBuilder, seeded, type PaintOp, type PieceType, type Pt } from "../src/index";
import { drawHead, petalColors, planHead } from "../src/styles/flowers";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");
const out = args.get("out") ?? "key";
const palette = getPalette(args.get("palette") ?? "botanical");
mkdirSync(out, { recursive: true });

const W = 2400;
const H = 1700;
const PAPER = "#F3EDE1";
const INK = "#2B2620";
const MUTED = "#8C8273";
const SERIF = "Georgia, 'Times New Roman', serif";
const GLYPH: Record<PieceType, string> = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
const ORDER: PieceType[] = ["p", "n", "b", "r", "q", "k"];
// Display size per species (board units → px), so each specimen fills its panel. The art itself
// keeps the true scale step from pawn to king (FLOWER_SCALE); the key evens them out to be legible.
const SIZE: Record<PieceType, number> = { p: 1350, n: 560, b: 820, r: 640, q: 430, k: 345 };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const n = (v: number) => Math.round(v * 10) / 10;

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > max) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  return lines;
}

const defs: string[] = [];
const body: string[] = [];
let gid = 0;

function emit(op: PaintOp) {
  const id = `g${gid++}`;
  const paint = (p: PaintOp["fill"]) => {
    if (!p || typeof p === "string") return p ?? "none";
    const stops = p.stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`).join("");
    defs.push(
      p.kind === "linear"
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${p.from.x}" y1="${p.from.y}" x2="${p.to.x}" y2="${p.to.y}">${stops}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${p.center.x}" cy="${p.center.y}" r="${p.radius}">${stops}</radialGradient>`,
    );
    return `url(#${id})`;
  };
  const attrs = [`d="${op.d}"`, `fill="${paint(op.fill)}"`];
  if (op.stroke) attrs.push(`stroke="${paint(op.stroke)}"`, `stroke-width="${op.width ?? 1}"`, `stroke-linecap="round"`);
  if (op.opacity !== undefined) attrs.push(`opacity="${op.opacity}"`);
  if (op.blur) attrs.push(`filter="url(#soft)"`);
  body.push(`<path ${attrs.join(" ")}/>`);
}

const text = (x: number, y: number, size: number, value: string, opts: { fill?: string; italic?: boolean; bold?: boolean; opacity?: number } = {}) =>
  body.push(
    `<text x="${n(x)}" y="${n(y)}" font-family="${SERIF}" font-size="${size}" fill="${opts.fill ?? INK}"${opts.italic ? ' font-style="italic"' : ""}${opts.bold ? ' font-weight="bold"' : ""}${opts.opacity ? ` opacity="${opts.opacity}"` : ""}>${esc(value)}</text>`,
  );

// Header.
text(140, 170, 72, "The Pressed Flower Key");
text(140, 230, 30, "ChessArt · Pressed Flowers — every piece grows its own flower", { fill: MUTED, italic: true });

const cellW = (W - 280) / 3;
const cellH = 640;
ORDER.forEach((piece, i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const x0 = 140 + col * cellW;
  const y0 = 300 + row * cellH;
  const key = FLOWER_KEY[piece];
  const stops = row === 0 ? palette.white : palette.black;
  const colors = petalColors(stops);

  // Specimen: a short straight stem with one leaf, the head facing up.
  const K = SIZE[piece];
  const centre = { x: x0 + cellW * 0.3, y: y0 + (piece === "n" || piece === "b" ? 330 : 240) };
  const px = (p: Pt) => ({ x: n(centre.x + p.x * K), y: n(centre.y + p.y * K) });
  const stemLen = (y0 + 560 - centre.y) / K;
  const stem = new PathBuilder(px).M({ x: 0, y: stemLen }).L({ x: 0, y: 0 }).toString();
  emit({ d: stem, stroke: "#4B3A28", width: 6, opacity: 0.12, blur: 4 });
  emit({ d: stem, stroke: mix("#6E8F4E", "#7A6A3A", 0.3), width: Math.max(3, 0.02 * K), opacity: 0.92 });
  const leafBase = { x: 0, y: stemLen * 0.55 };
  const leaf = new PathBuilder(px)
    .M(leafBase)
    .Q({ x: 0.06 * (560 / K) * 2, y: leafBase.y - 0.04 * (560 / K) * 2 }, { x: 0.16 * (560 / K), y: leafBase.y - 0.12 * (560 / K) })
    .Q({ x: 0.02 * (560 / K) * 2, y: leafBase.y - 0.1 * (560 / K) }, leafBase)
    .Z()
    .toString();
  emit({ d: leaf, fill: "#7C9A5C", opacity: 0.9 });
  emit({ d: leaf, stroke: darken("#7C9A5C", 0.3), width: 1.2, opacity: 0.3 });
  const plan = planHead(piece, seeded(11 + i));
  for (const op of drawHead(plan, { center: { x: 0, y: 0 }, angle: -Math.PI / 2, scale: 1, colors, px, k: K, shadow: true })) emit(op);

  // Label.
  const tx = x0 + cellW * 0.58;
  body.push(`<text x="${n(tx)}" y="${y0 + 120}" font-family="Apple Symbols, 'Segoe UI Symbol', 'DejaVu Sans', serif" font-size="64" fill="${INK}">${GLYPH[piece]}</text>`);
  text(tx, y0 + 190, 42, key.name, { bold: true });
  text(tx, y0 + 232, 26, key.latin, { fill: MUTED, italic: true });
  wrap(key.reason, 30).forEach((line, j) => text(tx, y0 + 290 + j * 34, 23, line, { opacity: 0.85 }));
});

// Colour legend.
const legendY = H - 90;
text(140, legendY, 24, "Colours follow the palette:", { fill: MUTED });
[
  ["White", palette.white],
  ["Black", palette.black],
  ["Captures", palette.capture],
  ["Castling", palette.castle],
].forEach(([label, stops], i) => {
  const x = 470 + i * 260;
  defs.push(`<linearGradient id="sw${i}"><stop offset="0" stop-color="${(stops as string[])[0]}"/><stop offset="1" stop-color="${(stops as string[])[1]}"/></linearGradient>`);
  body.push(`<rect x="${x}" y="${legendY - 20}" width="56" height="22" rx="11" fill="url(#sw${i})"/>`);
  text(x + 70, legendY, 24, label as string, { fill: MUTED });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 0.43 0 0 0 0 0.36 0 0 0 0 0.26 0.28 0 0 0 -0.11"/></filter>
${defs.join("")}</defs><rect width="${W}" height="${H}" fill="${PAPER}"/><rect width="${W}" height="${H}" filter="url(#grain)"/>${body.join("")}</svg>`;

writeFileSync(join(out, "flower-key.svg"), svg);
writeFileSync(join(out, "flower-key.png"), new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Georgia" } }).render().asPng());
console.log(join(out, "flower-key.png"));
