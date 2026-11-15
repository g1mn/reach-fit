/**
 * Access settings: contrast mode, look time and microphone sensitivity.
 *
 * Three buttons on the second panel row change them (Contrast, Look, Mic),
 * and they are saved in the browser so the next visit starts the same way.
 * Pure apart from load/save, which only touch localStorage inside try/catch,
 * so Node tests import this file directly.
 */
import { CONTRAST_MODES, isContrastMode, type ContrastMode } from '../theme/palette.ts';

/** Look times the Look button cycles through, ms. 0.8 s is the default. Design value. */
export const LOOK_TIMES_MS: readonly number[] = [800, 1200, 2000, 500];
/** Repeat time on a held tile is this many look times. 1.5 keeps 0.8 s → 1.2 s as before. Design value. */
export const REPEAT_FACTOR = 1.5;

/** How loud a sound must be to count (Mic button). See SOUND_LEVELS in voice.ts. */
export type MicLevel = 'low' | 'medium' | 'high';
export const MIC_LEVELS: readonly MicLevel[] = ['medium', 'high', 'low'];

export interface AccessSettings {
  contrast: ContrastMode;
  lookMs: number;
  mic: MicLevel;
}

export const DEFAULT_ACCESS: Readonly<AccessSettings> = {
  contrast: 'standard',
  lookMs: 800,
  mic: 'medium',
};

/** localStorage key. */
export const ACCESS_KEY = 'reachfit.access.v1';

function next<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

export function nextContrast(mode: ContrastMode): ContrastMode {
  return next(CONTRAST_MODES, mode);
}

export function nextLookMs(ms: number): number {
  return next(LOOK_TIMES_MS, ms);
}

export function nextMic(level: MicLevel): MicLevel {
  return next(MIC_LEVELS, level);
}

/** Time between repeated turns while a look stays on a tile, ms. */
export function repeatMsFor(lookMs: number): number {
  return Math.round(lookMs * REPEAT_FACTOR);
}

/** Look time as shown on the button and in messages, in seconds with one decimal. */
export function lookSeconds(lookMs: number): string {
  return (lookMs / 1000).toFixed(1);
}

function isMicLevel(value: unknown): value is MicLevel {
  return typeof value === 'string' && (MIC_LEVELS as readonly string[]).includes(value);
}

/** Saved text to settings. Anything missing or unknown falls back to the default. */
export function parseAccess(text: string | null | undefined): AccessSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object') {
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    // Broken text: defaults.
  }
  return {
    contrast: isContrastMode(raw.contrast) ? raw.contrast : DEFAULT_ACCESS.contrast,
    lookMs:
      typeof raw.lookMs === 'number' && LOOK_TIMES_MS.includes(raw.lookMs) ? raw.lookMs : DEFAULT_ACCESS.lookMs,
    mic: isMicLevel(raw.mic) ? raw.mic : DEFAULT_ACCESS.mic,
  };
}

export function loadAccess(): AccessSettings {
  try {
    return parseAccess(globalThis.localStorage?.getItem(ACCESS_KEY));
  } catch {
    return { ...DEFAULT_ACCESS };
  }
}

/** False when the browser cannot save; the settings still work for this visit. */
export function saveAccess(settings: AccessSettings): boolean {
  try {
    if (!globalThis.localStorage) {
      return false;
    }
    globalThis.localStorage.setItem(ACCESS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
