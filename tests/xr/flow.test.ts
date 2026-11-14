import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dirFromDeg } from '../../src/xr/arc.ts';
import {
  GAZE_HOLD_MS,
  GAZE_MAX_MS,
  HAND_WAIT_MS,
  ReachCalibrator,
  type CalibrateEvent,
  type CalibrateInput,
} from '../../src/xr/calibrate.ts';
import { DWELL_MS, DWELL_REPEAT_MS, DwellTimer } from '../../src/xr/dwell.ts';
import { FRAME_RING_SIZE, MAX_EVENTS, PlayLogger } from '../../src/logger.ts';
import { puzzleStub } from '../../src/xr/puzzle-stub.ts';
import { rng } from './helpers.ts';

const TABLE_Y = 0.72;
const FRAME = 1000 / 72;

function run(
  cal: ReachCalibrator,
  from: number,
  to: number,
  input: (t: number) => Omit<CalibrateInput, 't' | 'tableY'>,
): CalibrateEvent[] {
  const out: CalibrateEvent[] = [];
  for (let t = from; t < to; t += FRAME) {
    out.push(...cal.update({ t, tableY: TABLE_Y, ...input(t) }));
  }
  return out;
}

test('calibration: a hand sweep sets a hand arc', () => {
  const cal = new ReachCalibrator();
  const center = { x: 0.17, z: 0.12 };
  const head = { x: 0, z: 0.05, yawDeg: 0 };
  // Sweep from 35 deg (left) to -55 deg over 2 s, then rest.
  const ev = run(cal, 0, 4000, (t) => {
    const k = Math.min(1, t / 2000);
    const d = dirFromDeg(35 - 90 * k);
    return { head, hand: { x: center.x + d.x * 0.45, y: TABLE_Y + 0.02, z: center.z + d.z * 0.45 } };
  });
  const done = ev.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.arc.source, 'hand');
  assert.ok(Math.abs(done.arc.radius - 0.45) < 0.01);
  assert.ok(ev.some((e) => e.type === 'sample' && e.source === 'hand'));
  assert.equal(cal.phase, 'done');
});

test('calibration: no hand for 10 s moves to gaze, two holds set a gaze arc', () => {
  const cal = new ReachCalibrator();
  let yaw = 0;
  const ev = run(cal, 0, HAND_WAIT_MS + 3 * FRAME, () => ({ hand: null, head: { x: 0, z: 0, yawDeg: yaw } }));
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 'gaze-left'));
  assert.equal(cal.phase, 'gaze-left');
  const t1 = HAND_WAIT_MS + 3 * FRAME;
  yaw = 30;
  run(cal, t1, t1 + GAZE_HOLD_MS + 100, () => ({ hand: null, head: { x: 0, z: 0, yawDeg: yaw } }));
  assert.equal(cal.phase, 'gaze-right');
  const t2 = t1 + GAZE_HOLD_MS + 100;
  yaw = -25;
  const ev2 = run(cal, t2, t2 + GAZE_HOLD_MS + 100, () => ({ hand: null, head: { x: 0, z: 0, yawDeg: yaw } }));
  const done = ev2.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.arc.source, 'gaze');
  assert.ok(Math.abs(done.arc.startDeg + 25) < 0.5 && Math.abs(done.arc.endDeg - 30) < 0.5);
});

test('calibration: a still hand in view for 10 s also moves to gaze', () => {
  const cal = new ReachCalibrator();
  const head = { x: 0, z: 0, yawDeg: 0 };
  const hand = { x: 0.1, y: TABLE_Y + 0.05, z: -0.3 };
  run(cal, 0, HAND_WAIT_MS - 100, () => ({ head, hand }));
  assert.equal(cal.phase, 'hand');
  const ev = run(cal, HAND_WAIT_MS - 100, HAND_WAIT_MS + 100, () => ({ head, hand }));
  assert.ok(ev.some((e) => e.type === 'phase' && e.phase === 'gaze-left'));
  assert.equal(cal.phase, 'gaze-left');
});

