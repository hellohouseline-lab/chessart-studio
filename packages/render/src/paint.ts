import type { Pt } from "./geometry";

// Styles describe what to draw as a list of vector paint operations in output pixels.
// canvas.ts and svg.ts both render these, so a style never needs to know where it's drawn.

// [offset, colour] or [offset, colour, opacity] — opacity lets paint fade out along a stroke.
export type GradientStops = Array<[offset: number, color: string] | [offset: number, color: string, opacity: number]>;

export type Paint =
  | string
  | { kind: "linear"; from: Pt; to: Pt; stops: GradientStops }
  | { kind: "radial"; center: Pt; radius: number; stops: GradientStops };

export interface PaintOp {
  d: string; // SVG path data, in output pixels
  fill?: Paint;
  stroke?: Paint;
  width?: number; // stroke width in pixels
  opacity?: number;
  cap?: "round" | "butt";
  blur?: number; // Gaussian blur radius in pixels, for soft shadows (skipped where unsupported)
}

const n = (v: number) => Math.round(v * 100) / 100;

// Builds SVG path data from board-space points, mapping each through `map` (board units → pixels).
export class PathBuilder {
  private parts: string[] = [];

  constructor(private map: (p: Pt) => Pt = (p) => p) {}

  private pt(p: Pt) {
    const q = this.map(p);
    return `${n(q.x)} ${n(q.y)}`;
  }

  M(p: Pt) {
    this.parts.push(`M ${this.pt(p)}`);
    return this;
  }

  L(p: Pt) {
    this.parts.push(`L ${this.pt(p)}`);
    return this;
  }

  Q(c: Pt, p: Pt) {
    this.parts.push(`Q ${this.pt(c)} ${this.pt(p)}`);
    return this;
  }

  C(c1: Pt, c2: Pt, p: Pt) {
    this.parts.push(`C ${this.pt(c1)} ${this.pt(c2)} ${this.pt(p)}`);
    return this;
  }

  Z() {
    this.parts.push("Z");
    return this;
  }

  // Closed polygon through the points.
  poly(points: Pt[]) {
    points.forEach((p, i) => (i === 0 ? this.M(p) : this.L(p)));
    return this.Z();
  }

  // Open polyline through the points.
  line(points: Pt[]) {
    points.forEach((p, i) => (i === 0 ? this.M(p) : this.L(p)));
    return this;
  }

  // Ellipse centred on c with radii rx, ry, rotated by angle (radians), as four cubic arcs.
  ellipse(c: Pt, rx: number, ry: number, angle = 0) {
    const k = 0.5523; // cubic approximation of a quarter circle
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (x: number, y: number) => ({ x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos });
    this.M(at(rx, 0));
    this.C(at(rx, ry * k), at(rx * k, ry), at(0, ry));
    this.C(at(-rx * k, ry), at(-rx, ry * k), at(-rx, 0));
    this.C(at(-rx, -ry * k), at(-rx * k, -ry), at(0, -ry));
    this.C(at(rx * k, -ry), at(rx, -ry * k), at(rx, 0));
    return this.Z();
  }

  // Smooth curve through the points (Catmull-Rom as cubic Béziers): organic petal and leaf outlines.
  curve(points: Pt[], closed = true) {
    const n = points.length;
    if (n < 3) return closed ? this.poly(points) : this.line(points);
    const P = (i: number) => (closed ? points[(i + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!);
    this.M(points[0]!);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = P(i - 1);
      const p1 = P(i);
      const p2 = P(i + 1);
      const p3 = P(i + 2);
      this.C(
        { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        p2,
      );
    }
    return closed ? this.Z() : this;
  }

  get empty() {
    return this.parts.length === 0;
  }

  toString() {
    return this.parts.join(" ");
  }
}
