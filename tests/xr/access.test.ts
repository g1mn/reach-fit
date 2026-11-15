/**
 * Access settings added on 11-15: contrast modes, look time, mic sensitivity,
 * the table height from the hand sweep, and the panel's second row.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CONTRAST_MODES,
  CONTRAST_PAIRS,
  MIN_CONTRAST,
  PALETTE,
  PALETTES,
  PULSE_BY_MODE,
  isContrastMode,
  lowestPair,
  pairRatio,
} from '../../src/theme/palette.ts';
import {
  ACCESS_KEY,
  DEFAULT_ACCESS,
  LOOK_TIMES_MS,
  MIC_LEVELS,
  loadAccess,
  lookSeconds,
  nextContrast,
  nextLookMs,
  nextMic,
  parseAccess,
  repeatMsFor,
  saveAccess,
} from '../../src/xr/access.ts';
import { GAZE_HOLD_MS, HAND_WAIT_MS, ReachCalibrator, type CalibrateInput } from '../../src/xr/calibrate.ts';
import { DWELL_MS, DWELL_REPEAT_MS, DwellTimer } from '../../src/xr/dwell.ts';
import { chooseTable, FINGERTIP_LIFT, heightFromSweep, SWEEP_MIN_SAMPLES } from '../../src/xr/table.ts';
import { SOUND_LEVELS, SoundGate } from '../../src/xr/voice.ts';
import { rng } from './helpers.ts';

// Contrast modes ---------------------------------------------------------------

test('every pair reaches 7.0 (AAA) in every contrast mode', () => {
  assert.deepEqual([...CONTRAST_MODES], ['standard', 'max', 'dim']);
  for (const mode of CONTRAST_MODES) {
    for (const pair of CONTRAST_PAIRS) {
      const ratio = pairRatio(pair, mode);
      assert.ok(ratio >= MIN_CONTRAST, `${mode} ${pair.fg}/${pair.bg} is ${ratio.toFixed(2)}`);
    }
  }
});

test('max mode is the strongest: its lowest pair beats the lowest pair of the other modes', () => {
  const max = lowestPair('max').ratio;
  assert.ok(max >= 13, `max lowest ${max.toFixed(2)}`);
  assert.ok(max > lowestPair('standard').ratio);
  assert.ok(max > lowestPair('dim').ratio);
});

test('standard mode keeps the look and the 8.12:1 lowest pair that the submission quotes', () => {
  assert.equal(PALETTES.standard, PALETTE);
  assert.equal(lowestPair('standard').ratio.toFixed(2), '8.12');
});

test('dim mode is darker than standard on the bright surfaces, max and dim hold still', () => {
  const lum = (hex: string) => parseInt(hex.slice(1), 16);
  for (const key of ['tileFace', 'pathLit', 'panelText'] as const) {
    assert.ok(lum(PALETTES.dim[key]) < lum(PALETTES.standard[key]), key);
  }
  assert.equal(PULSE_BY_MODE.standard, true);
  assert.equal(PULSE_BY_MODE.max, false);
  assert.equal(PULSE_BY_MODE.dim, false);
});

test('every mode defines every palette color, and every color is in a checked pair', () => {
  const keys = Object.keys(PALETTE).sort();
  for (const mode of CONTRAST_MODES) {
    assert.deepEqual(Object.keys(PALETTES[mode]).sort(), keys, mode);
  }
  for (const key of keys) {
    assert.ok(CONTRAST_PAIRS.some((p) => p.fg === key || p.bg === key), `${key} not checked`);
  }
  assert.ok(isContrastMode('max'));
  assert.ok(!isContrastMode('neon'));
});

// Settings model ---------------------------------------------------------------

test('settings cycle through every choice and come back', () => {
  let c = DEFAULT_ACCESS.contrast;
  const seenC = new Set<string>();
  for (let i = 0; i < CONTRAST_MODES.length; i++) {
    seenC.add(c);
    c = nextContrast(c);
  }
  assert.equal(c, DEFAULT_ACCESS.contrast);
  assert.equal(seenC.size, 3);

  let ms = DEFAULT_ACCESS.lookMs;
  const seenMs: number[] = [];
  for (let i = 0; i < LOOK_TIMES_MS.length; i++) {
    seenMs.push(ms);
    ms = nextLookMs(ms);
  }
  assert.equal(ms, 800);
  assert.deepEqual(seenMs, [800, 1200, 2000, 500]);

  let m = DEFAULT_ACCESS.mic;
  for (let i = 0; i < MIC_LEVELS.length; i++) {
    m = nextMic(m);
  }
  assert.equal(m, 'medium');
});

test('the default look time keeps 0.8 s and 1.2 s repeats; other times scale', () => {
  assert.equal(DEFAULT_ACCESS.lookMs, DWELL_MS);
  assert.equal(repeatMsFor(DWELL_MS), DWELL_REPEAT_MS);
  assert.equal(repeatMsFor(2000), 3000);
  assert.equal(lookSeconds(800), '0.8');
  assert.equal(lookSeconds(2000), '2.0');
});

test('saved settings parse back; broken or unknown values fall back to the defaults', () => {
  assert.deepEqual(parseAccess(JSON.stringify({ contrast: 'max', lookMs: 2000, mic: 'high' })), {
    contrast: 'max',
    lookMs: 2000,
    mic: 'high',
  });
  assert.deepEqual(parseAccess(null), DEFAULT_ACCESS);
  assert.deepEqual(parseAccess('{not json'), DEFAULT_ACCESS);
  assert.deepEqual(parseAccess(JSON.stringify({ contrast: 'neon', lookMs: 1, mic: 'loud' })), DEFAULT_ACCESS);
  assert.deepEqual(parseAccess(JSON.stringify({ lookMs: 1200 })), { ...DEFAULT_ACCESS, lookMs: 1200 });
});

test('settings survive a reload through localStorage, and a browser without storage still works', () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  const before = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    assert.equal(saveAccess({ contrast: 'dim', lookMs: 1200, mic: 'low' }), true);
    assert.ok(store.has(ACCESS_KEY));
    assert.deepEqual(loadAccess(), { contrast: 'dim', lookMs: 1200, mic: 'low' });
    g.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(saveAccess(DEFAULT_ACCESS), false);
    assert.deepEqual(loadAccess(), DEFAULT_ACCESS);
  } finally {
    g.localStorage = before;
  }
});

// Look time ---------------------------------------------------------------------

test('look time 2.0 s: a tile does not turn at 0.8 s, turns at 2.0 s, then every 3.0 s', () => {
  const d = new DwellTimer(2000, repeatMsFor(2000));
  const fires: number[] = [];
  for (let t = 0; t <= 2000 + 2 * 3000 + 1; t += 10) {
    if (d.update('Tile_0_0', t, () => true).fire) fires.push(t);
  }
  assert.deepEqual(fires, [2000, 5000, 8000]);
});

test('look time 0.5 s fires sooner; a change applies from the next look', () => {
  const d = new DwellTimer();
  let first = -1;
  for (let t = 0; t <= 1000 && first < 0; t += 10) {
    if (d.update('Btn_Next', t, () => false).fire) first = t;
  }
  assert.equal(first, DWELL_MS);
  d.setTiming(500, repeatMsFor(500));
  assert.equal(d.lookMs, 500);
  d.update(null, 2000, () => false);
  let second = -1;
  for (let t = 3000; t <= 4000 && second < 0; t += 10) {
    if (d.update('Btn_Restart', t, () => false).fire) second = t - 3000;
  }
  assert.equal(second, 500);
});

test('reach by gaze uses the same look time for each edge hold', () => {
  const FRAME = 1000 / 72;
  const cal = new ReachCalibrator();
  cal.holdMs = 2000;
  let yaw = 0;
  const feed = (from: number, to: number) => {
    for (let t = from; t < to; t += FRAME) {
      const input: CalibrateInput = { t, tableY: 0.72, hand: null, head: { x: 0, z: 0, yawDeg: yaw } };
      cal.update(input);
    }
  };
  feed(0, HAND_WAIT_MS + 3 * FRAME);
  assert.equal(cal.phase, 'gaze-left');
  const t1 = HAND_WAIT_MS + 3 * FRAME;
  yaw = 30;
  feed(t1, t1 + GAZE_HOLD_MS + 100);
  assert.equal(cal.phase, 'gaze-left', 'a 0.8 s hold is not enough at 2.0 s');
  feed(t1 + GAZE_HOLD_MS + 100, t1 + 2100);
  assert.equal(cal.phase, 'gaze-right');
});

// Mic sensitivity ---------------------------------------------------------------

const STEP = 1000 / 60;

/** Room hiss around `level` for `ms`, then a short sound of `peak` for 300 ms. Returns triggers during the sound. */
function soundOver(gate: SoundGate, level: number, peak: number, seed = 3): number {
  const r = rng(seed);
  for (let t = 0; t < 3000; t += STEP) {
    gate.update(level * (0.7 + 0.6 * r()), t);
  }
  let fired = 0;
  for (let t = 3000; t < 3300; t += STEP) {
    fired += gate.update(peak, t) ? 1 : 0;
  }
  return fired;
}