test('calibration: tracking jitter of a resting hand neither holds off gaze nor shows a retry', () => {
  const cal = new ReachCalibrator();
  const head = { x: 0, z: 0, yawDeg: 0 };
  const rand = rng(7);
  // Up to 1.2 cm of jitter on each axis around one point, more than SAMPLE_MIN_STEP.
  const ev = run(cal, 0, HAND_WAIT_MS + 1000, () => ({
    head,
    hand: {
      x: 0.1 + (rand() * 2 - 1) * 0.012,
      y: TABLE_Y + 0.05,
      z: -0.3 + (rand() * 2 - 1) * 0.012,
    },
  }));
  assert.equal(ev.filter((e) => e.type === 'rejected').length, 0);
  assert.equal(cal.phase, 'gaze-left');
});

test('calibration: a slow real sweep is not cut off at 10 s', () => {
  const cal = new ReachCalibrator();
  const center = { x: 0, z: 0.1 };
  const head = { x: 0, z: 0.05, yawDeg: 0 };
  // Hand rests 9 s, then sweeps 100 degrees over 5 s.
  const ev = run(cal, 0, 16000, (t) => {
    const k = Math.max(0, Math.min(1, (t - 9000) / 5000));
    const d = dirFromDeg(50 - 100 * k);
    return { head, hand: { x: center.x + d.x * 0.5, y: TABLE_Y + 0.02, z: center.z + d.z * 0.5 } };
  });
  assert.ok(!ev.some((e) => e.type === 'phase' && e.phase === 'gaze-left'));
  const done = ev.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.arc.source, 'hand');
});

test('calibration: gaze that never holds falls back to the default arc', () => {
  const cal = new ReachCalibrator();
  run(cal, 0, HAND_WAIT_MS + 50, () => ({ hand: null, head: { x: 0, z: 0, yawDeg: 0 } }));
  const ev = run(cal, HAND_WAIT_MS + 50, HAND_WAIT_MS + GAZE_MAX_MS + 200, () => ({
    hand: null,
    head: { x: 0, z: 0, yawDeg: 0 },
  }));
  const done = ev.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done');
  assert.equal(done.arc.source, 'default');
});

test('dwell: tile fires at 0.8 s then every 1.2 s, button once', () => {
  const d = new DwellTimer();
  const fires: number[] = [];
  for (let t = 0; t <= DWELL_MS + 2 * DWELL_REPEAT_MS + 1; t += 10) {
    if (d.update('Tile_0_0', t, () => true).fire) fires.push(t);
  }
  assert.deepEqual(fires, [DWELL_MS, DWELL_MS + DWELL_REPEAT_MS, DWELL_MS + 2 * DWELL_REPEAT_MS]);
  const b = new DwellTimer();
  let n = 0;
  for (let t = 0; t <= 5000; t += 10) {
    if (b.update('Btn_Next', t, () => false).fire) n++;
  }
  assert.equal(n, 1);
});

test('dwell: short dropouts keep the timer, looking away resets it', () => {
  const d = new DwellTimer();
  const yes = () => true;
  for (let t = 0; t <= 400; t += 10) d.update('Tile_0_1', t, yes);
  // 100 ms dropout, shorter than the grace time.
  for (let t = 410; t < 510; t += 10) d.update(null, t, yes);
  assert.ok(d.update('Tile_0_1', 510, yes).progress > 0.6);
  // 300 ms away resets.
  for (let t = 520; t < 820; t += 10) d.update(null, t, yes);
  assert.equal(d.update('Tile_0_1', 820, yes).progress, 0);
});

