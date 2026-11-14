/**
 * High-contrast palette for the board, tiles and panels.
 *
 * Pure data and math: no three.js, no DOM. Node scripts and tests import this
 * file directly (scripts/contrast-check.ts, tests/art).
 *
 * The look, from the bottom up:
 * - an opaque dark base under every tile, so whatever room shows through the
 *   passthrough view, the board behind the tiles is always the same dark;
 * - light tile faces;
 * - dark path channels cut into the faces;
 * - when light flows, the channel widens and a bright core runs inside it.
 *
 * A bright mark never sits straight on a light face. Every bright mark (lit
 * core, source disc, target ring and star) has a dark casing around it, so
 * the pairs that really touch are core/casing and casing/face. Those are the
 * pairs checked below. The source disc and its beam share one color, so they
 * read as one bright shape and no two bright colors meet. Where a channel reaches the edge of a face it meets
 * the dark base: dark meets dark there on purpose, so the path reads as
 * running on into the gap. The side walls of a raised tile are dark too
 * (pathIdle), so seen at an angle the ends of lit cores and the hover frame
 * still meet dark, never a light wall.
 *
 * Lit and unlit paths differ in three ways besides hue: brightness (dark
 * channel vs bright core), width (the lit channel is wider) and a slow pulse.
 * Targets differ from sources by shape as well as color: a source is a solid
 * disc, a target is a ring with a star inside. None of this leans on a
 * red/green pair.
 */

/** sRGB hex colors, as shown on screen. */
export const PALETTE = {
  /** Opaque base under the tiles. */
  board: '#070B14',
  /** Tile faces (the top of each tile). */
  tileFace: '#E6EAF2',
  /** Path channel in the face, the casing around every bright mark, and tile side walls. */
  pathIdle: '#1A2030',
  /** Bright core inside a lit channel. */
  pathLit: '#FFD447',
  /** Source disc. */
  source: '#FFF1B8',
  /** Target ring, and the target star once it is lit. */
  target: '#5CE1FF',
  /** Tiles that block light and never turn. */
  block: '#B4BCCC',
  /**
   * Gaze dwell progress ring, drawn on a light casing (tileFace) that sits in
   * a dark track (pathIdle). Track and casing are full rings while gaze holds.
   */
  gazeRing: '#2E0F9E',
  /** Frame around a hovered tile, at face height in the gap, over the base. */
  hover: '#FFFFFF',
  panelBg: '#0B1020',
  panelText: '#F2F5FA',
  /** Highlighted text and button labels on panels. */
  panelAccent: '#FFD447',
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** WCAG 2 AAA for normal text. Every pair below must reach it. */
export const MIN_CONTRAST = 7;

/** Design value: darkest point of the tile face grain, as a linear gain. */
export const GRAIN_MIN_GAIN = 0.88;

/** Design value: darkest point of the base grain. The base only ever gets darker. */
export const BOARD_GRAIN_MIN_GAIN = 0.7;

/** Design value: low point of the slow pulse on lit cores and lit targets, linear gain. */
export const PULSE_MIN_GAIN = 0.75;

/** Design value: one pulse cycle, ms. */
export const PULSE_PERIOD_MS = 2400;

export interface ContrastPair {
  fg: PaletteKey;
  bg: PaletteKey;
  /** Linear gain applied to the color first (grain, pulse low point). Default 1. */
  fgGain?: number;
  bgGain?: number;
  where: string;
}

/** Every foreground/background pair that touches on screen, at its worst case. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'tileFace', bg: 'board', where: 'tile face against the base' },
  {
    fg: 'tileFace',
    fgGain: GRAIN_MIN_GAIN,
    bg: 'board',
    where: 'darkest face grain against the base',
  },
  {
    fg: 'pathIdle',
    bg: 'tileFace',
    where: 'path channel on a face; dark gaze track around the light gaze casing',
  },
  {
    fg: 'pathIdle',
    bg: 'tileFace',
    bgGain: GRAIN_MIN_GAIN,
    where: 'path channel, or a dark side wall, on the darkest face grain (bevel at the edge)',
  },
  {
    fg: 'pathLit',
    bg: 'pathIdle',
    where: 'lit core inside its channel, next to a dark side wall, and under the edge of the gaze track',
  },
  { fg: 'pathLit', bg: 'board', where: 'end of a lit core at the face edge, over the base' },
  {
    fg: 'pathLit',
    fgGain: PULSE_MIN_GAIN,
    bg: 'pathIdle',
    where: 'lit core at the pulse low point',
  },
  { fg: 'source', bg: 'pathIdle', where: 'source disc and its beam inside the casing' },
  { fg: 'source', bg: 'board', where: 'end of the source beam at the face edge, over the base' },
  {
    fg: 'target',
    bg: 'pathIdle',
    where: 'target ring and lit star inside the casing, and under the edge of the gaze track',
  },
  {
    fg: 'target',
    fgGain: PULSE_MIN_GAIN,
    bg: 'pathIdle',
    where: 'lit target at the pulse low point',
  },
  { fg: 'block', bg: 'board', where: 'block tile against the base' },
  { fg: 'pathIdle', bg: 'block', where: 'cross mark on a block tile' },
  { fg: 'gazeRing', bg: 'tileFace', where: 'gaze progress ring on its light casing' },
  { fg: 'hover', bg: 'board', where: 'hover frame in the gap over the base' },
  { fg: 'hover', bg: 'pathIdle', where: 'hover frame next to a dark side wall' },
  { fg: 'panelText', bg: 'panelBg', where: 'panel text' },
  { fg: 'panelAccent', bg: 'panelBg', where: 'panel highlight text' },
];

/** '#rgb' or '#rrggbb' to sRGB channels in 0..1. Throws on anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new Error(`not a hex color: ${hex}`);
  }
  let digits = m[1];
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('');
  }
  const n = parseInt(digits, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb: readonly [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** WCAG 2 relative luminance of an sRGB hex color. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. Order of the two colors does not matter. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The color after a linear gain, as the renderer shows it: material color and
 * texture multiply in linear space, then the result is encoded to sRGB.
 */
export function shadeHex(hex: string, gain: number): string {
  const lin = hexToRgb(hex).map((c) => srgbToLinear(c) * gain);
  return rgbToHex([
    linearToSrgb(lin[0]),
    linearToSrgb(lin[1]),
    linearToSrgb(lin[2]),
  ]);
}

function side(key: PaletteKey, gain: number | undefined): string {
  return gain === undefined || gain === 1 ? PALETTE[key] : shadeHex(PALETTE[key], gain);
}

/** For example 'pathIdle/tileFace*0.88'. */
export function pairLabel(pair: ContrastPair): string {
  const g = (v: number | undefined) => (v === undefined || v === 1 ? '' : `*${v.toFixed(2)}`);
  return `${pair.fg}${g(pair.fgGain)}/${pair.bg}${g(pair.bgGain)}`;
}

export function pairRatio(pair: ContrastPair): number {
  return contrastRatio(side(pair.fg, pair.fgGain), side(pair.bg, pair.bgGain));
}

/**
 * Pulse gain at a time in ms: a slow sine between PULSE_MIN_GAIN and 1.
 * Starts at 1 so a freshly lit path shows at full brightness.
 */
export function pulseGain(timeMs: number): number {
  const phase = (timeMs / PULSE_PERIOD_MS) * Math.PI * 2;
  return PULSE_MIN_GAIN + (1 - PULSE_MIN_GAIN) * (0.5 + 0.5 * Math.cos(phase));
}
