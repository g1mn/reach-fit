import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chooseTable, VIRTUAL_TABLE_HEIGHT } from '../../src/xr/table.ts';
import { MisGrabTracker, selectMisGrab, shapeMask, UNDO_WINDOW_MS } from '../../src/xr/misgrab.ts';

test('chooseTable: plane first, then hit test, then virtual 0.72 m', () => {
  const plane = { height: 0.74, horizontal: true, distance: 0.4 };
  const hit = { height: 0.7 };
  assert.deepEqual(chooseTable([plane], hit), { height: 0.74, source: 'plane' });
  assert.deepEqual(chooseTable([], hit), { height: 0.7, source: 'hit-test' });
  assert.deepEqual(chooseTable([], null), { height: 0.72, source: 'virtual' });
  assert.equal(VIRTUAL_TABLE_HEIGHT, 0.72);
});

test('chooseTable ignores floors, walls and out-of-range hits', () => {
  const floor = { height: 0.0, horizontal: true, distance: 0.1 };
  const wall = { height: 0.75, horizontal: false, distance: 0.1 };
  const high = { height: 1.1, horizontal: true, distance: 0.1 };
  assert.deepEqual(chooseTable([floor, wall, high], { height: 0.02 }), {
    height: 0.72,
    source: 'virtual',
  });
  assert.deepEqual(chooseTable([floor, wall], { height: 0.81 }), {
    height: 0.81,
    source: 'hit-test',
  });
});

test('chooseTable picks the nearest usable plane', () => {
  const near = { height: 0.7, horizontal: true, distance: 0.3 };
  const far = { height: 0.8, horizontal: true, distance: 1.5, area: 3 };
  assert.equal(chooseTable([far, near], null).height, 0.7);
});

test('mis-grab rule 1: selecting a tile that cannot turn', () => {
  assert.equal(selectMisGrab({ rotatable: false }), 'not-rotatable');
  assert.equal(selectMisGrab({ rotatable: true }), null);
});

test('mis-grab rule 2: straight tile back to its shape within 2 s (symmetry)', () => {
  const m = new MisGrabTracker();
  const s0 = shapeMask('straight', 0);
  const s1 = shapeMask('straight', 1);
  assert.equal(shapeMask('straight', 2), s0, 'straight is symmetric after two turns');
  assert.equal(m.onTurn('Tile_0_0', s0, s1, 1000), null);
  assert.equal(m.onTurn('Tile_0_0', s1, s0, 1000 + 1200), 'undone-within-2s');
});

test('mis-grab rule 2: corner needs four turns, slow turns do not count', () => {
  const m = new MisGrabTracker();
  const sh = [0, 1, 2, 3].map((r) => shapeMask('corner', r));
  assert.equal(new Set(sh).size, 4);
  let t = 0;
  assert.equal(m.onTurn('k', sh[0], sh[1], (t += 0)), null);
  assert.equal(m.onTurn('k', sh[1], sh[2], (t += 400)), null);
  assert.equal(m.onTurn('k', sh[2], sh[3], (t += 400)), null);
  assert.equal(m.onTurn('k', sh[3], sh[0], (t += 400)), 'undone-within-2s');

  const slow = new MisGrabTracker();
  const s0 = shapeMask('straight', 0);
  const s1 = shapeMask('straight', 1);
  assert.equal(slow.onTurn('k', s0, s1, 0), null);
  assert.equal(slow.onTurn('k', s1, s0, UNDO_WINDOW_MS + 500), null);
});

test('mis-grab rule 2: a cross never counts, other tiles are separate', () => {
  const m = new MisGrabTracker();
  const c = shapeMask('cross', 0);
  assert.equal(m.onTurn('a', c, shapeMask('cross', 1), 0), null);
  assert.equal(m.onTurn('a', c, c, 300), null);
  const s0 = shapeMask('straight', 0);
  const s1 = shapeMask('straight', 1);
  assert.equal(m.onTurn('b', s0, s1, 0), null);
  assert.equal(m.onTurn('c', s1, s0, 100), null, 'different tile, no undo');
});
