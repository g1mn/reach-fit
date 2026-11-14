import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAJOR, PENTATONIC, tilePitch, tileSemitone, tileWave } from '../../src/audio/pitch.ts';

function allPitches(rows: number, cols: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push(tilePitch(r, c, rows, cols));
    }
  }
  return out;
}

for (const [rows, cols] of [
  [3, 4],
  [4, 6],
  [3, 6],
  [5, 5],
  [4, 8],
  [2, 10],
  [3, 12],
]) {
  test(`tilePitch: every cell of a ${rows}x${cols} board has its own pitch, all audible`, () => {
    const hz = allPitches(rows, cols);
    assert.equal(new Set(hz.map((v) => v.toFixed(6))).size, rows * cols);
    for (const v of hz) {
      assert.ok(v >= 20 && v <= 20000, `${v} Hz out of hearing range`);
    }
  });
}

test('tilePitch rises left to right in a row, and the far row is highest', () => {
  for (let c = 1; c < 6; c += 1) {
    assert.ok(tilePitch(3, c, 4, 6) > tilePitch(3, c - 1, 4, 6));
  }
  assert.ok(tilePitch(0, 0, 4, 6) > tilePitch(3, 5, 4, 6));
});

test('tileSemitone uses the pentatonic scale for narrow boards, major for six columns', () => {
  const rowNotes = [0, 1, 2, 3].map((c) => tileSemitone(2, c, 3, 4) % 12);
  for (const n of rowNotes) {
    assert.ok(PENTATONIC.includes(n), `${n} not pentatonic`);
  }
  const six = [0, 1, 2, 3, 4, 5].map((c) => tileSemitone(3, c, 4, 6) % 12);
  for (const n of six) {
    assert.ok(MAJOR.includes(n), `${n} not in the major scale`);
  }
});

test('tilePitch clamps cells outside the board instead of failing', () => {
  assert.equal(tilePitch(-1, -1, 3, 4), tilePitch(0, 0, 3, 4));
  assert.equal(tilePitch(9, 9, 3, 4), tilePitch(2, 3, 3, 4));
  assert.ok(Number.isFinite(tilePitch(Number.NaN, 0, 3, 4)));
});

test('tileWave changes between neighbouring rows', () => {
  for (let r = 1; r < 4; r += 1) {
    assert.notEqual(tileWave(r, 4), tileWave(r - 1, 4));
  }
});
