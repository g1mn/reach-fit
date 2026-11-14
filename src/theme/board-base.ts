/**
 * Opaque dark bases that go under the tiles, so the board keeps the same
 * contrast whatever room shows through. Every tile already carries its own
 * dark pad (tile-visual.ts); these fill the gaps around and between them.
 * Top surface at y = 0, like the tile pads.
 */
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Mesh } from 'three';
import { getThemeMaterials } from './materials.ts';
import { TILE_LAYOUT } from './tile-visual.ts';

/**
 * Flat base for a rows x cols grid in cell units (one cell = 1), centered on
 * the origin. Cell (r, c) sits at cellCenter(r, c, rows, cols). Scale it with
 * the tiles. `margin` is extra base around the grid, in cells (design value).
 */
export function createBoardBase(rows: number, cols: number, margin = 0.15): Mesh {
  const w = cols + margin * 2;
  const d = rows + margin * 2;
  const t = TILE_LAYOUT.padThickness;
  const m = new Mesh(new BoxGeometry(w, t, d).translate(0, -t / 2 - 0.001, 0), getThemeMaterials().pad);
  m.name = 'BoardBase';
  return m;
}

/** Center of cell (r, c) on the flat base. Row 0 is the far row (-Z). */
export function cellCenter(
  r: number,
  c: number,
  rows: number,
  cols: number,
): { x: number; z: number } {
  return { x: c - (cols - 1) / 2, z: r - (rows - 1) / 2 };
}

export interface ArcBaseOptions {
  /** Meters from the arc center. */
  innerRadius: number;
  outerRadius: number;
  /**
   * Degrees around +Y, 0 = straight ahead (-Z), as in ReachArc. Rotation by
   * the right-hand rule: a positive angle swings from -Z toward -X (left).
   * Order of start and end does not matter.
   */
  startDeg: number;
  endDeg: number;
  /** Meters. Design value. */
  thickness?: number;
  segments?: number;
}

/**
 * Base shaped like a slice of a ring, in meters, centered on the arc center.
 * Place it at the arc center at table height. Not scaled with the tiles.
 */
export function createArcBase(options: ArcBaseOptions): Mesh {
  const r0 = Math.max(0, Math.min(options.innerRadius, options.outerRadius));
  const r1 = Math.max(options.innerRadius, options.outerRadius);
  const a0 = (Math.min(options.startDeg, options.endDeg) * Math.PI) / 180;
  const a1 = (Math.max(options.startDeg, options.endDeg) * Math.PI) / 180;
  const n = Math.max(2, Math.floor(options.segments ?? 48));
  const t = options.thickness ?? 0.006;
  const top = -0.0005;
  const bottom = top - t;
  const pos: number[] = [];
  const idx: number[] = [];
  // Direction for angle a: rotate (0, 0, -1) about +Y by a.
  const dir = (a: number): [number, number] => [-Math.sin(a), -Math.cos(a)];
  for (let i = 0; i <= n; i += 1) {
    const [dx, dz] = dir(a0 + ((a1 - a0) * i) / n);
    pos.push(dx * r0, top, dz * r0, dx * r1, top, dz * r1);
    pos.push(dx * r0, bottom, dz * r0, dx * r1, bottom, dz * r1);
  }
  for (let i = 0; i < n; i += 1) {
    const a = i * 4;
    const b = a + 4;
    // Top, bottom, outer wall, inner wall. The material is two-sided, so
    // winding does not matter. The two end caps are left open (thin slab).
    idx.push(a, b + 1, a + 1, a, b, b + 1);
    idx.push(a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    idx.push(a + 1, b + 1, b + 3, a + 1, b + 3, a + 3);
    idx.push(a, a + 2, b + 2, a, b + 2, b);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new Mesh(g, getThemeMaterials().base);
  m.name = 'ArcBase';
  return m;
}
