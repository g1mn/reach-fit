/**
 * Shared materials for every tile and base. Created once, on first use.
 *
 * All are MeshBasicMaterial (unlit, so room lighting cannot shift the colors)
 * with toneMapped = false: the scene may use a filmic tone map, and a tone
 * mapped color would no longer be the palette color that the contrast check
 * measured.
 *
 * updateTheme(dtMs) drives the slow pulse on lit cores and lit targets by
 * changing two shared colors in place. Call it once per frame. It allocates
 * nothing.
 *
 * setThemeMode(mode) recolors every shared material in place (the Contrast
 * button), so tiles already on the board change at once.
 */
import { Color, DoubleSide, MeshBasicMaterial, type Texture } from 'three';
import {
  PALETTE,
  PALETTES,
  PULSE_BY_MODE,
  pulseGain,
  PULSE_PERIOD_MS,
  type ContrastMode,
  type PaletteKey,
} from './palette.ts';
import { createBoardTexture, createFaceTexture } from './textures.ts';

export interface ThemeMaterials {
  /** Dark base under tiles, with base grain. */
  pad: MeshBasicMaterial;
  /** Plain dark base, both sides, for shapes without texture coordinates. */
  base: MeshBasicMaterial;
  /** Top of a tile, with face grain. */
  face: MeshBasicMaterial;
  /** Top of a block tile. */
  block: MeshBasicMaterial;
  /**
   * Side walls of every raised tile (pathIdle color). Seen at an angle, the
   * near wall sits right next to the hover frame and to the ends of the path
   * marks; a dark wall keeps both against dark.
   */
  side: MeshBasicMaterial;
  pathIdle: MeshBasicMaterial;
  /** Pulses. */
  pathLit: MeshBasicMaterial;
  source: MeshBasicMaterial;
  /** Target ring while the target is dark. Steady. */
  targetRing: MeshBasicMaterial;
  /** Target ring and star once lit. Pulses. */
  targetLit: MeshBasicMaterial;
  gazeRing: MeshBasicMaterial;
  /** Light casing under the gaze ring (tileFace color, no grain). */
  gazeCasing: MeshBasicMaterial;
  hover: MeshBasicMaterial;
}

/** Palette key of each shared material. */
const MATERIAL_KEYS: Readonly<Record<keyof ThemeMaterials, PaletteKey>> = {
  pad: 'board',
  base: 'board',
  face: 'tileFace',
  block: 'block',
  side: 'pathIdle',
  pathIdle: 'pathIdle',
  pathLit: 'pathLit',
  source: 'source',
  targetRing: 'target',
  targetLit: 'target',
  gazeRing: 'gazeRing',
  gazeCasing: 'tileFace',
  hover: 'hover',
};

let mode: ContrastMode = 'standard';

interface ThemeState {
  materials: ThemeMaterials;
  textures: Texture[];
  baseLit: Color;
  baseTarget: Color;
  elapsedMs: number;
}

let state: ThemeState | null = null;

function basic(key: PaletteKey, map?: Texture, overlay = false): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: new Color(PALETTE[key]) });
  if (map) {
    m.map = map;
  }
  m.toneMapped = false;
  if (overlay) {
    // Flat marks drawn just above a face. Seen from either side; the small
    // offset keeps them in front of the face they sit on.
    m.side = DoubleSide;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -4;
  }
  return m;
}

function create(): ThemeState {
  const faceTex = createFaceTexture();
  const boardTex = createBoardTexture();
  const materials: ThemeMaterials = {
    pad: basic('board', boardTex),
    base: basic('board'),
    face: basic('tileFace', faceTex),
    block: basic('block'),
    side: basic('pathIdle'),
    pathIdle: basic('pathIdle', undefined, true),
    pathLit: basic('pathLit', undefined, true),
    source: basic('source', undefined, true),
    targetRing: basic('target', undefined, true),
    targetLit: basic('target', undefined, true),
    gazeRing: basic('gazeRing', undefined, true),
    gazeCasing: basic('tileFace', undefined, true),
    hover: basic('hover', undefined, true),
  };
  materials.base.side = DoubleSide;
  const created: ThemeState = {
    materials,
    textures: [faceTex, boardTex],
    baseLit: materials.pathLit.color.clone(),
    baseTarget: materials.targetLit.color.clone(),
    elapsedMs: 0,
  };
  recolor(created);
  return created;
}

function recolor(s: ThemeState): void {
  const palette = PALETTES[mode];
  for (const [name, key] of Object.entries(MATERIAL_KEYS) as [keyof ThemeMaterials, PaletteKey][]) {
    s.materials[name].color.set(palette[key]);
  }
  s.baseLit.copy(s.materials.pathLit.color);
  s.baseTarget.copy(s.materials.targetLit.color);
}

/** Contrast mode now on. */
export function getThemeMode(): ContrastMode {
  return mode;
}

/** Recolors every shared material for a contrast mode. Safe before the first tile exists. */
export function setThemeMode(next: ContrastMode): void {
  mode = next;
  if (state) {
    recolor(state);
  }
}

export function getThemeMaterials(): ThemeMaterials {
  if (!state) {
    state = create();
  }
  return state.materials;
}

/** Advances the pulse. Call once per frame with the frame time in ms. */
export function updateTheme(dtMs: number): void {
  if (!state || !Number.isFinite(dtMs) || dtMs <= 0) {
    return;
  }
  state.elapsedMs = (state.elapsedMs + dtMs) % PULSE_PERIOD_MS;
  const g = PULSE_BY_MODE[mode] ? pulseGain(state.elapsedMs) : 1;
  state.materials.pathLit.color.copy(state.baseLit).multiplyScalar(g);
  state.materials.targetLit.color.copy(state.baseTarget).multiplyScalar(g);
}

/** Frees shared materials and textures. Tiles made before this must not be drawn again. */
export function disposeTheme(): void {
  if (!state) {
    return;
  }
  for (const m of Object.values(state.materials)) {
    m.dispose();
  }
  for (const t of state.textures) {
    t.dispose();
  }
  state = null;
}
