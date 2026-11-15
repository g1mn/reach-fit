/**
 * Placeholder visuals for the board, tiles, panel and buttons.
 *
 * Flat unlit shapes in a few high-contrast colors. MV06 makes the real theme
 * (createTileVisual) and MV08 swaps it in; keep the entity names and the
 * methods TileView exposes (setRotation, setLit, setHover, setGazeProgress,
 * update) so the swap stays local.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from '@iwsdk/core';
import { DIRS, OPENINGS } from '../puzzle/types.ts';
import type { Rotation, Tile } from '../puzzle/types.ts';
import { PALETTE, type Palette } from '../theme/palette.ts';
import { TILE_VISUAL_RATIO } from './arc.ts';
import { TextPlane } from './text.ts';

/** Placeholder palette. MV06 owns the final colors. */
export const COLORS = {
  boardBase: 0x0b0f14,
  tileFace: 0x222a35,
  tileEmpty: 0x141a21,
  tileHover: 0x3a4a5e,
  pathIdle: 0x9aa7b8,
  pathLit: 0xffd23f,
  source: 0xffd23f,
  target: 0x4fd1ff,
  block: 0x000000,
  blockMark: 0xe5484d,
  ring: 0xffffff,
  trail: 0x4fd1ff,
  panelBg: '#0b0f14',
  panelText: '#ffffff',
  buttonBg: 0x2d3a4a,
  buttonHover: 0x46607c,
  buttonText: '#ffffff',
} as const;

/** Tile turn animation speed, 1/s for the exponential ease. Design value. */
const TURN_EASE_PER_S = 18;
const QUARTER = Math.PI / 2;

function basic(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, toneMapped: false });
}

const ringCache = new Map<string, RingGeometry>();
/** Progress ring geometry, quantized to 1/32 steps and shared. Never disposed. */
function ringGeometry(inner: number, outer: number, progress: number): RingGeometry {
  const step = Math.max(1, Math.min(32, Math.round(progress * 32)));
  const key = `${inner.toFixed(4)}:${outer.toFixed(4)}:${step}`;
  let g = ringCache.get(key);
  if (!g) {
    g = new RingGeometry(inner, outer, 48, 1, Math.PI / 2, (-2 * Math.PI * step) / 32);
    ringCache.set(key, g);
  }
  return g;
}

export class TileView {
  readonly root: Group;
  private readonly size: number;
  private readonly baseMat: MeshBasicMaterial;
  private readonly pathMat: MeshBasicMaterial;
  private readonly glyph = new Group();
  private readonly ring: Mesh;
  private readonly ringMat = new MeshBasicMaterial({ color: COLORS.ring, toneMapped: false, side: DoubleSide });
  private readonly owned: (BufferGeometry | MeshBasicMaterial)[] = [];
  private readonly faceColor: number;
  private angle = 0;
  private targetAngle = 0;
  private gaze = 0;

  constructor(tile: Tile, name: string, size: number) {
    this.size = size;
    const vis = size * TILE_VISUAL_RATIO;
    this.root = new Group();
    this.root.name = name;
    this.faceColor =
      tile.kind === 'empty' ? COLORS.tileEmpty : tile.kind === 'block' ? COLORS.block : COLORS.tileFace;
    this.baseMat = basic(this.faceColor);
    this.pathMat = basic(tile.kind === 'source' ? COLORS.source : COLORS.pathIdle);
    const baseGeo = new BoxGeometry(vis, 0.01, vis);
    const base = new Mesh(baseGeo, this.baseMat);
    base.name = 'tile-base';
    base.position.y = 0.005;
    this.root.add(base);
    this.owned.push(baseGeo, this.baseMat, this.pathMat, this.ringMat);

    this.glyph.position.y = 0.0102;
    this.root.add(this.glyph);
    this.buildGlyph(tile, vis);

    this.ring = new Mesh(ringGeometry(vis * 0.3, vis * 0.42, 1), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.016;
    this.ring.visible = false;
    this.ring.renderOrder = 2;
    this.root.add(this.ring);

    this.setRotation(tile.rot, false);
  }

  private buildGlyph(tile: Tile, vis: number): void {
    const add = (geo: BufferGeometry, mat: MeshBasicMaterial, y = 0): Mesh => {
      const m = new Mesh(geo, mat);
      m.position.y = y;
      this.glyph.add(m);
      this.owned.push(geo);
      return m;
    };
    const flat = (geo: BufferGeometry): BufferGeometry => geo.rotateX(-Math.PI / 2);
    const bar = vis * 0.2;
    if (tile.kind === 'block') {
      const markMat = basic(COLORS.blockMark);
      this.owned.push(markMat);
      for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
        const m = add(new BoxGeometry(vis * 0.12, 0.002, vis * 0.8), markMat);
        m.rotation.y = yaw;
      }
      return;
    }
    if (tile.kind === 'empty') {
      return;
    }
    if (tile.kind === 'target') {
      const targetMat = this.pathMat;
      targetMat.color.setHex(COLORS.target);
      add(flat(new RingGeometry(vis * 0.16, vis * 0.3, 40)), targetMat, 0.001);
      return;
    }
    for (const d of OPENINGS[tile.kind]) {
      const i = DIRS.indexOf(d);
      const pivot = new Group();
      pivot.rotation.y = -i * QUARTER;
      const geo = new BoxGeometry(bar, 0.002, vis / 2);
      const m = new Mesh(geo, this.pathMat);
      m.position.z = -vis / 4;
      pivot.add(m);
      this.glyph.add(pivot);
      this.owned.push(geo);
    }
    if (tile.kind === 'source') {
      add(flat(new CircleGeometry(vis * 0.26, 32)), this.pathMat, 0.001);
    } else {
      add(new BoxGeometry(bar, 0.002, bar), this.pathMat);
    }
  }

