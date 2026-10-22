function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const hex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

// Linear blend of two hex colours: t = 0 gives a, t = 1 gives b.
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [parse(a), parse(b)];
  return hex(x.map((v, i) => v + (y[i]! - v) * t));
}

export const darken = (c: string, t: number) => mix(c, "#000000", t);
export const lighten = (c: string, t: number) => mix(c, "#FFFFFF", t);

// Relative luminance (0 black … 1 white), for choosing contrast colours.
export function luminance(c: string): number {
  const [r, g, b] = parse(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function rgba(c: string, alpha: number): string {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${alpha})`;
}
