/**
 * 16-bit PCM WAV encoding and base64. Pure: runs in Node and in the page.
 */

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Interleaves the channels into a 16-bit PCM WAV file. All channels must have
 * the same length. Samples are clamped to -1..1; NaN becomes 0.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): ArrayBuffer {
  if (channels.length === 0) {
    throw new RangeError('encodeWav needs at least one channel');
  }
  const frames = channels[0].length;
  if (channels.some((ch) => ch.length !== frames)) {
    throw new RangeError('encodeWav channels differ in length');
  }
  const rate = Math.round(sampleRate);
  if (!(rate > 0)) {
    throw new RangeError(`bad sample rate: ${sampleRate}`);
  }
  const numChannels = channels.length;
  const blockAlign = numChannels * 2;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const raw = channels[ch][i];
      const s = Number.isNaN(raw) ? 0 : Math.max(-1, Math.min(1, raw));
      view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      offset += 2;
    }
  }
  return buffer;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}