  /** Sets the shown rotation. With animate, turns the short way clockwise from the current one. */
  setRotation(rot: Rotation, animate = true): void {
    const want = -rot * QUARTER;
    if (!animate) {
      this.angle = want;
      this.targetAngle = want;
      this.glyph.rotation.y = want;
      return;
    }
    // Next clockwise angle equal to want modulo a full turn.
    let next = this.targetAngle;
    for (let k = 0; k < 4; k++) {
      if (Math.abs(Math.sin((next - want) / 2)) < 1e-6) {
        break;
      }
      next -= QUARTER;
    }
    this.targetAngle = next;
  }

  setLit(lit: boolean, kind: Tile['kind']): void {
    if (kind === 'target') {
      this.pathMat.color.setHex(lit ? COLORS.pathLit : COLORS.target);
    } else if (kind !== 'source') {
      this.pathMat.color.setHex(lit ? COLORS.pathLit : COLORS.pathIdle);
    }
  }

  setHover(on: boolean): void {
    this.baseMat.color.setHex(on && this.faceColor === COLORS.tileFace ? COLORS.tileHover : this.faceColor);
  }

  /** 0 hides the ring, 1 is a full circle. */
  setGazeProgress(p: number): void {
    if (Math.abs(p - this.gaze) < 1 / 64 && (p > 0) === this.ring.visible) {
      return;
    }
    this.gaze = p;
    this.ring.visible = p > 0;
    if (p > 0) {
      const vis = this.size * TILE_VISUAL_RATIO;
      this.ring.geometry = ringGeometry(vis * 0.3, vis * 0.42, p);
    }
  }

  update(dtSec: number): void {
    if (this.angle !== this.targetAngle) {
      const k = Math.min(1, dtSec * TURN_EASE_PER_S);
      this.angle += (this.targetAngle - this.angle) * k;
      if (Math.abs(this.targetAngle - this.angle) < 1e-3) {
        this.angle = this.targetAngle;
      }
      this.glyph.rotation.y = this.angle;
    }
  }

  dispose(): void {
    for (const o of this.owned) {
      o.dispose();
    }
  }
}

export type ButtonName =
  | 'Btn_Next'
  | 'Btn_Restart'
  | 'Btn_Reach'
  | 'Btn_Language'
  | 'Btn_Sound'
  | 'Btn_Voice'
  | 'Btn_Contrast'
  | 'Btn_Look'
  | 'Btn_Mic';
/** First row: game and general buttons. */
export const MAIN_BUTTONS: readonly ButtonName[] = [
  'Btn_Next',
  'Btn_Restart',
  'Btn_Reach',
  'Btn_Language',
  'Btn_Sound',
  'Btn_Voice',
];
/** Second row: access settings, always on show (no menu to open). */
export const ACCESS_BUTTONS: readonly ButtonName[] = ['Btn_Contrast', 'Btn_Look', 'Btn_Mic'];
export const BUTTON_NAMES: readonly ButtonName[] = [...MAIN_BUTTONS, ...ACCESS_BUTTONS];

/** Button size, m. Design value. */
export const BUTTON_W = 0.066;
export const BUTTON_H = 0.036;
const BUTTON_D = 0.008;
/** Gap between buttons in a row, m. Design value. */
const BUTTON_GAP = 0.004;
/** Outline around each button face, m on each side. Design value. */
const BUTTON_EDGE = 0.0015;
/** Width of a second-row button: three of them span the first row. */
export const ACCESS_BUTTON_W =
  (MAIN_BUTTONS.length * BUTTON_W + (MAIN_BUTTONS.length - 1) * BUTTON_GAP - 2 * BUTTON_GAP) / 3;

