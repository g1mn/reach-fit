import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOUND_MAX_ONSET_MS, SOUND_MIN_RMS, SOUND_REFRACTORY_MS, SoundGate } from '../../src/xr/voice.ts';
import { rng } from './helpers.ts';

const STEP = 1000 / 60;

/** Room hiss around `level`, `ms` long, from t0. Returns the number of triggers. */
function quiet(gate: SoundGate, t0: number, ms: number, level: number, seed = 7): number {
  const r = rng(seed);
  let n = 0;
  for (let t = t0; t < t0 + ms; t += STEP) {
    n += gate.update(level * (0.7 + 0.6 * r()), t) ? 1 : 0;
  }
  return n;
}

test('a quiet room never triggers, even with hiss', () => {
  const gate = new SoundGate();
  assert.equal(quiet(gate, 0, 20000, 0.012), 0);
});

test('a short word over a quiet room triggers once', () => {
  const gate = new SoundGate();
  quiet(gate, 0, 2000, 0.01);
  let fired = 0;
  for (let t = 2000; t < 2400; t += STEP) {
    fired += gate.update(0.2, t) ? 1 : 0;
  }
  assert.equal(fired, 1);
  assert.equal(quiet(gate, 2400, 1000, 0.01), 0);
});

test('two words closer than the dead time count once, farther apart count twice', () => {
  const gate = new SoundGate();
  quiet(gate, 0, 2000, 0.01);
  const word = (t0: number): number => {
    let n = 0;
    for (let t = t0; t < t0 + 150; t += STEP) {
      n += gate.update(0.25, t) ? 1 : 0;
    }
    return n;
  };
  let total = word(2000);
  quiet(gate, 2150, 200, 0.01);
  total += word(2350);
  assert.equal(total, 1);
  quiet(gate, 2500, SOUND_REFRACTORY_MS + 300, 0.01);
  total += word(2500 + SOUND_REFRACTORY_MS + 300);
  assert.equal(total, 2);
});

test('steady loud background (a fan, music) does not keep triggering and becomes the new floor', () => {
  const gate = new SoundGate();
  quiet(gate, 0, 2000, 0.01);
  let fired = 0;
  for (let t = 2000; t < 30000; t += STEP) {
    fired += gate.update(0.15, t) ? 1 : 0;
  }
  assert.ok(fired <= 1, `fired ${fired}`);
  assert.ok(gate.floor > 0.05, `floor ${gate.floor}`);
  // A word 3x louder than the new background still gets through.
  let word = 0;
  for (let t = 31000; t < 31200; t += STEP) {
    word += gate.update(0.6, t) ? 1 : 0;
  }
  assert.equal(word, 1);
});

test('a sound below the absolute minimum never triggers', () => {
  const gate = new SoundGate();
  quiet(gate, 0, 2000, 0.002);
  let fired = 0;
  for (let t = 2000; t < 2300; t += STEP) {
    fired += gate.update(SOUND_MIN_RMS * 0.9, t) ? 1 : 0;
  }
  assert.equal(fired, 0);
  assert.ok(SOUND_MAX_ONSET_MS > 0);
});
