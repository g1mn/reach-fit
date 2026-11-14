/**
 * Procedural grain as RGBA bytes: soft value noise plus fine speckle, gray,
 * seeded so every run (and every recorded frame) looks the same.
 *
 * Pure: no three.js, no DOM. textures.ts wraps the bytes in a DataTexture
 * with no color space, so a byte b multiplies the material color by b / 255
 * in linear space. The bytes never go below minGain, which is what
 * palette.ts uses for its worst-case contrast pairs.
 */

export interface GrainOptions {
  /** Pixels per side. Design value: 128 (the limit for a texture here is 256). */
  size: number;
  /** Lowest linear gain, 0..1. Every byte is at least ceil(minGain * 255). */
  minGain: number;
  seed: number;
  /** Noise cells per side. The pattern tiles seamlessly. */
  cells?: number;
  /** Darken toward the borders, like a soft bevel. Off for repeating textures. */
  bevel?: boolean;
}

/** 32-bit integer hash of a lattice point, 0..1. */
function hash01(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (n: number) => ((n % cells) + cells) % cells;
  const a = hash01(wrap(x0), wrap(y0), seed);
  const b = hash01(wrap(x0 + 1), wrap(y0), seed);
  const c = hash01(wrap(x0), wrap(y0 + 1), seed);
  const d = hash01(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** RGBA bytes, row-major, length size * size * 4. */
export function makeGrainData(options: GrainOptions): Uint8Array {
  const size = Math.max(1, Math.floor(options.size));
  const cells = Math.max(1, Math.floor(options.cells ?? 8));
  const minGain = Math.min(1, Math.max(0, options.minGain));
  const floor = Math.ceil(minGain * 255);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const soft = valueNoise(u, v, cells, options.seed);
      const fine = hash01(x, y, options.seed + 1);
      let level = 0.75 * soft + 0.25 * fine;
      if (options.bevel) {
        const edge = Math.min(u, v, 1 - u, 1 - v);
        // Design value: the outer 12% of the face fades to the darkest grain.
        const lip = Math.min(1, edge / 0.12);
        level *= 0.35 + 0.65 * lip;
      }
      const gain = minGain + (1 - minGain) * level;
      const byte = Math.max(floor, Math.min(255, Math.round(gain * 255)));
      const i = (y * size + x) * 4;
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }
  return data;
}
