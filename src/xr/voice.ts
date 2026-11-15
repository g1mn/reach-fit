/**
 * Sound confirm: a voice alternative to the hand. Not speech recognition.
 *
 * With the Voice button on, a short loud sound (a word, a hum, a clap) while
 * the look rests on a tile or a button acts like the 0.8 s hold finishing:
 * it fires now. The look still picks the target, the sound only confirms.
 * Audio is measured as loudness only and is never stored or sent anywhere.
 *
 * SoundGate is pure, so Node tests drive it with synthetic loudness values.
 *
 * The Mic button picks one of three levels (SOUND_LEVELS): high hears a soft
 * voice in a quiet room, low ignores a cough or a TV in a loud one. meter()
 * gives the share of the trigger level for the bar on the Mic button, so a
 * player can see whether a sound would count before using it on a tile.
 */
import type { MicLevel } from './access.ts';

/**
 * Per Mic level: loudness must beat the room noise by `ratio` and be at
 * least `minRms` (RMS, 0 to 1), so a silent room does not trigger on hiss.
 * Design value.
 */
export const SOUND_LEVELS: Readonly<Record<MicLevel, { ratio: number; minRms: number }>> = {
  high: { ratio: 2, minRms: 0.02 },
  medium: { ratio: 3, minRms: 0.04 },
  low: { ratio: 4, minRms: 0.08 },
};
/** Medium, the default. */
export const SOUND_RATIO = SOUND_LEVELS.medium.ratio;
export const SOUND_MIN_RMS = SOUND_LEVELS.medium.minRms;
/** Dead time after a trigger, ms. One word must not fire twice. Design value. */
export const SOUND_REFRACTORY_MS = 700;
/** Room noise estimate rises slowly and falls quickly. Rates per update. Design value. */
const NOISE_UP = 0.02;
const NOISE_DOWN = 0.2;
/** Loud sound that lasts longer than this is background (music, a fan), not a trigger, ms. Design value. */
export const SOUND_MAX_ONSET_MS = 900;

export class SoundGate {
  private noise = 0.01;
  private lastFire = -Infinity;
  private loudSince = -1;
  private armed = true;
  private ratio = SOUND_RATIO;
  private minRms = SOUND_MIN_RMS;

  constructor(level: MicLevel = 'medium') {
    this.setLevel(level);
  }

  /** Mic sensitivity. The room noise estimate is kept. */
  setLevel(level: MicLevel): void {
    this.ratio = SOUND_LEVELS[level].ratio;
    this.minRms = SOUND_LEVELS[level].minRms;
  }

  /** Loudness a sound needs right now. */
  get threshold(): number {
    return Math.max(this.minRms, this.noise * this.ratio);
  }

  /** rms as a share of the trigger level, 0 to 1 (1 means it would count). */
  meter(rms: number): number {
    return Math.max(0, Math.min(1, rms / this.threshold));
  }

  /** Room noise estimate, for tests and the status line. */
  get floor(): number {
    return this.noise;
  }

  /** Feed one loudness reading. True on the update where a sound counts. */
  update(rms: number, t: number): boolean {
    const loud = rms >= this.minRms && rms >= this.noise * this.ratio;
    if (!loud) {
      this.noise += (rms - this.noise) * (rms < this.noise ? NOISE_DOWN : NOISE_UP);
      this.loudSince = -1;
      this.armed = true;
      return false;
    }
    if (this.loudSince < 0) {
      this.loudSince = t;
    }
    if (t - this.loudSince > SOUND_MAX_ONSET_MS) {
      // Long steady loudness: treat it as the new room level.
      this.noise += (rms - this.noise) * NOISE_UP;
      return false;
    }
    if (!this.armed || t - this.lastFire < SOUND_REFRACTORY_MS) {
      return false;
    }
    this.armed = false;
    this.lastFire = t;
    return true;
  }
}

export interface Mic {
  /** Current loudness, RMS from 0 to 1. */
  level(): number;
  stop(): void;
}

/**
 * Opens the microphone for loudness only. Echo cancellation and noise
 * suppression stay on so the game's own sounds are not heard as a trigger.
 * Resolves null when there is no microphone, the permission is refused, or
 * the page is not secure.
 */
export async function openMic(): Promise<Mic | null> {
  try {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      return null;
    }
    const stream = await media.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
    });
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    const ctx = new AudioCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    return {
      level: () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          sum += buf[i] * buf[i];
        }
        return Math.sqrt(sum / buf.length);
      },
      stop: () => {
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close();
      },
    };
  } catch {
    return null;
  }
}
