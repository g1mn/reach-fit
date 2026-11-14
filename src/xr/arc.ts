/**
 * Reach arc: fit a circle to one hand sweep and lay the board out along it.
 *
 * Pure math, no three.js and no DOM, so Node tests import it directly.
 * Coordinates are world meters on the table plane: x to the right, z toward
 * the player (forward is -z), matching three.js.
 *
 * Angle convention (same as ReachArc in test-api.ts): degrees around +Y,
 * 0 = straight ahead (-z), positive turns left. A direction at angle a is
 * (-sin a, -cos a) in (x, z).
 */
import type { ReachArc } from '../test-api.ts';

/** Cell pitch in meters, both along a row and between rows. Design value. */
export const TILE_SIZE = 0.055;
/** Visible tile edge as a share of TILE_SIZE, the rest is the gap. Design value. */
export const TILE_VISUAL_RATIO = 0.88;
/** Space between the sweep arc and the outer edge of the far row, m. Design value. */
export const EDGE_MARGIN = 0.01;
/** Sweeps fitting a smaller or larger radius are rejected, m. Design value. */
export const MIN_REACH_RADIUS = 0.3;
export const MAX_REACH_RADIUS = 0.8;
/** Radius used by the gaze and default paths, m. Design value. */
export const DEFAULT_REACH_RADIUS = 0.45;
/** Default arc ends, degrees. Design value. */
export const DEFAULT_ARC_HALF_DEG = 40;
/** A sweep needs at least this many samples and this much turn. Design value. */
export const MIN_SWEEP_SAMPLES = 10;
export const MIN_SWEEP_SPAN_DEG = 30;
/** Root mean square distance from the fitted circle above which a sweep is rejected, m. Design value. */
export const MAX_FIT_RMS = 0.04;
/**
 * Widest angle one row may cover. When a short reach would wrap the inner
 * row further than this around the player, the whole board moves outward
 * just enough. Design value.
 */
export const MAX_ROW_SPAN_RAD = Math.PI * 0.75;

const RAD = Math.PI / 180;

export interface Point2 {
  x: number;
  z: number;
}

export interface CircleFit {
  cx: number;
  cz: number;
  radius: number;
  /** Root mean square of (distance to center - radius), m. */
  rms: number;
}

/** Direction (x, z) for an arc angle in degrees. */
export function dirFromDeg(deg: number): Point2 {
  const a = deg * RAD;
  return { x: -Math.sin(a), z: -Math.cos(a) };
}

/** Arc angle in degrees of point p seen from center c. */
export function degFromCenter(c: Point2, p: Point2): number {
  return Math.atan2(-(p.x - c.x), -(p.z - c.z)) / RAD;
}

/** Wraps degrees into (-180, 180]. */
export function wrapDeg(deg: number): number {
  let x = deg % 360;
  if (x > 180) {
    x -= 360;
  }
  if (x <= -180) {
    x += 360;
  }
  return x;
}

/** Yaw in degrees of a forward vector (x, z). Same convention as arc angles. */
export function yawDegOfForward(x: number, z: number): number {
  return Math.atan2(-x, -z) / RAD;
}

/** Solves a 3x3 linear system with Cramer's rule. Null when singular. */
function solve3(m: number[][], v: number[]): [number, number, number] | null {
  const det = (a: number[][]): number =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) {
    return null;
  }
  const out: number[] = [];
  for (let col = 0; col < 3; col++) {
    const mc = m.map((row, i) => row.map((val, j) => (j === col ? v[i] : val)));
    out.push(det(mc) / d);
  }
  return [out[0], out[1], out[2]];
}

function rmsOf(points: readonly Point2[], cx: number, cz: number, r: number): number {
  let sum = 0;
  for (const p of points) {
    const e = Math.hypot(p.x - cx, p.z - cz) - r;
    sum += e * e;
  }
  return Math.sqrt(sum / points.length);
}

/**
 * Least squares circle fit. An algebraic fit (Kasa) gives the start, then a
 * few Gauss-Newton steps minimize the geometric distance, which matters on
 * short noisy arcs. Null for fewer than 3 points or collinear points.
 */