test('mic high hears a soft voice in a quiet room that medium ignores', () => {
  assert.equal(soundOver(new SoundGate('high'), 0.01, 0.03), 1);
  assert.equal(soundOver(new SoundGate('medium'), 0.01, 0.03), 0);
});

test('mic low ignores a cough in a loud room that medium takes', () => {
  assert.equal(soundOver(new SoundGate('medium'), 0.025, 0.075), 1);
  assert.equal(soundOver(new SoundGate('low'), 0.025, 0.075), 0);
  assert.equal(soundOver(new SoundGate('low'), 0.025, 0.2), 1);
});

test('no level triggers on room hiss alone', () => {
  for (const level of MIC_LEVELS) {
    const gate = new SoundGate(level);
    const r = rng(11);
    let n = 0;
    for (let t = 0; t < 20000; t += STEP) {
      n += gate.update(0.012 * (0.7 + 0.6 * r()), t) ? 1 : 0;
    }
    assert.equal(n, 0, level);
  }
});

test('the mic meter reads 1 exactly when a sound would count, and the levels are ordered', () => {
  const gate = new SoundGate('medium');
  assert.ok(gate.meter(0) === 0);
  assert.ok(gate.meter(gate.threshold * 0.5) < 1);
  assert.equal(gate.meter(gate.threshold), 1);
  assert.ok(SOUND_LEVELS.high.minRms < SOUND_LEVELS.medium.minRms);
  assert.ok(SOUND_LEVELS.medium.minRms < SOUND_LEVELS.low.minRms);
  gate.setLevel('low');
  assert.ok(gate.threshold >= SOUND_LEVELS.low.minRms);
});

