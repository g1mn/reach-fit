import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultArc, dirFromDeg, layoutBoard, TILE_SIZE } from '../../src/xr/arc.ts';
import {
  NEAR_PINCH_MAX_HEIGHT,
  pickByPinch,
  pinchingHand,
  pinchPoint,
  PINCH_PICK_RADIUS,
} from '../../src/xr/pinch.ts';

const TABLE_Y = 0.72;
const arc = defaultArc({ x: 0, z: 0.05 }, TABLE_Y, 0);
const lay = layoutBoard(arc, 3, 4);
const at = (r: number, c: number) => lay.cells.find((x) => x.r === r && x.c === c)!;

/** Point d meters from cell (r, c) toward the arc center (the player), h above the table. */
function towardPlayer(r: number, c: number, d: number, h: number) {
  const cell = at(r, c);
  const out = dirFromDeg(cell.deg);
  return { x: cell.x - out.x * d, y: TABLE_Y + h, z: cell.z - out.z * d };
}

test('pinch point is the thumb and index midpoint', () => {
  const p = pinchPoint({ x: 0, y: 1, z: 0 }, { x: 0.02, y: 1, z: 0 });
  assert.deepEqual([p.x, p.y, p.z], [0.01, 1, 0]);
  assert.ok(Math.abs(p.gap - 0.02) < 1e-12);
});

test('pinch over a tile picks that tile, up to its edge', () => {
  for (const [r, c] of [
    [0, 0],
    [1, 1],
    [2, 3],
  ]) {
    assert.deepEqual(pickByPinch(towardPlayer(r, c, 0, 0.03), lay.cells, TABLE_Y).cell, { r, c });
    // Inside the cell, just short of the edge toward the player.
    const edge = TILE_SIZE / 2 - 0.003;
    assert.deepEqual(pickByPinch(towardPlayer(r, c, edge, 0.03), lay.cells, TABLE_Y).cell, { r, c });
  }
  // Past the edge it is the next row (the one nearer the player).
  assert.deepEqual(
    pickByPinch(towardPlayer(1, 1, TILE_SIZE / 2 + 0.003, 0.03), lay.cells, TABLE_Y).cell,
    { r: 2, c: 1 },
  );
});

test('pinch too high, too far or beside the board picks nothing', () => {
  const high = pickByPinch(towardPlayer(1, 1, 0, NEAR_PINCH_MAX_HEIGHT + 0.01), lay.cells, TABLE_Y);
  assert.equal(high.near, false);
  assert.equal(high.cell, null);
  const far = pickByPinch({ x: 2, y: TABLE_Y, z: -2 }, lay.cells, TABLE_Y);
  assert.equal(far.near, false);
  // Just outside the near row: on the board's rim, so near, but no tile.
  const rim = pickByPinch(towardPlayer(2, 1, PINCH_PICK_RADIUS + 0.01, 0.02), lay.cells, TABLE_Y);
  assert.equal(rim.near, true);
  assert.equal(rim.cell, null);
});

test('pinchingHand picks the smallest gap', () => {
  assert.equal(pinchingHand([]), null);
  const hands = [
    { handedness: 'left', gap: 0.06 },
    { handedness: 'right', gap: 0.004 },
  ];
  assert.equal(pinchingHand(hands)?.handedness, 'right');
});
