/**
 * Game flow as a pure reducer, so Node tests drive it without three.js.
 *
 *   boot -> calibrate -> play (L01 tutorial ... L12) -> level-done -> next level
 *   after L12: daily (today's board) -> finished
 *
 * Calibration can start again at any time (entering XR, the reach button);
 * the level and its solved flag survive it, and 'reach-set' returns to the
 * phase the level was in.
 */
import type { Phase } from '../test-api.ts';

/** Main levels before the daily board. Same as the engine's level count. */
export const MAIN_LEVEL_COUNT = 12;
/** levelIndex of the daily board. */
export const DAILY_INDEX = -1;

export interface FlowState {
  phase: Phase;
  /** 0 to 11 for a main level, DAILY_INDEX for the daily board. */
  levelIndex: number;
  solved: boolean;
  /** True once a reach has been set, so a board can be on show. */
  placed: boolean;
}

export type FlowEvent = 'calibrate' | 'reach-set' | 'solved' | 'next' | 'restart' | 'reset';

/** Level to resume from a saved currentLevel (0 to 12). 12 means the main run is done. */
export function resumeIndex(currentLevel: number): number {
  if (!Number.isInteger(currentLevel) || currentLevel < 0) {
    return 0;
  }
  return currentLevel >= MAIN_LEVEL_COUNT ? DAILY_INDEX : currentLevel;
}

export function initialFlow(currentLevel = 0): FlowState {
  return { phase: 'boot', levelIndex: resumeIndex(currentLevel), solved: false, placed: false };
}

/** Phase of a level on show. */
export function playPhase(levelIndex: number, solved: boolean): Phase {
  if (levelIndex === DAILY_INDEX) {
    return solved ? 'finished' : 'daily';
  }
  return solved ? 'level-done' : 'play';
}

/** True when a board is on show and accepts turns. */
export function isPlaying(s: FlowState): boolean {
  return s.phase === 'play' || s.phase === 'daily';
}

function onBoard(s: FlowState): boolean {
  return s.placed && s.phase !== 'calibrate' && s.phase !== 'boot';
}

export function flowReducer(s: FlowState, event: FlowEvent): FlowState {
  switch (event) {
    case 'calibrate':
      return { ...s, phase: 'calibrate' };
    case 'reach-set':
      return { ...s, placed: true, phase: playPhase(s.levelIndex, s.solved) };
    case 'solved':
      return isPlaying(s) ? { ...s, solved: true, phase: playPhase(s.levelIndex, true) } : s;
    case 'next': {
      if (s.phase !== 'level-done') {
        return s;
      }
      const next = s.levelIndex + 1 >= MAIN_LEVEL_COUNT ? DAILY_INDEX : s.levelIndex + 1;
      return { ...s, levelIndex: next, solved: false, phase: playPhase(next, false) };
    }
    case 'restart':
      return onBoard(s) ? { ...s, solved: false, phase: playPhase(s.levelIndex, false) } : s;
    case 'reset': {
      const base = { ...s, levelIndex: 0, solved: false };
      return onBoard(s) ? { ...base, phase: 'play' } : base;
    }
  }
}
