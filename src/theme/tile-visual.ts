/**
 * The look of one tile, in a unit cell: 1 x 1 on the XZ plane, up is +Y,
 * cell center at the origin, top of the dark base at y = 0. N is the far
 * edge (-Z), E is +X, as in src/puzzle/types.ts. The caller scales the whole
 * object uniformly, for example object3d.scale.setScalar(TILE_SIZE), and
 * places it in the cell.
 *
 * Path channels open on the same sides as OPENINGS in types.ts, turned by
 * Rotation (clockwise seen from above).
 *
 * Kinds:
 * - straight, corner, tee, cross: dark channels; lit means a wider channel
 *   with a bright core that pulses.
 * - source: always lit. Solid bright disc in a dark casing, plus its beam
 *   in the same color (one shape, no light-on-light edge).
 * - target: ring with a star inside. Dark star while unlit; bright star and
 *   pulsing ring once lit.
 * - block: gray block with a dark cross. No channels.
 * - empty: only the dark base.
 *
 * Geometries are shared between tiles of the same kind, except the gaze
 * ring, which each tile owns (its draw range is the progress).
 */
import { BoxGeometry, type BufferGeometry, Group, Mesh, type Material } from 'three';
import { OPENINGS, type Dir, type Rotation, type TileKind } from '../puzzle/types.ts';
import { getThemeMaterials } from './materials.ts';
import {
  crossGeometry,
  discGeometry,
  frameGeometry,
  rectsGeometry,
  ringGeometry,
  starGeometry,
  type Rect,
} from './shapes.ts';

/** Design values, in cell units (the cell is 1 x 1). */
export const TILE_LAYOUT = {
  padThickness: 0.08,
  /** Raised face, centered in the cell. The rest of the cell shows the dark base. */
  faceSize: 0.88,
  faceHeight: 0.1,
  idleWidth: 0.16,
  litCasingWidth: 0.26,
  litCoreWidth: 0.14,
  /** Height between stacked flat marks on the face. */
  layerStep: 0.006,
  hoverInner: 0.452,
  hoverOuter: 0.492,
  /**
   * Gaze overlay, from the outside in: a full dark track, a full light
   * casing, then the progress arc. The track keeps the light casing off lit
   * cores and target rings (light next to light), so every edge of the
   * overlay is one of the checked pairs. The track's outer edge may hang a
   * little over the dark gap at the middle of each side; it stays inside
   * hoverInner.
   */
  gazeTrackInner: 0.28,
  gazeTrackOuter: 0.45,
  gazeCasingInner: 0.305,
  gazeCasingOuter: 0.425,
  gazeInner: 0.33,
  gazeOuter: 0.4,
  gazeSegments: 48,
  /** Quarter turn animation, ms. */
  rotateMs: 160,
} as const;

export interface TileVisual {
  readonly object3d: Group;
  readonly kind: TileKind;
  /** Turns to `rot`, the short way round. Animated through update() unless animate is false. */
  setRotation(rot: Rotation, animate?: boolean): void;
  /** Source tiles stay lit whatever is passed. Block and empty tiles ignore it. */
  setLit(lit: boolean): void;
  /** Dwell progress 0..1, drawn clockwise from N. 0 hides the ring. */
  setGazeProgress(p: number): void;
  setHover(on: boolean): void;
  /** Advances the turn animation. Call once per frame. */
  update(dtMs: number): void;
  /** Detaches from the parent and frees what this tile owns. */
  dispose(): void;
}

const L = TILE_LAYOUT;
const HALF = L.faceSize / 2;
const TOP = L.faceHeight;
const layer = (n: number) => TOP + n * L.layerStep;
const QUARTER = Math.PI / 2;

const cache = new Map<string, BufferGeometry>();

function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

/** Arm from the center to the face edge on side `dir`, width w. */
function armRect(dir: Dir, w: number): Rect {
  const h = w / 2;
  switch (dir) {
    case 'N':
      return [-h, -HALF, h, h];
    case 'S':
      return [-h, -h, h, HALF];
    case 'E':
      return [-h, -h, HALF, h];
    case 'W':
      return [-HALF, -h, h, h];
  }
}

