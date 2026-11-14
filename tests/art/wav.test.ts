import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bytesToBase64, encodeWav } from '../../src/audio/wav.ts';

const ascii = (view: DataView, at: number, n: number) =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)));

test('encodeWav writes a RIFF/WAVE header with the sample rate and data size', () => {
  const left = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const right = new Float32Array([0, -0.25, 0.25, 2, -2]);
  const buf = encodeWav([left, right], 48000);
  const view = new DataView(buf);
  assert.equal(ascii(view, 0, 4), 'RIFF');
  assert.equal(ascii(view, 8, 4), 'WAVE');
  assert.equal(ascii(view, 12, 4), 'fmt ');
  assert.equal(ascii(view, 36, 4), 'data');
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 2); // channels
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 48000 * 4);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16);
  const dataSize = left.length * 2 * 2;
  assert.equal(view.getUint32(40, true), dataSize);
  assert.equal(view.getUint32(4, true), 36 + dataSize);
  assert.equal(buf.byteLength, 44 + dataSize);
});

test('encodeWav interleaves, scales and clamps samples', () => {
  const buf = encodeWav([new Float32Array([1, -1, 2, Number.NaN]), new Float32Array([0.5, -0.5, -2, 0])], 22050);
  const view = new DataView(buf);
  const s = (i: number) => view.getInt16(44 + i * 2, true);
  assert.deepEqual(
    [s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7)],
    [32767, 16384, -32768, -16384, 32767, -32768, 0, 0],
  );
});

test('encodeWav: mono length matches the input', () => {
  const buf = encodeWav([new Float32Array(1000)], 44100);
  assert.equal(new DataView(buf).getUint16(22, true), 1);
  assert.equal(buf.byteLength, 44 + 1000 * 2);
});

test('encodeWav refuses no channels and uneven channels', () => {
  assert.throws(() => encodeWav([], 48000));
  assert.throws(() => encodeWav([new Float32Array(2), new Float32Array(3)], 48000));
});

test('bytesToBase64 matches Buffer for every remainder length', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 44, 1001]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
    assert.equal(bytesToBase64(bytes.buffer), Buffer.from(bytes).toString('base64'));
  }
});
