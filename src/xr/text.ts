/**
 * Text drawn with the browser's 2D canvas into a CanvasTexture.
 *
 * Used for every string inside XR instead of the uikit MSDF font, which we
 * assume (not verified) lacks CJK glyphs. The system font stack below lets
 * the headset browser pick a font that has Korean, Japanese, Chinese and
 * Vietnamese tone marks. MV09 checks the result on screen.
 */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export const FONT_STACK =
  "system-ui, 'Noto Sans CJK KR', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Hiragino Sans', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif";

/** Canvas pixels per meter of panel. Design value. */
export const TEXT_PX_PER_M = 2048;

export interface TextPlaneOptions {
  color?: string;
  /** Fill behind the text, or null for transparent. */
  background?: string | null;
  align?: 'left' | 'center';
  weight?: number;
  maxFontPx?: number;
  minFontPx?: number;
  /** Inner padding, share of the height. */
  padding?: number;
}

/** Splits text into lines that fit maxWidth, breaking at spaces when it can, else between characters. */
export function wrapText(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of Array.from(para)) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        const cut = line.lastIndexOf(' ');
        if (cut > 0 && ch !== ' ') {
          out.push(line.slice(0, cut));
          line = line.slice(cut + 1) + ch;
        } else {
          out.push(line.trimEnd());
          line = ch === ' ' ? '' : ch;
        }
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

export class TextPlane {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly opts: Required<TextPlaneOptions>;
  private text: string | null = null;

  constructor(widthM: number, heightM: number, options: TextPlaneOptions = {}) {
    this.opts = {
      color: options.color ?? '#ffffff',
      background: options.background ?? null,
      align: options.align ?? 'center',
      weight: options.weight ?? 600,
      maxFontPx: options.maxFontPx ?? 64,
      minFontPx: options.minFontPx ?? 18,
      padding: options.padding ?? 0.12,
    };
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(32, Math.round(widthM * TEXT_PX_PER_M));
    this.canvas.height = Math.max(16, Math.round(heightM * TEXT_PX_PER_M));
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas unavailable');
    }
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: this.opts.background === null,
      toneMapped: false,
      depthWrite: this.opts.background !== null,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), this.material);
    this.mesh.name = 'text';
  }

  /** New text and fill colors (contrast mode). Redraws the current text. */
  setColors(color: string, background: string | null): void {
    if (color === this.opts.color && background === this.opts.background) {
      return;
    }
    this.opts.color = color;
    // A plane made transparent stays transparent; only its fill color changes.
    this.opts.background = this.material.transparent ? null : (background ?? this.opts.background);
    const text = this.text;
    this.text = null;
    if (text !== null) {
      this.setText(text);
    }
  }

  setText(text: string): void {
    if (text === this.text) {
      return;
    }
    this.text = text;
    const { ctx, canvas, opts } = this;
    const w = canvas.width;
    const h = canvas.height;
    const pad = Math.round(h * opts.padding);
    ctx.clearRect(0, 0, w, h);
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, w, h);
    }
    let size = opts.maxFontPx;
    let lines: string[] = [];
    for (; size >= opts.minFontPx; size -= 2) {
      ctx.font = `${opts.weight} ${size}px ${FONT_STACK}`;
      lines = wrapText(ctx, text, w - pad * 2);
      if (lines.length * size * 1.25 <= h - pad * 2) {
        break;
      }
    }
    size = Math.max(size, opts.minFontPx);
    ctx.font = `${opts.weight} ${size}px ${FONT_STACK}`;
    ctx.fillStyle = opts.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = opts.align;
    const lineH = size * 1.25;
    const top = h / 2 - (lines.length * lineH) / 2 + lineH / 2;
    const x = opts.align === 'center' ? w / 2 : pad;
    lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineH));
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
