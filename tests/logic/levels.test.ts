import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle } from '../../src/puzzle/engine.ts';
import type { Board, Level } from '../../src/puzzle/types.ts';

const levels: Level[] = puzzle.levels();

function solvedBySolution(board: Board): boolean {
  const after = puzzle.solution(board).reduce((b, s) => puzzle.rotate(b, s.r, s.c, s.turns), board);
  return puzzle.trace(after).solved;
}

test('12 levels in order, L01 is the tutorial', () => {
  assert.equal(levels.length, 12);
  levels.forEach((level, i) => {
    assert.equal(level.id, `L${String(i + 1).padStart(2, '0')}`);
    assert.equal(level.index, i);
    assert.equal(level.kind, i === 0 ? 'tutorial' : 'level');
    assert.equal(level.seed, undefined);
  });
});

test('L01 tutorial is solved by one turn', () => {
  const [tutorial] = levels;
  assert.equal(tutorial.minRotations, 1);
  const steps = puzzle.solution(tutorial.board);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].turns, 1);
  assert.equal(solvedBySolution(tutorial.board), true);
});

test('board sizes fit the arc: 3 to 4 rows, 3 to 6 columns, one source, one target', () => {
  for (const { id, board } of levels) {
    assert.ok(board.rows >= 3 && board.rows <= 4, id);
    assert.ok(board.cols >= 3 && board.cols <= 6, id);
    assert.equal(board.tiles.length, board.rows * board.cols, id);
    assert.equal(board.tiles.filter((t) => t.kind === 'source').length, 1, id);
    assert.equal(board.tiles.filter((t) => t.kind === 'target').length, 1, id);
    board.tiles.forEach((t, i) => {
      assert.equal(t.r, Math.floor(i / board.cols), id);
      assert.equal(t.c, i % board.cols, id);
      const turnable = t.kind === 'straight' || t.kind === 'corner' || t.kind === 'tee' || t.kind === 'cross';
      assert.equal(t.rotatable, turnable, `${id} ${t.kind}`);
    });
  }
});

test('no level starts solved, and its own solution solves it in minRotations turns', () => {
  for (const { id, board, minRotations } of levels) {
    assert.equal(puzzle.trace(board).solved, false, id);
    assert.ok(minRotations >= 1, id);
    assert.equal(puzzle.minRotations(board), minRotations, id);
    const turns = puzzle.solution(board).reduce((sum, s) => sum + s.turns, 0);
    assert.equal(turns, minRotations, id);
    assert.equal(solvedBySolution(board), true, id);
  }
});

test('levels get harder: turns and cell count never drop, L12 needs more than L02', () => {
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    assert.ok(b.minRotations >= a.minRotations, `${a.id} -> ${b.id}`);
    assert.ok(b.board.rows * b.board.cols >= a.board.rows * a.board.cols, `${a.id} -> ${b.id}`);
  }
  assert.ok(levels[11].minRotations > levels[1].minRotations);
});

test('levels are the same every call and callers get their own copy', () => {
  const again = puzzle.levels();
  assert.deepEqual(again, levels);
  again[0].board.tiles[5].rot = 3;
  again[0].minRotations = 99;
  assert.deepEqual(puzzle.levels(), levels);
});
