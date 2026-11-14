import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DAILY_INDEX,
  flowReducer,
  initialFlow,
  isPlaying,
  MAIN_LEVEL_COUNT,
  resumeIndex,
  type FlowEvent,
  type FlowState,
} from '../../src/game/flow.ts';
import { puzzle } from '../../src/puzzle/engine.ts';
import { emptyRecord, recordSolve } from '../../src/puzzle/save.ts';

function run(s: FlowState, ...events: FlowEvent[]): FlowState {
  return events.reduce(flowReducer, s);
}

test('flow: boot, calibrate, reach set opens L01 (the tutorial)', () => {
  let s = initialFlow(0);
  assert.equal(s.phase, 'boot');
  assert.equal(s.placed, false);
  s = run(s, 'calibrate');
  assert.equal(s.phase, 'calibrate');
  s = run(s, 'reach-set');
  assert.deepEqual(s, { phase: 'play', levelIndex: 0, solved: false, placed: true });
  assert.equal(puzzle.levels()[s.levelIndex].kind, 'tutorial');
  assert.equal(isPlaying(s), true);
});

test('flow: solved goes to level-done, next opens the next level', () => {
  let s = run(initialFlow(0), 'calibrate', 'reach-set', 'solved');
  assert.equal(s.phase, 'level-done');
  assert.equal(s.solved, true);
  assert.equal(isPlaying(s), false);
  s = run(s, 'next');
  assert.deepEqual(s, { phase: 'play', levelIndex: 1, solved: false, placed: true });
});

test('flow: next does nothing before the level is solved', () => {
  const s = run(initialFlow(0), 'calibrate', 'reach-set');
  assert.deepEqual(run(s, 'next'), s);
});

test('flow: after L12 comes the daily board, daily solved is finished', () => {
  let s = run(initialFlow(0), 'calibrate', 'reach-set');
  for (let i = 0; i < MAIN_LEVEL_COUNT; i++) {
    assert.equal(s.levelIndex, i);
    assert.equal(s.phase, 'play');
    s = run(s, 'solved');
    assert.equal(s.phase, 'level-done');
    s = run(s, 'next');
  }
  assert.equal(s.levelIndex, DAILY_INDEX);
  assert.equal(s.phase, 'daily');
  assert.equal(isPlaying(s), true);
  s = run(s, 'solved');
  assert.equal(s.phase, 'finished');
  assert.deepEqual(run(s, 'next'), s);
  // Restart plays today's board again.
  assert.equal(run(s, 'restart').phase, 'daily');
});

test('flow: recalibrating keeps the level and its solved flag', () => {
  let s = run(initialFlow(0), 'calibrate', 'reach-set', 'solved', 'next');
  s = run(s, 'calibrate');
  assert.equal(s.phase, 'calibrate');
  assert.equal(s.levelIndex, 1);
  // Turns are not taken while calibrating.
  assert.deepEqual(run(s, 'solved'), s);
  s = run(s, 'reach-set');
  assert.equal(s.phase, 'play');
  s = run(s, 'solved', 'calibrate', 'reach-set');
  assert.equal(s.phase, 'level-done');
  assert.equal(s.levelIndex, 1);
});

test('flow: restart and start over', () => {
  let s = run(initialFlow(4), 'calibrate', 'reach-set', 'solved');
  s = run(s, 'restart');
  assert.deepEqual(s, { phase: 'play', levelIndex: 4, solved: false, placed: true });
  s = run(s, 'reset');
  assert.deepEqual(s, { phase: 'play', levelIndex: 0, solved: false, placed: true });
  // Before any board is placed, start over only moves the start level.
  const boot = run(initialFlow(7), 'reset');
  assert.deepEqual(boot, { phase: 'boot', levelIndex: 0, solved: false, placed: false });
  assert.deepEqual(run(initialFlow(7), 'restart'), initialFlow(7));
});

test('resume: saved currentLevel 5 starts at L06', () => {
  const s = run(initialFlow(5), 'calibrate', 'reach-set');
  assert.equal(s.levelIndex, 5);
  assert.equal(puzzle.levels()[s.levelIndex].id, 'L06');
  assert.equal(s.phase, 'play');
});

test('resume: a record after five solves starts at L06, a finished run at the daily board', () => {
  const levels = puzzle.levels();
  let record = emptyRecord();
  for (let i = 0; i < 5; i++) {
    record = recordSolve(record, levels[i], levels[i].minRotations);
  }
  assert.equal(record.currentLevel, 5);
  assert.equal(levels[resumeIndex(record.currentLevel)].id, 'L06');
  for (let i = 5; i < MAIN_LEVEL_COUNT; i++) {
    record = recordSolve(record, levels[i], levels[i].minRotations);
  }
  assert.equal(record.currentLevel, MAIN_LEVEL_COUNT);
  assert.equal(resumeIndex(record.currentLevel), DAILY_INDEX);
  assert.equal(run(initialFlow(record.currentLevel), 'calibrate', 'reach-set').phase, 'daily');
});

test('resume: bad saved values start at L01', () => {
  for (const bad of [-1, 2.5, Number.NaN]) {
    assert.equal(resumeIndex(bad), 0);
  }
});