test('dwell: a hand turn on the looked-at tile holds gaze until the look leaves', () => {
  const d = new DwellTimer();
  const yes = () => true;
  for (let t = 0; t <= 300; t += 10) d.update('Tile_1_1', t, yes);
  // A pinch turns the same tile at 300 ms.
  d.holdIfOn('Tile_1_1');
  let fired = 0;
  for (let t = 310; t <= 300 + DWELL_MS + DWELL_REPEAT_MS; t += 10) {
    if (d.update('Tile_1_1', t, yes).fire) fired++;
  }
  assert.equal(fired, 0, 'no gaze turn while the look stays');
  // Holding another tile does not touch the one being looked at.
  d.update('Tile_0_0', 3000, yes);
  d.holdIfOn('Tile_1_1');
  let other = 0;
  for (let t = 3010; t <= 3000 + DWELL_MS + 10; t += 10) {
    if (d.update('Tile_0_0', t, yes).fire) other++;
  }
  assert.equal(other, 1);
  // Look away, come back: gaze works again.
  for (let t = 4000; t < 4400; t += 10) d.update(null, t, yes);
  let back = 0;
  for (let t = 4400; t <= 4400 + DWELL_MS + 10; t += 10) {
    if (d.update('Tile_1_1', t, yes).fire) back++;
  }
  assert.equal(back, 1);
});

test('dwell: a board change keeps a fired button disarmed, tiles start over', () => {
  const d = new DwellTimer();
  const isTile = (name: string) => name.startsWith('Tile_');
  const isButton = (name: string) => name.startsWith('Btn_');
  let fired = 0;
  for (let t = 0; t <= DWELL_MS + 10; t += 10) {
    if (d.update('Btn_Restart', t, isTile).fire) fired++;
  }
  assert.equal(fired, 1);
  // Restart rebuilds the board while the look stays on the button.
  d.resetUnless(isButton);
  let again = 0;
  for (let t = DWELL_MS + 20; t <= 4 * DWELL_MS; t += 10) {
    if (d.update('Btn_Restart', t, isTile).fire) again++;
  }
  assert.equal(again, 0, 'no second restart while the look stays');
  // A look on a tile is forgotten on a board change and starts a fresh dwell.
  const tile = new DwellTimer();
  for (let t = 0; t <= 500; t += 10) tile.update('Tile_0_0', t, isTile);
  tile.resetUnless(isButton);
  assert.equal(tile.update('Tile_0_0', 510, isTile).progress, 0);
});

test('logger: frame ring is capped, summaries per level, events capped', () => {
  let now = 0;
  const log = new PlayLogger(() => now);
  log.push({ type: 'level-start', levelId: 'L01' });
  for (let i = 0; i < FRAME_RING_SIZE + 100; i++) {
    now += 14;
    log.frame(i % 50 === 0 ? 40 : 14);
  }
  const frames = log.log().filter((e) => e.type === 'frame');
  assert.equal(frames.length, FRAME_RING_SIZE);
  const sum = log.frameSummaries().find((s) => s.segment === 'L01');
  assert.ok(sum);
  assert.equal(sum.frames, FRAME_RING_SIZE + 100);
  assert.equal(sum.maxMs, 40);
  assert.ok(sum.p50Ms >= 14 && sum.p50Ms < 15);
  assert.ok(sum.longFrames > 0);
  for (let i = 0; i < MAX_EVENTS + 10; i++) {
    log.push({ type: 'locale', locale: 'en' });
  }
  assert.equal(log.droppedCount(), 11);
  assert.equal(log.toFile().kind, 'reach-fit-play-log');
});

test('stub engine: boards are scrambled and the solution solves them', () => {
  for (const level of puzzleStub.levels()) {
    assert.equal(puzzleStub.trace(level.board).solved, false);
    let b = level.board;
    for (const s of puzzleStub.solution(b)) b = puzzleStub.rotate(b, s.r, s.c, s.turns);
    assert.equal(puzzleStub.trace(b).solved, true);
    assert.equal(puzzleStub.minRotations(level.board), level.minRotations);
  }
  assert.equal(puzzleStub.levels()[0].minRotations, 1);
});
