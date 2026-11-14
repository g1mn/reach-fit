import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle } from '../../src/puzzle/engine.ts';
import { boardHash, fnv1a, isDate, localDate, mulberry32 } from '../../src/puzzle/daily.ts';

function solvedBySolution(date: string): boolean {
  const { board } = puzzle.daily(date);
  const after = puzzle.solution(board).reduce((b, s) => puzzle.rotate(b, s.r, s.c, s.turns), board);
  return puzzle.trace(after).solved;
}

test('same date gives the same board, with daily metadata', () => {
  const a = puzzle.daily('2026-11-18');
  const b = puzzle.daily('2026-11-18');
  assert.deepEqual(a, b);
  assert.equal(a.id, 'daily-2026-11-18');
  assert.equal(a.index, -1);
  assert.equal(a.kind, 'daily');
  assert.equal(a.seed, '2026-11-18');
  assert.equal(a.board.rows, 4);
  assert.equal(a.board.cols, 5);
});

test('judging week boards 2026-11-18, 19, 20 all solve and all differ', () => {
  const dates = ['2026-11-18', '2026-11-19', '2026-11-20'];
  const hashes = dates.map((d) => boardHash(puzzle.daily(d).board));
  assert.equal(new Set(hashes).size, 3);
  for (const d of dates) {
    const level = puzzle.daily(d);
    assert.equal(puzzle.trace(level.board).solved, false, d);
    assert.ok(level.minRotations >= 1, d);
    assert.equal(solvedBySolution(d), true, d);
  }
});

test('90 days in a row: every board solvable, unsolved at start, all different', () => {
  const start = Date.UTC(2026, 10, 1);
  const seen = new Set<string>();
  for (let i = 0; i < 90; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const level = puzzle.daily(date);
    assert.equal(puzzle.minRotations(level.board), level.minRotations, date);
    assert.ok(level.minRotations >= 1, date);
    assert.equal(solvedBySolution(date), true, date);
    seen.add(boardHash(level.board));
  }
  assert.equal(seen.size, 90);
});

test('daily rejects anything but a real YYYY-MM-DD date', () => {
  for (const bad of ['', '2026-1-5', '2026-02-30', '2026-13-01', '18-11-2026', '2026-11-18T00:00']) {
    assert.equal(isDate(bad), false, bad);
    assert.throws(() => puzzle.daily(bad), RangeError, bad);
  }
  assert.equal(isDate('2028-02-29'), true);
});

test('seed helpers: FNV-1a test vectors, repeatable generator, local date format', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.equal(localDate(new Date(2026, 10, 9, 23, 59)), '2026-11-09');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
