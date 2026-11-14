import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minRotations, openSides, puzzle, rotate, solution, trace } from '../../src/puzzle/engine.ts';
import type { Board, Rotation, Tile, TileKind } from '../../src/puzzle/types.ts';

const CODE: Record<string, TileKind> = {
  S: 'source',
  T: 'target',
  I: 'straight',
  L: 'corner',
  Y: 'tee',
  X: 'cross',
  '#': 'block',
  '.': 'empty',
};
const TURNABLE = new Set<TileKind>(['straight', 'corner', 'tee', 'cross']);

/** Rows of tokens like 'S1 I0 T0': kind letter then rotation digit. */
function board(rows: string[]): Board {
  const tiles: Tile[] = [];
  const grid = rows.map((row) => row.trim().split(/\s+/));
  grid.forEach((cells, r) =>
    cells.forEach((tok, c) => {
      const kind = CODE[tok[0]];
      tiles.push({ r, c, kind, rot: Number(tok[1]) as Rotation, rotatable: TURNABLE.has(kind) });
    }),
  );
  return { rows: grid.length, cols: grid[0].length, tiles };
}

function applySteps(b: Board, steps: { r: number; c: number; turns: number }[]): Board {
  return steps.reduce((x, s) => rotate(x, s.r, s.c, s.turns), b);
}

/** Fewest turns by trying every rotation of every turnable tile. */
function bruteForce(b: Board): number {
  const idx = b.tiles.flatMap((t, i) => (t.rotatable ? [i] : []));
  let best = -1;
  for (let m = 0; m < 4 ** idx.length; m++) {
    let x = m;
    let spent = 0;
    const tiles = b.tiles.map((t) => ({ ...t }));
    for (const i of idx) {
      const k = x % 4;
      x = Math.floor(x / 4);
      spent += k;
      tiles[i].rot = ((tiles[i].rot + k) % 4) as Rotation;
    }
    if ((best < 0 || spent < best) && trace({ ...b, tiles }).solved) best = spent;
  }
  return best;
}

test('one turn maps N to E, E to S, S to W, W to N', () => {
  assert.deepEqual(openSides('corner', 0), ['N', 'E']);
  assert.deepEqual(openSides('corner', 1), ['E', 'S']);
  assert.deepEqual(openSides('corner', 3), ['N', 'W']);
  assert.deepEqual(openSides('tee', 1), ['E', 'S', 'W']);
  assert.deepEqual(openSides('source', 2), ['S']);
});

test('rotate returns a new board and leaves the input alone', () => {
  const b = board(['S1 I0 T0']);
  const before = JSON.stringify(b);
  const after = rotate(b, 0, 1);
  assert.notEqual(after, b);
  assert.equal(JSON.stringify(b), before);
  assert.equal(after.tiles[1].rot, 1);
  assert.equal(rotate(rotate(after, 0, 1, 3), 0, 1).tiles[1].rot, 1);
  assert.equal(rotate(b, 0, 1, 2).tiles[1].rot, 2);
});

test('rotate on a tile that cannot turn, or off the board, gives back the same board', () => {
  const b = board(['S1 #0 .0', 'T0 I0 L0']);
  for (const [r, c] of [[0, 0], [0, 1], [0, 2], [1, 0], [-1, 0], [2, 0], [0, 3]]) {
    assert.equal(puzzle.rotate(b, r, c), b);
  }
  assert.equal(rotate(b, 1, 1, 4 as 1), b);
});

test('light crosses an edge only when both tiles are open on it', () => {
  assert.equal(trace(board(['S1 I1 T0'])).solved, true);
  const blocked = trace(board(['S1 I0 T0']));
  assert.equal(blocked.solved, false);
  assert.deepEqual(blocked.lit, [true, false, false]);
  assert.equal(blocked.targetsLit, 0);
  assert.equal(blocked.targetsTotal, 1);
});

