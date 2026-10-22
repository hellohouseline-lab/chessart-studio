// Seeded randomness so hand-made-looking styles come out identical on every frame,
// every reload and every print.

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Random {
  (): number; // [0, 1)
  range(min: number, max: number): number;
  int(min: number, max: number): number; // inclusive
  sign(): 1 | -1;
}

// mulberry32
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    range: (min: number, max: number) => min + (max - min) * next(),
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    sign: (): 1 | -1 => (next() < 0.5 ? -1 : 1),
  });
}