export class ButtonView {
  readonly root: Group;
  readonly width: number;
  private readonly faceMat = basic(COLORS.buttonBg);
  private readonly edgeMat = basic(COLORS.buttonBg);
  private readonly label: TextPlane;
  private readonly bar: Mesh;
  private readonly barMat = basic(COLORS.ring);
  private readonly meter: Mesh;
  private readonly meterMat = basic(COLORS.ring);
  private readonly owned: (BufferGeometry | MeshBasicMaterial)[] = [];
  private colors: Palette = PALETTE;
  private hover = false;

  constructor(name: ButtonName, width = BUTTON_W) {
    this.root = new Group();
    this.root.name = name;
    this.width = width;
    const faceGeo = new BoxGeometry(width, BUTTON_H, BUTTON_D);
    const face = new Mesh(faceGeo, this.faceMat);
    face.name = 'button-face';
    this.root.add(face);
    // Outline: a slightly larger flat box just behind the face, so the button
    // edge stands out from the panel in every contrast mode (checked pair
    // buttonEdge/panelBg).
    const edgeGeo = new BoxGeometry(width + 2 * BUTTON_EDGE, BUTTON_H + 2 * BUTTON_EDGE, BUTTON_D / 2);
    const edge = new Mesh(edgeGeo, this.edgeMat);
    edge.name = 'button-edge';
    edge.position.z = -BUTTON_D / 4 - 0.0005;
    this.root.add(edge);
    this.label = new TextPlane(width * 0.94, BUTTON_H * 0.86, {
      color: COLORS.buttonText,
      background: null,
      maxFontPx: 30,
      minFontPx: 12,
      padding: 0.08,
    });
    this.label.mesh.position.z = BUTTON_D / 2 + 0.0006;
    this.root.add(this.label.mesh);
    const barGeo = new BoxGeometry(1, 1, 1);
    this.bar = new Mesh(barGeo, this.barMat);
    this.bar.scale.set(0.0001, 0.003, 0.002);
    this.bar.position.set(-width / 2, -BUTTON_H / 2 - 0.004, 0);
    this.bar.visible = false;
    this.root.add(this.bar);
    // Loudness meter above the Mic button: how close the last sound came to counting.
    this.meter = new Mesh(barGeo, this.meterMat);
    this.meter.scale.set(0.0001, 0.005, 0.002);
    this.meter.position.set(-width / 2, BUTTON_H / 2 + 0.0055, 0);
    this.meter.visible = false;
    this.root.add(this.meter);
    this.owned.push(faceGeo, this.faceMat, edgeGeo, this.edgeMat, barGeo, this.barMat, this.meterMat);
    this.setColors(PALETTE);
  }

  setLabel(text: string): void {
    this.label.setText(text);
  }

  setHover(on: boolean): void {
    this.hover = on;
    this.faceMat.color.set(on ? this.colors.buttonHover : this.colors.buttonBg);
  }

  /** Colors of a contrast mode. */
  setColors(colors: Palette): void {
    this.colors = colors;
    this.edgeMat.color.set(colors.buttonEdge);
    this.barMat.color.set(colors.panelText);
    this.label.setColors(colors.buttonText, null);
    this.setHover(this.hover);
  }

  setGazeProgress(p: number): void {
    this.bar.visible = p > 0;
    const w = Math.max(0.0001, this.width * Math.min(1, p));
    this.bar.scale.x = w;
    this.bar.position.x = -this.width / 2 + w / 2;
  }

  /** null hides the meter. level 0 to 1; at 1 the sound counts and the bar turns the accent color. */
  setMeter(level: number | null): void {
    this.meter.visible = level !== null;
    if (level === null) {
      return;
    }
    const w = Math.max(0.0001, this.width * Math.min(1, level));
    this.meter.scale.x = w;
    this.meter.position.x = -this.width / 2 + w / 2;
    this.meterMat.color.set(level >= 1 ? this.colors.panelAccent : this.colors.panelText);
  }

  dispose(): void {
    this.label.dispose();
    for (const o of this.owned) {
      o.dispose();
    }
  }
}

/** Panel size, m. Design value. PANEL_H is the message area (top part); the panel plate reaches PANEL_BOTTOM. */
export const PANEL_W = 0.42;
export const PANEL_H = 0.19;
/** Lowest point of the panel plate below its origin, m (two button rows). Design value. */
export const PANEL_BOTTOM = -0.146;
const ROW1_Y = -0.062;
const ROW2_Y = ROW1_Y - BUTTON_H - 0.016;

