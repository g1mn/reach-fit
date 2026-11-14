import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeGrainData } from '../../src/theme/grain.ts';
import { BOARD_GRAIN_MIN_GAIN, GRAIN_MIN_GAIN } from '../../src/theme/palette.ts';

function grayRange(data: Uint8Array): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i], data[i + 1]);
    assert.equal(data[i], data[i + 2]);
    assert.equal(data[i + 3], 255);
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  return { min, max };
}

test('face grain never goes below GRAIN_MIN_GAIN, so the contrast check holds', () => {
  const data = makeGrainData({ size: 128, minGain: GRAIN_MIN_GAIN, seed: 17, cells: 6, bevel: true });
  assert.equal(data.length, 128 * 128 * 4);
  const { min, max } = grayRange(data);
  assert.ok(min / 255 >= GRAIN_MIN_GAIN, `min ${min}`);
  assert.ok(max <= 255 && max > min, 'grain has some variation');
});

test('base grain stays between BOARD_GRAIN_MIN_GAIN and 1 (only darkens)', () => {
  const data = makeGrainData({ size: 128, minGain: BOARD_GRAIN_MIN_GAIN, seed: 29, cells: 4 });
  const { min } = grayRange(data);
  assert.ok(min / 255 >= BOARD_GRAIN_MIN_GAIN, `min ${min}`);
});

test('same seed gives the same bytes, another seed does not', () => {
  const a = makeGrainData({ size: 32, minGain: 0.8, seed: 5 });
  const b = makeGrainData({ size: 32, minGain: 0.8, seed: 5 });
  const c = makeGrainData({ size: 32, minGain: 0.8, seed: 6 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
