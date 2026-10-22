import {
  drawBoard,
  drawMark,
  drawMoves,
  easeInOutCubic,
  splitProgress,
  type ArtGame,
  type Scene,
} from "@chessart/render";
import { layoutFor, LINE_GAP, TYPE, type FrameOptions, type Layout, type TextAnchor } from "./layout";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const FONT = "Montserrat, Helvetica, Arial, sans-serif";

export interface Logo {
  image: CanvasImageSource;
  ratio: number; // width / height
}

export interface FrameSpec extends FrameOptions {
  game: ArtGame;
  scene: Scene;
  transparent: boolean;
  labels: boolean;
  logo?: Logo;
}

// Renders animation frames. Finished moves are baked into a cache so each frame only draws
// the move in flight; frames can be requested in any order (the cache rebuilds when going back).
export class FrameRenderer {
  readonly layout: Layout;
  private cache: OffscreenCanvas;
  private cacheCtx: OffscreenCanvasRenderingContext2D;
  private cached = -1; // moves baked into the cache; -1 means the board isn't drawn yet

  constructor(readonly spec: FrameSpec) {
    this.layout = layoutFor(spec);
    this.cache = new OffscreenCanvas(this.layout.art.size, this.layout.art.size);
    this.cacheCtx = this.cache.getContext("2d")!;
  }

  render(ctx: Ctx, progress: number) {
    const { spec, layout } = this;
    const { full, frac } = splitProgress(progress, spec.scene.shapes.length);
    const local = { x: 0, y: 0, size: layout.art.size };

    if (this.cached < 0 || full < this.cached) {
      this.cacheCtx.clearRect(0, 0, local.size, local.size);
      if (!spec.artOnly) drawBoard(this.cacheCtx, spec.scene, { rect: local, background: false, labels: spec.labels });
      this.cached = 0;
    }
    if (full > this.cached) {
      drawMoves(this.cacheCtx, spec.scene, local, this.cached, full);
      this.cached = full;
    }

    ctx.save();
    if (spec.transparent) {
      ctx.clearRect(0, 0, spec.width, spec.height);
    } else {
      ctx.fillStyle = spec.scene.theme.background;
      ctx.fillRect(0, 0, spec.width, spec.height);
    }
    ctx.drawImage(this.cache, layout.art.x, layout.art.y);
    if (frac > 0) drawMark(ctx, spec.scene, full, layout.art, easeInOutCubic(frac));
    if (!spec.artOnly) this.drawText(ctx, progress);
    ctx.restore();
  }

  private drawText(ctx: Ctx, progress: number) {
    const { spec, layout } = this;
    const { theme } = spec.scene;
    const u = layout.unit;
    const tags = spec.game.tags;
    ctx.textBaseline = "alphabetic";

    if (layout.title) {
      const a = layout.title;
      let y = a.y;
      if (spec.text.title) {
        ctx.fillStyle = theme.foreground;
        fitFont(ctx, spec.text.title, 700, TYPE.title * u, a.width);
        text(ctx, spec.text.title, a, y);
        y += TYPE.subtitle * u * LINE_GAP * 1.15;
      }
      if (spec.text.subtitle) {
        ctx.fillStyle = theme.muted;
        fitFont(ctx, spec.text.subtitle, 400, TYPE.subtitle * u, a.width, "italic ");
        text(ctx, spec.text.subtitle, a, y);
      }
    }

    if (layout.players) {
      const a = layout.players;
      const size = TYPE.player * u;
      [
        { name: tags.White ?? "White", filled: true },
        { name: tags.Black ?? "Black", filled: false },
      ].forEach((p, i) => {
        const y = a.y + i * size * LINE_GAP;
        const r = size * 0.24;
        ctx.beginPath();
        ctx.arc(a.x + r, y - size * 0.34, r, 0, Math.PI * 2);
        if (p.filled) {
          ctx.fillStyle = theme.foreground;
          ctx.fill();
        } else {
          ctx.strokeStyle = theme.foreground;
          ctx.lineWidth = size * 0.07;
          ctx.stroke();
        }
        ctx.fillStyle = theme.foreground;
        const textX = a.x + r * 2 + size * 0.5;
        fitFont(ctx, p.name, 500, size, a.width - (textX - a.x));
        ctx.textAlign = "left";
        ctx.fillText(p.name, textX, y);
      });
    }

    if (layout.counter) {
      const label = counterText(spec.game, progress);
      if (label) {
        ctx.fillStyle = theme.foreground;
        fitFont(ctx, label, 700, TYPE.counter * u, layout.counter.width);
        text(ctx, label, layout.counter, layout.counter.y);
      }
    }

    if (layout.logo && spec.logo) {
      const a = layout.logo;
      const h = TYPE.logo * u;
      const w = h * spec.logo.ratio;
      const brandSize = TYPE.brand * u;
      const brand = "chessart.me";
      ctx.font = `500 ${brandSize}px ${FONT}`;
      ctx.fillStyle = theme.muted;
      if (a.align === "right") {
        // Portrait/square: logo stacked over the URL, centred in a block ending at a.x.
        const cx = a.x - a.width / 2;
        ctx.drawImage(spec.logo.image, cx - w / 2, a.y, w, h);
        ctx.textAlign = "center";
        ctx.fillText(brand, cx, a.y + h + brandSize * 1.3);
      } else {
        // Landscape: logo with the URL beside it.
        ctx.drawImage(spec.logo.image, a.x, a.y, w, h);
        ctx.textAlign = "left";
        ctx.fillText(brand, a.x + w + brandSize * 0.8, a.y + h / 2 + brandSize * 0.35);
      }
    }
  }
}

function text(ctx: Ctx, value: string, a: TextAnchor, y: number) {
  ctx.textAlign = a.align;
  ctx.fillText(value, a.x, y);
}

// Shrinks the font (down to 55%) until the text fits, so long titles and names stay on one line.
function fitFont(ctx: Ctx, value: string, weight: number, size: number, maxWidth: number, style = "") {
  let s = size;
  ctx.font = `${style}${weight} ${s}px ${FONT}`;
  while (ctx.measureText(value).width > maxWidth && s > size * 0.55) {
    s *= 0.95;
    ctx.font = `${style}${weight} ${s}px ${FONT}`;
  }
}

const RESULTS: Record<string, string> = { "1-0": "1–0", "0-1": "0–1", "1/2-1/2": "½–½" };

// "23. Be7#" while moves are drawing, the result once the game is complete.
export function counterText(game: ArtGame, progress: number): string {
  const n = game.moves.length;
  if (progress >= n && n > 0) return RESULTS[game.result] ?? labelFor(game, n - 1);
  const current = Math.ceil(progress) - 1;
  return current >= 0 ? labelFor(game, current) : "";
}

function labelFor(game: ArtGame, index: number): string {
  const m = game.moves[index]!;
  return `${Math.ceil(m.ply / 2)}${m.side === "w" ? "." : "…"} ${m.san}`;
}