/** Upright instruction panel; the buttons are separate entities parented to `root`. */
export class PanelView {
  readonly root = new Group();
  readonly message: TextPlane;
  readonly status: TextPlane;
  private readonly bgGeo = new PlaneGeometry(PANEL_W, PANEL_H / 2 - PANEL_BOTTOM);
  private readonly bgMat = new MeshBasicMaterial({ color: PALETTE.panelBg, toneMapped: false });

  constructor() {
    this.root.name = 'ReachFitPanel';
    const bg = new Mesh(this.bgGeo, this.bgMat);
    bg.position.set(0, (PANEL_H / 2 + PANEL_BOTTOM) / 2, -0.001);
    this.root.add(bg);
    this.message = new TextPlane(PANEL_W * 0.94, 0.085, {
      color: PALETTE.panelText,
      background: PALETTE.panelBg,
      maxFontPx: 72,
      minFontPx: 22,
    });
    this.message.mesh.position.y = 0.045;
    this.root.add(this.message.mesh);
    this.status = new TextPlane(PANEL_W * 0.94, 0.03, {
      color: PALETTE.panelText,
      background: PALETTE.panelBg,
      weight: 500,
      maxFontPx: 40,
      minFontPx: 16,
    });
    this.status.mesh.position.y = -0.016;
    this.root.add(this.status.mesh);
  }

  /** Local position of a button: first row for MAIN_BUTTONS, second row for ACCESS_BUTTONS. */
  slot(name: ButtonName): { x: number; y: number; z: number; width: number } {
    const second = ACCESS_BUTTONS.indexOf(name);
    if (second >= 0) {
      const n = ACCESS_BUTTONS.length;
      const total = n * ACCESS_BUTTON_W + (n - 1) * BUTTON_GAP;
      return {
        x: -total / 2 + ACCESS_BUTTON_W / 2 + second * (ACCESS_BUTTON_W + BUTTON_GAP),
        y: ROW2_Y,
        z: 0.006,
        width: ACCESS_BUTTON_W,
      };
    }
    const i = Math.max(0, MAIN_BUTTONS.indexOf(name));
    return { ...this.buttonSlot(i, MAIN_BUTTONS.length), width: BUTTON_W };
  }

  /** Local position of button i in the first row. */
  buttonSlot(i: number, count: number): { x: number; y: number; z: number } {
    const total = count * BUTTON_W + (count - 1) * BUTTON_GAP;
    return { x: -total / 2 + BUTTON_W / 2 + i * (BUTTON_W + BUTTON_GAP), y: ROW1_Y, z: 0.006 };
  }

  /** Colors of a contrast mode. */
  setColors(colors: Palette): void {
    this.bgMat.color.set(colors.panelBg);
    this.message.setColors(colors.panelText, colors.panelBg);
    this.status.setColors(colors.panelText, colors.panelBg);
  }

  dispose(): void {
    this.message.dispose();
    this.status.dispose();
    this.bgGeo.dispose();
    this.bgMat.dispose();
  }
}

/** Arc-shaped plate under the board. */
export function makeBoardBase(innerR: number, outerR: number, startDeg: number, endDeg: number): Mesh {
  // RingGeometry angle theta lies in XY; after rotateX(-90deg) a point at theta
  // sits at arc angle theta - 90deg in our convention.
  const geo = new RingGeometry(
    innerR,
    outerR,
    64,
    1,
    ((startDeg + 90) * Math.PI) / 180,
    ((endDeg - startDeg) * Math.PI) / 180,
  );
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, basic(COLORS.boardBase));
  mesh.name = 'board-base';
  return mesh;
}

/** Sweep trail drawn on the table while calibrating. */
export class Trail {
  readonly line: Line;
  private readonly positions: Float32Array;
  private count = 0;
  private static readonly MAX = 512;

  constructor() {
    this.positions = new Float32Array(Trail.MAX * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    this.line = new Line(geo, new LineBasicMaterial({ color: COLORS.trail, toneMapped: false }));
    this.line.frustumCulled = false;
    this.line.name = 'reach-trail';
  }

  add(x: number, y: number, z: number): void {
    if (this.count >= Trail.MAX) {
      return;
    }
    this.positions.set([x, y, z], this.count * 3);
    this.count++;
    const geo = this.line.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, this.count);
  }

  clear(): void {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
  }
}

/** Ring shown where the head points during gaze calibration. */
export class Reticle {
  readonly mesh: Mesh;
  private readonly mat = new MeshBasicMaterial({
    color: COLORS.ring,
    toneMapped: false,
    depthTest: false,
    transparent: true,
    side: DoubleSide,
  });

  constructor() {
    this.mesh = new Mesh(ringGeometry(0.012, 0.018, 1), this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.name = 'gaze-reticle';
  }

  setProgress(p: number): void {
    this.mesh.geometry = ringGeometry(0.012, 0.018, Math.max(1 / 32, p));
  }
}