export function fitCircle(points: readonly Point2[]): CircleFit | null {
  const n = points.length;
  if (n < 3) {
    return null;
  }
  // Algebraic: x^2 + z^2 + D x + E z + F = 0.
  let sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sxw = 0, szw = 0, sw = 0;
  for (const p of points) {
    const w = p.x * p.x + p.z * p.z;
    sx += p.x;
    sz += p.z;
    sxx += p.x * p.x;
    szz += p.z * p.z;
    sxz += p.x * p.z;
    sxw += p.x * w;
    szw += p.z * w;
    sw += w;
  }
  const alg = solve3(
    [
      [sxx, sxz, sx],
      [sxz, szz, sz],
      [sx, sz, n],
    ],
    [-sxw, -szw, -sw],
  );
  if (!alg) {
    return null;
  }
  let cx = -alg[0] / 2;
  let cz = -alg[1] / 2;
  const r2 = cx * cx + cz * cz - alg[2];
  if (!(r2 > 0)) {
    return null;
  }
  let r = Math.sqrt(r2);
  // Geometric refinement: residual e_i = d_i - r.
  for (let iter = 0; iter < 20; iter++) {
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const jte = [0, 0, 0];
    for (const p of points) {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz) || 1e-9;
      const j = [-dx / d, -dz / d, -1];
      const e = d - r;
      for (let a = 0; a < 3; a++) {
        jte[a] += j[a] * e;
        for (let b = 0; b < 3; b++) {
          jtj[a][b] += j[a] * j[b];
        }
      }
    }
    const step = solve3(jtj, [-jte[0], -jte[1], -jte[2]]);
    if (!step) {
      break;
    }
    cx += step[0];
    cz += step[1];
    r += step[2];
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-9) {
      break;
    }
  }
  if (!Number.isFinite(cx) || !Number.isFinite(cz) || !(r > 0)) {
    return null;
  }
  return { cx, cz, radius: r, rms: rmsOf(points, cx, cz, r) };
}

export type SweepRejectReason =
  | 'too-few-samples'
  | 'no-circle'
  | 'too-small'
  | 'too-large'
  | 'too-short'
  | 'not-round'
  | 'wrong-side';

export type SweepResult =
  | { ok: true; arc: ReachArc; fit: CircleFit }
  | { ok: false; reason: SweepRejectReason; fit: CircleFit | null };

/**
 * Turns hand samples into a ReachArc, or says why the sweep is not usable.
 * `head` (x, z) is optional: when given, the circle center must be nearer to
 * the head than the arc is, so a sweep bent the wrong way is rejected.
 */
export function arcFromSweep(
  samples: readonly Point2[],
  tableY: number,
  head?: Point2,
): SweepResult {
  if (samples.length < MIN_SWEEP_SAMPLES) {
    return { ok: false, reason: 'too-few-samples', fit: null };
  }
  const fit = fitCircle(samples);
  if (!fit) {
    return { ok: false, reason: 'no-circle', fit: null };
  }
  if (fit.radius < MIN_REACH_RADIUS) {
    return { ok: false, reason: 'too-small', fit };
  }
  if (fit.radius > MAX_REACH_RADIUS) {
    return { ok: false, reason: 'too-large', fit };
  }
  if (fit.rms > MAX_FIT_RMS) {
    return { ok: false, reason: 'not-round', fit };
  }
  const center = { x: fit.cx, z: fit.cz };
  // Angles relative to the mean sample direction, so an arc that crosses
  // +-180 degrees does not look like a full circle.
  let sx = 0;
  let sz = 0;
  for (const p of samples) {
    const d = Math.hypot(p.x - center.x, p.z - center.z) || 1;
    sx += (p.x - center.x) / d;
    sz += (p.z - center.z) / d;
  }
  const meanDeg = yawDegOfForward(sx, sz);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of samples) {
    const a = meanDeg + wrapDeg(degFromCenter(center, p) - meanDeg);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  const shift = wrapDeg((lo + hi) / 2) - (lo + hi) / 2;
  lo += shift;
  hi += shift;
  if (hi - lo < MIN_SWEEP_SPAN_DEG) {
    return { ok: false, reason: 'too-short', fit };
  }
  if (head) {
    const mid = dirFromDeg((lo + hi) / 2);
    const arcMid = { x: center.x + mid.x * fit.radius, z: center.z + mid.z * fit.radius };
    const dCenter = Math.hypot(head.x - center.x, head.z - center.z);
    const dArc = Math.hypot(head.x - arcMid.x, head.z - arcMid.z);
    if (dCenter >= dArc) {
      return { ok: false, reason: 'wrong-side', fit };
    }
  }
  return {
    ok: true,
    fit,
    arc: {
      center: [fit.cx, tableY, fit.cz],
      radius: fit.radius,
      startDeg: lo,
      endDeg: hi,
      source: 'hand',
    },
  };
}

