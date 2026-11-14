/**
 * Six sound effects, all synthesized: oscillators, a seeded noise buffer,
 * filters and envelopes. No sound files.
 *
 * playSfx works on any BaseAudioContext, so the same code plays live (through
 * a panner per cell, see spatial.ts) and renders offline to WAV for the video
 * edit (see export.ts).
 */
import type { Wave } from './pitch.ts';

export const SFX_NAMES = ['rotate', 'connect', 'levelDone', 'gazeTick', 'error', 'reachSet'] as const;

export type SfxName = (typeof SFX_NAMES)[number];

/** Design values: length of each sound in seconds, tail included. */
export const SFX_SECONDS: Readonly<Record<SfxName, number>> = {
  rotate: 0.2,
  connect: 0.75,
  levelDone: 1.7,
  gazeTick: 0.08,
  error: 0.42,
  reachSet: 1.15,
};

/** Design values: pitch when the caller gives none, Hz. */
export const SFX_DEFAULT_HZ: Readonly<Record<SfxName, number>> = {
  rotate: 392,
  connect: 523.25,
  levelDone: 392,
  gazeTick: 784,
  error: 196,
  reachSet: 261.63,
};

export interface SfxOptions {
  /** Seconds from ctx.currentTime. Default 0. */
  when?: number;
  /** Base pitch, Hz. Tile sounds pass tilePitch(). */
  pitch?: number;
  /** Tone color for the pitched part of rotate and connect. */
  wave?: Wave;
  /** Output gain. Default 1. */
  gain?: number;
}

const SILENT = 0.0001;
const semis = (n: number) => Math.pow(2, n / 12);

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise, the same samples every time (seeded). */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 0x2f6b9d1 >>> 0;
    for (let i = 0; i < data.length; i += 1) {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      data[i] = (s / 4294967295) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

interface Voice {
  ctx: BaseAudioContext;
  out: AudioNode;
  sources: AudioScheduledSourceNode[];
}

function envelope(v: Voice, t: number, peak: number, attack: number, dur: number): GainNode {
  const g = v.ctx.createGain();
  g.gain.setValueAtTime(SILENT, t);
  g.gain.exponentialRampToValueAtTime(Math.max(SILENT * 2, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.005, dur));
  g.connect(v.out);
  return g;
}

function tone(
  v: Voice,
  t: number,
  hz: number,
  dur: number,
  peak: number,
  wave: Wave,
  attack = 0.005,
  glideFrom?: number,
): void {
  const osc = v.ctx.createOscillator();
  osc.type = wave;
  const f = Math.min(v.ctx.sampleRate / 2 - 1, Math.max(20, hz));
  if (glideFrom) {
    osc.frequency.setValueAtTime(glideFrom, t);
    osc.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.06, dur / 2));
  } else {
    osc.frequency.setValueAtTime(f, t);
  }
  const env = envelope(v, t, peak, attack, dur);
  if (wave === 'square' || wave === 'sawtooth') {
    // Soften bright waves so they stay pleasant.
    const lp = v.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(v.ctx.sampleRate / 2 - 1, f * 4), t);
    osc.connect(lp).connect(env);
  } else {
    osc.connect(env);
  }
  osc.start(t);
  osc.stop(t + dur + 0.02);
  v.sources.push(osc);
}

function noise(
  v: Voice,
  t: number,
  dur: number,
  peak: number,
  type: BiquadFilterType,
  hzFrom: number,
  hzTo: number,
  q: number,
): void {
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
  src.loop = true;
  const filter = v.ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.setValueAtTime(q, t);
  const nyq = v.ctx.sampleRate / 2 - 1;
  filter.frequency.setValueAtTime(Math.min(nyq, hzFrom), t);
  if (hzTo !== hzFrom) {
    filter.frequency.exponentialRampToValueAtTime(Math.min(nyq, hzTo), t + dur);
  }
  src.connect(filter).connect(envelope(v, t, peak, Math.min(0.02, dur / 3), dur));
  src.start(t);
  src.stop(t + dur + 0.02);
  v.sources.push(src);
}

const RECIPES: Readonly<Record<SfxName, (v: Voice, t: number, hz: number, wave: Wave) => void>> = {
  // Click plus a short blip that settles onto the tile's note.
  rotate(v, t, hz, wave) {
    noise(v, t, 0.03, 0.22, 'bandpass', hz * 6, hz * 6, 1.5);
    tone(v, t, hz, 0.15, 0.32, wave, 0.004, hz * semis(2));
  },
  // Rising fifth, like two bells.
  connect(v, t, hz, wave) {
    tone(v, t, hz, 0.45, 0.26, wave === 'square' ? 'triangle' : wave);
    tone(v, t + 0.07, hz * semis(7), 0.55, 0.22, 'sine');
    tone(v, t + 0.07, hz * 2, 0.4, 0.06, 'sine');
  },
  // Pentatonic run up, then a soft shimmer.
  levelDone(v, t, hz) {
    [0, 4, 7, 12, 16].forEach((s, i) => {
      tone(v, t + i * 0.09, hz * semis(s), 0.6, 0.15, 'triangle');
    });
    tone(v, t + 0.5, hz * 3, 1.1, 0.04, 'sine', 0.08);
    tone(v, t + 0.5, hz * 4, 1.1, 0.03, 'sine', 0.08);
  },
  // Quiet tick while gaze holds on a tile.
  gazeTick(v, t, hz) {
    tone(v, t, hz, 0.05, 0.1, 'sine', 0.003);
  },
  // Two low steps down a minor third. Not harsh.
  error(v, t, hz) {
    tone(v, t, hz, 0.13, 0.2, 'square', 0.006);
    tone(v, t + 0.15, hz * semis(-3), 0.2, 0.2, 'square', 0.006);
  },
  // Rising whoosh, then a soft major chord.
  reachSet(v, t, hz) {
    noise(v, t, 0.6, 0.16, 'bandpass', 300, 2400, 0.8);
    for (const s of [0, 4, 7]) {
      tone(v, t + 0.25, hz * semis(s), 0.85, 0.09, 'sine', 0.06);
    }
  },
};

/**
 * Plays one effect into `dest`. Returns the context time when it has fully
 * died away. Works with AudioContext and OfflineAudioContext.
 */
export function playSfx(
  ctx: BaseAudioContext,
  dest: AudioNode,
  name: SfxName,
  opts: SfxOptions = {},
): number {
  const t = ctx.currentTime + Math.max(0, opts.when ?? 0);
  const hz = opts.pitch && opts.pitch > 0 ? opts.pitch : SFX_DEFAULT_HZ[name];
  const out = ctx.createGain();
  out.gain.setValueAtTime(Math.max(0, opts.gain ?? 1), t);
  out.connect(dest);
  const voice: Voice = { ctx, out, sources: [] };
  RECIPES[name](voice, t, hz, opts.wave ?? 'triangle');
  const end = t + SFX_SECONDS[name];
  // Free the output once every part has stopped.
  let left = voice.sources.length;
  for (const s of voice.sources) {
    s.onended = () => {
      left -= 1;
      if (left === 0) {
        out.disconnect();
      }
    };
  }
  return end;
}
