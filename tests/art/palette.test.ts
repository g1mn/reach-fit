import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTRAST_PAIRS,
  MIN_CONTRAST,
  PALETTE,
  PULSE_MIN_GAIN,
  PULSE_PERIOD_MS,
  contrastRatio,
  pairRatio,
  pulseGain,
  shadeHex,
} from '../../src/theme/palette.ts';

test('contrastRatio: white on black is 21, a color on itself is 1', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrastRatio('#E6EAF2', '#e6eaf2'), 1);
  assert.equal(contrastRatio('#fff', '#ffffff'), 1);
});

test('contrastRatio rejects text that is not a hex color', () => {
  assert.throws(() => contrastRatio('white', '#000000'));
});

test('every contrast pair reaches 7.0 (AAA)', () => {
  assert.ok(CONTRAST_PAIRS.length >= 8);
  for (const pair of CONTRAST_PAIRS) {
    const ratio = pairRatio(pair);
    assert.ok(ratio >= MIN_CONTRAST, `${pair.fg}/${pair.bg} is ${ratio.toFixed(2)}`);
  }
});

test('the pairs named in the brief are all checked', () => {
  const has = (fg: string, bg: string) =>
    CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg === bg);
  for (const [fg, bg] of [
    ['tileFace', 'board'],
    ['pathIdle', 'tileFace'],
    ['block', 'board'],
    ['panelText', 'panelBg'],
    ['gazeRing', 'tileFace'],
  ]) {
    assert.ok(has(fg, bg), `${fg}/${bg} missing`);
  }
  // Every palette color takes part in at least one pair.
  for (const key of Object.keys(PALETTE)) {
    assert.ok(
      CONTRAST_PAIRS.some((p) => p.fg === key || p.bg === key),
      `${key} not checked`,
    );
  }
});

test('shadeHex: gain 1 keeps the color, lower gain darkens it', () => {
  assert.equal(shadeHex('#E6EAF2', 1).toLowerCase(), '#e6eaf2');
  assert.ok(contrastRatio(shadeHex('#E6EAF2', 0.5), '#000000') < contrastRatio('#E6EAF2', '#000000'));
});

test('pulseGain stays between PULSE_MIN_GAIN and 1 and starts at 1', () => {
  assert.ok(Math.abs(pulseGain(0) - 1) < 1e-12);
  for (let t = 0; t <= PULSE_PERIOD_MS * 2; t += 37) {
    const g = pulseGain(t);
    assert.ok(g >= PULSE_MIN_GAIN - 1e-12 && g <= 1 + 1e-12, `t=${t} g=${g}`);
  }
});