/** Arc from two held head directions (degrees). Radius is the default. */
export function arcFromGaze(
  head: Point2,
  tableY: number,
  leftDeg: number,
  rightDeg: number,
): ReachArc {
  return {
    center: [head.x, tableY, head.z],
    radius: DEFAULT_REACH_RADIUS,
    startDeg: Math.min(leftDeg, rightDeg),
    endDeg: Math.max(leftDeg, rightDeg),
    source: 'gaze',
  };
}

/** Arc used when neither hands nor gaze gave one. */
export function defaultArc(head: Point2, tableY: number, yawDeg = 0): ReachArc {
  return {
    center: [head.x, tableY, head.z],
    radius: DEFAULT_REACH_RADIUS,
    startDeg: yawDeg - DEFAULT_ARC_HALF_DEG,
    endDeg: yawDeg + DEFAULT_ARC_HALF_DEG,
    source: 'default',
  };
}

export interface CellPlacement {
  r: number;
  c: number;
  /** Cell center, world meters. y is the arc (table) height. */
  x: number;
  y: number;
  z: number;
  /** Distance from the arc center, m. */
  radius: number;
  /** Arc angle of the cell center, degrees. */
  deg: number;
  /** Yaw for the tile so its N side faces away from the arc center, radians. */
  yaw: number;
  /** Cell pitch, always TILE_SIZE. */
  size: number;
}

export interface BoardLayout {
  rows: number;
  cols: number;
  /** Row-major, like Board.tiles. */
  cells: CellPlacement[];
  /** Center radius of each row, row 0 is the far row. */
  rowRadii: number[];
  /** Arc angle the board is centered on, degrees. */
  midDeg: number;
  /** Angle covered by the widest row (the inner one), degrees. */
  spanDeg: number;
  /** Meters the board was moved outward because the inner row would wrap too far. 0 normally. */
  pushedOut: number;
}

/**
 * Lays a rows x cols grid onto the arc. Row r sits at radius
 * R - TILE_SIZE * (r + 0.5) - EDGE_MARGIN, so the far row hugs the sweep and
 * every cell center is inside it. Along a row, cells are TILE_SIZE apart in
 * arc length, centered on the middle of the arc, so the cell size never
 * changes and only the board's bend follows the reach.
 */
export function layoutBoard(arc: ReachArc, rows: number, cols: number): BoardLayout {
  const midDeg = (arc.startDeg + arc.endDeg) / 2;
  const innerNominal = arc.radius - TILE_SIZE * (rows - 0.5) - EDGE_MARGIN;
  const innerNeeded = (cols * TILE_SIZE) / MAX_ROW_SPAN_RAD;
  const pushedOut = innerNominal < innerNeeded ? innerNeeded - innerNominal : 0;
  const rowRadii: number[] = [];
  for (let r = 0; r < rows; r++) {
    rowRadii.push(arc.radius - TILE_SIZE * (r + 0.5) - EDGE_MARGIN + pushedOut);
  }
  const [cx, cy, cz] = arc.center;
  const cells: CellPlacement[] = [];
  for (let r = 0; r < rows; r++) {
    const rr = rowRadii[r];
    for (let c = 0; c < cols; c++) {
      // Column 0 is on the left, which is the larger angle.
      const offset = ((cols - 1) / 2 - c) * TILE_SIZE;
      const deg = midDeg + (offset / rr) / RAD;
      const d = dirFromDeg(deg);
      cells.push({
        r,
        c,
        x: cx + d.x * rr,
        y: cy,
        z: cz + d.z * rr,
        radius: rr,
        deg,
        yaw: deg * RAD,
        size: TILE_SIZE,
      });
    }
  }
  const inner = rowRadii[rows - 1];
  const spanDeg = cols > 1 ? (((cols - 1) * TILE_SIZE) / inner) / RAD : 0;
  return { rows, cols, cells, rowRadii, midDeg, spanDeg, pushedOut };
}

/** Distance between two cell centers, m. Used by tests to check spacing. */
export function cellDistance(a: CellPlacement, b: CellPlacement): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