// Table from the hand sweep ----------------------------------------------------------

test('no plane and no hit: the board sits at the height of the hand sweep', () => {
  // Fingertip slides on a 0.78 m desk with a lifted start and end.
  const ys = [0.83, 0.81, ...Array.from({ length: 30 }, (_, i) => 0.788 + (i % 3) * 0.001), 0.82, 0.86];
  const h = heightFromSweep(ys);
  assert.ok(h !== null && Math.abs(h - (0.788 - FINGERTIP_LIFT)) < 0.002, String(h));
  assert.deepEqual(chooseTable([], null, 0.72, h), { height: h, source: 'hand' });
});

test('a plane or a hit still wins over the sweep height; an odd sweep height is not used', () => {
  const plane = { height: 0.74, horizontal: true, distance: 0.5 };
  assert.equal(chooseTable([plane], null, 0.72, 0.8).source, 'plane');
  assert.equal(chooseTable([], { height: 0.7 }, 0.72, 0.8).source, 'hit-test');
  // A sweep in the air (1.1 m) is not a table.
  assert.deepEqual(chooseTable([], null, 0.72, 1.1), { height: 0.72, source: 'virtual' });
  assert.equal(heightFromSweep([0.8, 0.8]), null, `fewer than ${SWEEP_MIN_SAMPLES} samples`);
  assert.equal(heightFromSweep([]), null);
});

test('a look already resting where the panel appears does not press; leaving and coming back does', () => {
  const d = new DwellTimer();
  d.update('Btn_Restart', 0, () => false);
  d.holdNext();
  let fired = 0;
  for (let t = 10; t <= 3000; t += 10) fired += d.update('Btn_Reach', t, () => false).fire ? 1 : 0;
  assert.equal(fired, 0);
  d.update(null, 3200, () => false);
  let again = -1;
  for (let t = 3400; t <= 4600 && again < 0; t += 10) if (d.update('Btn_Reach', t, () => false).fire) again = t - 3400;
  assert.equal(again, DWELL_MS);
  // With nothing under the look, holdNext changes nothing for the next target.
  const e = new DwellTimer();
  e.holdNext();
  e.update(null, 0, () => true);
  let first = -1;
  for (let t = 10; t <= 2000 && first < 0; t += 10) if (e.update('Tile_0_0', t, () => true).fire) first = t - 10;
  assert.equal(first, DWELL_MS);
});