test('light leaking off the path does not matter, and no target is never solved', () => {
  const leaky = trace(board(['.0 I0 .0', 'S1 X0 T0', '.0 I0 .0']));
  assert.equal(leaky.solved, true);
  assert.deepEqual(leaky.lit, [false, true, false, true, true, true, false, true, false]);
  assert.equal(trace(board(['S1 I1 I1'])).solved, false);
});

test('fewest turns respects symmetry: straight has two shapes, cross one', () => {
  assert.equal(minRotations(board(['S1 I3 T0'])), 0);
  assert.equal(minRotations(board(['S1 I0 T0'])), 1);
  assert.equal(minRotations(board(['S1 I2 T0'])), 1);
  assert.equal(minRotations(board(['S1 X3 T0'])), 0);
  // Corner at rot 2 opens S and W: already the bend from the source down to the target.
  assert.equal(minRotations(board(['S1 L2 .0', '.0 T0 .0'])), 0);
  // Corner at rot 3 opens W and N; W and S needs rot 2, three turns away.
  assert.equal(minRotations(board(['S1 L3 .0', '.0 T0 .0'])), 3);
});

test('solved board needs 0 turns, impossible board gives -1 and no steps', () => {
  const solved = board(['S1 I1 T0']);
  assert.equal(minRotations(solved), 0);
  assert.deepEqual(solution(solved), []);
  const walled = board(['S1 I0 #0 T0']);
  assert.equal(minRotations(walled), -1);
  assert.deepEqual(solution(walled), []);
  // Source facing off the board.
  assert.equal(minRotations(board(['S3 I1 T0'])), -1);
});

test('a board needs exactly one target', () => {
  assert.throws(() => minRotations(board(['S1 I1 I1'])), /one target/);
  assert.throws(() => minRotations(board(['S1 T0 T0'])), /one target/);
});

test('fewest turns equals brute force on 300 random small boards', () => {
  let seed = 20261110;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const kinds: TileKind[] = ['straight', 'corner', 'tee', 'cross', 'block', 'empty'];
  let compared = 0;
  let impossible = 0;
  while (compared < 300) {
    const rows = 2 + Math.floor(rnd() * 2);
    const cols = 2 + Math.floor(rnd() * 3);
    const tiles: Tile[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        tiles.push({ r, c, kind, rot: Math.floor(rnd() * 4) as Rotation, rotatable: TURNABLE.has(kind) });
      }
    }
    const s = Math.floor(rnd() * tiles.length);
    const t = (s + 1 + Math.floor(rnd() * (tiles.length - 1))) % tiles.length;
    tiles[s] = { ...tiles[s], kind: 'source', rotatable: false };
    tiles[t] = { ...tiles[t], kind: 'target', rotatable: false };
    const b: Board = { rows, cols, tiles };
    if (tiles.filter((x) => x.rotatable).length > 8) continue;
    compared++;
    const expected = bruteForce(b);
    if (expected < 0) impossible++;
    assert.equal(minRotations(b), expected, JSON.stringify(b));
    const steps = solution(b);
    assert.equal(steps.reduce((sum, x) => sum + x.turns, 0), Math.max(expected, 0));
    if (expected >= 0) assert.equal(trace(applySteps(b, steps)).solved, true);
  }
  assert.ok(impossible > 0 && impossible < compared, 'sample mixes possible and impossible boards');
});

test('solution turns each cell once, 1 to 3 turns, from the source outward', () => {
  // Path S(1,0) -> (1,1) -> (1,2) -> (0,2) -> T(0,3).
  const b = board(['.0 .0 L0 T0', 'S1 I0 L1 .0']);
  const steps = solution(b);
  assert.deepEqual(steps, [
    { r: 1, c: 1, turns: 1 },
    { r: 1, c: 2, turns: 2 },
    { r: 0, c: 2, turns: 1 },
  ]);
  assert.equal(minRotations(b), 4);
  assert.equal(trace(applySteps(b, steps)).solved, true);
});
