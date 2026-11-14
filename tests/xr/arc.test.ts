import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arcFromGaze,
  arcFromSweep,
  cellDistance,
  defaultArc,
  DEFAULT_REACH_RADIUS,
  fitCircle,
  layoutBoard,
  MAX_ROW_SPAN_RAD,
  MIN_REACH_RADIUS,
  TILE_SIZE,
} from '../../src/xr/arc.ts';
import { sweep } from './helpers.ts';

const TABLE_Y = 0.72;
const HEAD = { x: 0, z: 0.05 };
/** Right shoulder roughly below and beside the head. */
const SHOULDER = { x: 0.17, z: 0.12 };
const RADII = [0.35, 0.45, 0.6];
const BOARDS: [number, number][] = [
  [3, 3],
  [3, 4],
  [4, 5],
  [4, 6],
];

function sweeps() {
  return RADII.map((r, i) => sweep(SHOULDER, r, -55, 35, 0.004, 11 + i));
}

test('circle fit recovers the synthetic radius within 1 cm', () => {
  for (const s of sweeps()) {
    const fit = fitCircle(s.points);
    assert.ok(fit, 'fit exists');
    assert.ok(Math.abs(fit.radius - s.radius) <= 0.01, `radius ${fit.radius} vs ${s.radius}`);
    assert.ok(Math.hypot(fit.cx - s.center.x, fit.cz - s.center.z) <= 0.02, 'center close');
  }
});

test('sweeps of three radii are accepted as hand arcs', () => {
  for (const s of sweeps()) {
    const res = arcFromSweep(s.points, TABLE_Y, HEAD);
    assert.equal(res.ok, true, `radius ${s.radius} accepted`);
    if (res.ok) {
      assert.equal(res.arc.source, 'hand');
      assert.equal(res.arc.center[1], TABLE_Y);
      assert.ok(res.arc.endDeg - res.arc.startDeg > 80, 'span kept');
    }
  }
});

test('cell size is the same on every sweep and every board', () => {
  const sizes = new Set<number>();
  for (const s of sweeps()) {
    const res = arcFromSweep(s.points, TABLE_Y, HEAD);
    assert.ok(res.ok);
    if (!res.ok) continue;
    for (const [rows, cols] of BOARDS) {
      const lay = layoutBoard(res.arc, rows, cols);
      assert.equal(lay.cells.length, rows * cols);
      for (const cell of lay.cells) {
        sizes.add(cell.size);
      }
      // Row pitch is exactly one cell.
      for (let r = 1; r < rows; r++) {
        assert.ok(Math.abs(lay.rowRadii[r - 1] - lay.rowRadii[r] - TILE_SIZE) < 1e-9);
      }
      // Neighbours along a row are one cell apart (chord of a TILE_SIZE arc).
      for (const a of lay.cells) {
        const b = lay.cells.find((x) => x.r === a.r && x.c === a.c + 1);
        if (!b) continue;
        const d = cellDistance(a, b);
        assert.ok(d <= TILE_SIZE + 1e-9 && d >= TILE_SIZE * 0.97, `row spacing ${d}`);
      }
    }
  }
  assert.deepEqual([...sizes], [TILE_SIZE]);
});

test('every cell center is inside the sweep radius + 2 cm', () => {
  for (const s of sweeps()) {
    const res = arcFromSweep(s.points, TABLE_Y, HEAD);
    assert.ok(res.ok);
    if (!res.ok) continue;
    for (const [rows, cols] of BOARDS) {
      const lay = layoutBoard(res.arc, rows, cols);
      assert.equal(lay.pushedOut, 0, `no push for r=${s.radius} ${rows}x${cols}`);
      for (const cell of lay.cells) {
        const d = Math.hypot(cell.x - s.center.x, cell.z - s.center.z);
        assert.ok(d <= s.radius + 0.02, `cell ${cell.r},${cell.c} at ${d} for R=${s.radius}`);
      }
    }
  }
});

test('shortest accepted reach with the widest board: pushed out, still inside R + 2 cm', () => {
  // Just above the smallest accepted radius, so the inner row would wrap too
  // far and layoutBoard moves the board outward (pushedOut > 0).
  const s = sweep(SHOULDER, MIN_REACH_RADIUS + 0.005, -55, 35, 0.002, 21);
  const res = arcFromSweep(s.points, TABLE_Y, HEAD);
  assert.equal(res.ok, true, 'sweep accepted');
  if (!res.ok) return;
  const lay = layoutBoard(res.arc, 4, 6);
  assert.ok(lay.pushedOut > 0, 'board moved outward');
  assert.ok((lay.spanDeg * Math.PI) / 180 <= MAX_ROW_SPAN_RAD + 1e-9, 'inner row span capped');
  for (const cell of lay.cells) {
    assert.equal(cell.size, TILE_SIZE);
    const d = Math.hypot(cell.x - s.center.x, cell.z - s.center.z);
    assert.ok(d <= s.radius + 0.02, `cell ${cell.r},${cell.c} at ${d} for R=${s.radius}`);
  }
});

test('far row is row 0 and column 0 is on the left', () => {
  const arc = defaultArc(HEAD, TABLE_Y, 0);
  const lay = layoutBoard(arc, 3, 4);
  const at = (r: number, c: number) => lay.cells.find((x) => x.r === r && x.c === c)!;
  assert.ok(at(0, 1).z < at(2, 1).z, 'row 0 is further forward (-z)');
  assert.ok(at(1, 0).x < at(1, 3).x, 'column 0 is left of column 3');
  // Straight ahead arc: board centered on x of the head.
  const xs = lay.cells.map((c) => c.x);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - HEAD.x) < 1e-6);
});

test('bad sweeps are rejected with a reason', () => {
  const small = sweep(SHOULDER, 0.2, -50, 40, 0.002, 5);
  assert.deepEqual(reason(arcFromSweep(small.points, TABLE_Y, HEAD)), 'too-small');
  const large = sweep(SHOULDER, 0.95, -30, 30, 0.002, 6, 1);
  assert.deepEqual(reason(arcFromSweep(large.points, TABLE_Y, HEAD)), 'too-large');
  const short = sweep(SHOULDER, 0.45, 0, 20, 0.001, 7, 1);
  assert.deepEqual(reason(arcFromSweep(short.points, TABLE_Y, HEAD)), 'too-short');
  assert.deepEqual(reason(arcFromSweep(short.points.slice(0, 4), TABLE_Y, HEAD)), 'too-few-samples');
  // Bent toward the player: circle center lies beyond the arc.
  const far = { x: 0, z: -0.9 };
  const wrong = sweep(far, 0.45, 150, 210, 0.001, 8);
  assert.deepEqual(reason(arcFromSweep(wrong.points, TABLE_Y, HEAD)), 'wrong-side');
});

test('gaze and default arcs use the default radius', () => {
  const g = arcFromGaze(HEAD, TABLE_Y, 35, -30);
  assert.equal(g.source, 'gaze');
  assert.equal(g.radius, DEFAULT_REACH_RADIUS);
  assert.equal(g.startDeg, -30);
  assert.equal(g.endDeg, 35);
  const d = defaultArc(HEAD, TABLE_Y);
  assert.equal(d.source, 'default');
  assert.ok(d.startDeg < 0 && d.endDeg > 0);
});

function reason(res: ReturnType<typeof arcFromSweep>): string {
  return res.ok ? 'ok' : res.reason;
}
