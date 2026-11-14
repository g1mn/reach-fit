/**
 * Offline render of the effects to WAV, for the video edit. Same synthesis
 * code as live play (sfx.ts), rendered in an OfflineAudioContext.
 *
 * installSfxExportHook() puts window.__reachfitSfx on the page in the dev
 * server and in the capture build only. A capture driver can then call
 *   await window.__reachfitSfx.exportAll()
 * and get { rotate: '<base64 WAV>', ... } for all six effects.
 */
import { tilePitch, tileWave } from './pitch.ts';
import { playSfx, SFX_NAMES, SFX_SECONDS, type SfxName, type SfxOptions } from './sfx.ts';
import { bytesToBase64, encodeWav } from './wav.ts';

/** Design value: sample rate of exported WAV files. */
export const EXPORT_SAMPLE_RATE = 48000;

/** Silence before the sound starts, seconds. Design value. */
const LEAD_S = 0.01;

/** Renders one effect to a stereo 16-bit WAV file. */
export async function renderSfx(
  name: SfxName,
  sampleRate: number = EXPORT_SAMPLE_RATE,
  opts: Omit<SfxOptions, 'when'> = {},
): Promise<ArrayBuffer> {
  const seconds = LEAD_S + SFX_SECONDS[name] + 0.05;
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(seconds * sampleRate),
    sampleRate,
  });
  playSfx(ctx, ctx.destination, name, { ...opts, when: LEAD_S });
  const buf = await ctx.startRendering();
  return encodeWav([buf.getChannelData(0), buf.getChannelData(1)], sampleRate);
}

/** All six effects at their default pitch, as base64 WAV. */
export async function exportAllSfx(
  sampleRate: number = EXPORT_SAMPLE_RATE,
): Promise<Record<SfxName, string>> {
  const out = {} as Record<SfxName, string>;
  for (const name of SFX_NAMES) {
    out[name] = bytesToBase64(await renderSfx(name, sampleRate));
  }
  return out;
}

export interface SfxExportApi {
  names: SfxName[];
  exportAll(sampleRate?: number): Promise<Record<SfxName, string>>;
  /** One effect as base64 WAV. With a cell, uses that cell's note and tone color. */
  render(
    name: SfxName,
    cell?: { r: number; c: number; rows: number; cols: number },
    sampleRate?: number,
  ): Promise<string>;
}

declare global {
  interface Window {
    __reachfitSfx?: SfxExportApi;
  }
}

/** Dev server and capture build only. A normal build drops the body. */
export function installSfxExportHook(): void {
  if (!(import.meta.env.DEV || import.meta.env.VITE_CAPTURE === '1')) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  window.__reachfitSfx = {
    names: [...SFX_NAMES],
    exportAll: (sampleRate) => exportAllSfx(sampleRate),
    async render(name, cell, sampleRate) {
      const opts = cell
        ? { pitch: tilePitch(cell.r, cell.c, cell.rows, cell.cols), wave: tileWave(cell.r, cell.rows) }
        : {};
      return bytesToBase64(await renderSfx(name, sampleRate, opts));
    },
  };
}