function armsGeometry(kind: TileKind, w: number, y: number): BufferGeometry {
  return cached(`arms:${kind}:${w}:${y}`, () =>
    rectsGeometry(
      OPENINGS[kind].map((d) => armRect(d, w)),
      y,
    ),
  );
}

function mesh(geometry: BufferGeometry, material: Material | Material[], name: string): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
}

/**
 * Materials for a raised body box: `top` on +Y, `side` everywhere else.
 * BoxGeometry groups run +X, -X, +Y, -Y, +Z, -Z.
 */
function bodyMaterials(top: Material, side: Material): Material[] {
  return [side, side, top, side, side, side];
}

export function createTileVisual(kind: TileKind, initialRotation: Rotation = 0): TileVisual {
  const mat = getThemeMaterials();
  const root = new Group();
  root.name = `TileVisual_${kind}`;
  /** Everything that turns with the tile. */
  const spin = new Group();
  spin.name = 'spin';
  root.add(spin);

  root.add(
    mesh(
      cached('pad', () => new BoxGeometry(1, L.padThickness, 1).translate(0, -L.padThickness / 2, 0)),
      mat.pad,
      'pad',
    ),
  );

  // At face height, in the gap around the face. Laid on the base it was hidden
  // on three sides in a seated, angled view (behind this face and the next row).
  const hover = mesh(
    cached('hover', () => frameGeometry(L.hoverInner, L.hoverOuter, layer(1))),
    mat.hover,
    'hover',
  );
  hover.visible = false;
  root.add(hover);

  const body = () =>
    cached('body', () =>
      new BoxGeometry(L.faceSize, L.faceHeight, L.faceSize).translate(0, L.faceHeight / 2, 0),
    );

  const faceBody = bodyMaterials(mat.face, mat.side);
  let setLitImpl: (lit: boolean) => void = () => {};

  switch (kind) {
    case 'straight':
    case 'corner':
    case 'tee':
    case 'cross': {
      spin.add(mesh(body(), faceBody, 'face'));
      const idle = mesh(armsGeometry(kind, L.idleWidth, layer(1)), mat.pathIdle, 'channel');
      const casing = mesh(armsGeometry(kind, L.litCasingWidth, layer(1)), mat.pathIdle, 'litCasing');
      const core = mesh(armsGeometry(kind, L.litCoreWidth, layer(2)), mat.pathLit, 'litCore');
      spin.add(idle, casing, core);
      setLitImpl = (lit) => {
        idle.visible = !lit;
        casing.visible = lit;
        core.visible = lit;
      };
      break;
    }
    case 'source': {
      spin.add(mesh(body(), faceBody, 'face'));
      // The beam takes the disc's color, so disc and beam are one bright shape.
      // In pathLit the disc edge would meet the amber core with almost no
      // contrast (a light-on-light edge the pair list does not allow).
      spin.add(
        mesh(armsGeometry(kind, L.litCasingWidth, layer(1)), mat.pathIdle, 'litCasing'),
        mesh(armsGeometry(kind, L.litCoreWidth, layer(2)), mat.source, 'litCore'),
        mesh(cached('sourceCasing', () => discGeometry(0.26, layer(1))), mat.pathIdle, 'discCasing'),
        mesh(cached('sourceDisc', () => discGeometry(0.19, layer(3))), mat.source, 'disc'),
      );
      break;
    }
    case 'target': {
      spin.add(mesh(body(), faceBody, 'face'));
      spin.add(
        mesh(cached('targetCasing', () => ringGeometry(0.2, 0.36, layer(1))), mat.pathIdle, 'ringCasing'),
        mesh(cached('starCasing', () => starGeometry(0.17, 0.075, layer(1))), mat.pathIdle, 'starCasing'),
      );
      const ring = mesh(cached('targetRing', () => ringGeometry(0.235, 0.325, layer(2))), mat.targetRing, 'ring');
      const star = mesh(cached('starFill', () => starGeometry(0.12, 0.05, layer(2))), mat.targetLit, 'star');
      spin.add(ring, star);
      setLitImpl = (lit) => {
        ring.material = lit ? mat.targetLit : mat.targetRing;
        star.visible = lit;
      };
      break;
    }
    case 'block': {
      spin.add(mesh(body(), bodyMaterials(mat.block, mat.side), 'block'));
      spin.add(mesh(cached('blockCross', () => crossGeometry(0.3, 0.09, layer(1))), mat.pathIdle, 'cross'));
      break;
    }
    case 'empty':
      break;
  }
  setLitImpl(false);

  // Gaze overlay: outside `spin` so progress always starts at the far edge.
  // Track and casing are full rings shared by all tiles; only the progress
  // arc is this tile's own (its draw range is the progress).
  let gaze: { track: Mesh; casing: Mesh; ring: Mesh } | null = null;
  const ensureGaze = () => {
    if (!gaze) {
      gaze = {
        track: mesh(
          cached('gazeTrack', () =>
            ringGeometry(L.gazeTrackInner, L.gazeTrackOuter, layer(4), L.gazeSegments),
          ),
          mat.pathIdle,
          'gazeTrack',
        ),
        casing: mesh(
          cached('gazeCasing', () =>
            ringGeometry(L.gazeCasingInner, L.gazeCasingOuter, layer(5), L.gazeSegments),
          ),
          mat.gazeCasing,
          'gazeCasing',
        ),
        ring: mesh(ringGeometry(L.gazeInner, L.gazeOuter, layer(6), L.gazeSegments), mat.gazeRing, 'gazeRing'),
      };
      root.add(gaze.track, gaze.casing, gaze.ring);
    }
    return gaze;
  };

  let rot: Rotation = initialRotation;
  let targetAngle = -rot * QUARTER;
  let fromAngle = targetAngle;
  let animMs = 0;
  let animating = false;
  spin.rotation.y = targetAngle;

  return {
    object3d: root,
    kind,
    setRotation(next, animate = true) {
      const delta = (((next - rot) % 4) + 4) % 4;
      if (delta === 0) {
        return;
      }
      rot = next;
      const steps = delta === 3 ? -1 : delta;
      targetAngle -= steps * QUARTER;
      if (animate) {
        fromAngle = spin.rotation.y;
        animMs = 0;
        animating = true;
      } else {
        animating = false;
        targetAngle = -rot * QUARTER;
        spin.rotation.y = targetAngle;
      }
    },
    setLit(lit) {
      setLitImpl(lit);
    },
    setGazeProgress(p) {
      const v = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
      if (v <= 0) {
        if (gaze) {
          gaze.track.visible = false;
          gaze.casing.visible = false;
          gaze.ring.visible = false;
        }
        return;
      }
      const g = ensureGaze();
      g.ring.geometry.setDrawRange(0, Math.ceil(v * L.gazeSegments) * 6);
      g.track.visible = true;
      g.casing.visible = true;
      g.ring.visible = true;
    },
    setHover(on) {
      hover.visible = on;
    },
    update(dtMs) {
      if (!animating || !Number.isFinite(dtMs)) {
        return;
      }
      animMs += Math.max(0, dtMs);
      const k = Math.min(1, animMs / L.rotateMs);
      const eased = 1 - Math.pow(1 - k, 3);
      spin.rotation.y = fromAngle + (targetAngle - fromAngle) * eased;
      if (k >= 1) {
        animating = false;
        // Keep the angle small; a full turn looks the same.
        targetAngle = -rot * QUARTER;
        spin.rotation.y = targetAngle;
      }
    },
    dispose() {
      root.removeFromParent();
      if (gaze) {
        // Track and casing geometries are shared (disposeTileShapes frees them).
        gaze.ring.geometry.dispose();
        gaze = null;
      }
    },
  };
}

/** Frees the geometries shared by all tiles. Call only when no tile is left. */
export function disposeTileShapes(): void {
  for (const g of cache.values()) {
    g.dispose();
  }
  cache.clear();
}
