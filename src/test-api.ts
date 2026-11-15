/**
 * window.__reachfit: the contract between the app and everything that drives
 * it from outside (autorun scripts, the capture driver, the 2D log download).
 *
 * src/index.ts installs a placeholder at startup. The XR layer calls
 * installTestApi() again with real functions once the game is running.
 * Keep the shapes below stable: autorun and capture scripts read them.
 */
import { DEFAULT_LOCALE, type Locale } from './i18n/locales.ts';
import type { InputKind, SolutionStep } from './puzzle/types.ts';

export type Phase =
  | 'boot'
  | 'calibrate'
  | 'play'
  | 'level-done'
  | 'daily'
  | 'finished';

/** The arc the board follows, fitted to the player's sweep. Meters, world space. */
export interface ReachArc {
  center: [number, number, number];
  radius: number;
  /** Arc ends in degrees around +Y, 0 = straight ahead (-Z). */
  startDeg: number;
  endDeg: number;
  source: 'hand' | 'gaze' | 'default';
}

export interface TableSurface {
  /** Table top height above the floor, meters. */
  height: number;
  /** hand: no plane or hit, so the height of the hand sweep. */
  source: 'plane' | 'hit-test' | 'hand' | 'virtual';
}

export interface ReachFitState {
  phase: Phase;
  /** Level.id, or null before the first level. */
  levelId: string | null;
  /** 0 to 11, -1 for the daily board or before the first level. */
  levelIndex: number;
  solved: boolean;
  /** Quarter turns made on the current level. */
  rotations: number;
  minRotations: number | null;
  locale: Locale;
  /** Input methods that are on right now. Pinch and gaze are always on. */
  inputs: InputKind[];
  reach: ReachArc | null;
  table: TableSurface | null;
  /** True inside an immersive session. */
  xr: boolean;
  /** Contrast mode, look time (ms) and mic sensitivity. Absent before the game starts. */
  access?: { contrast: 'standard' | 'max' | 'dim'; lookMs: number; mic: 'low' | 'medium' | 'high' };
}

/** t is performance.now() in ms. Tile names follow tileEntityName(). */
export type LogEvent =
  | { t: number; type: 'frame'; dt: number }
  | {
      t: number;
      type: 'reach-sample';
      x: number;
      y: number;
      z: number;
      source: 'hand' | 'gaze';
    }
  | { t: number; type: 'reach-set'; arc: ReachArc }
  | { t: number; type: 'table'; surface: TableSurface }
  | { t: number; type: 'level-start'; levelId: string }
  | {
      t: number;
      type: 'level-end';
      levelId: string;
      rotations: number;
      minRotations: number;
      ms: number;
    }
  | {
      t: number;
      type: 'rotate';
      target: string;
      r: number;
      c: number;
      input: InputKind;
    }
  | {
      t: number;
      type: 'mis-grab';
      target: string;
      reason: 'undone-within-2s' | 'not-rotatable';
      input: InputKind;
    }
  | { t: number; type: 'locale'; locale: Locale }
  | { t: number; type: 'error'; message: string };

/**
 * A solution step plus what the CLI needs to act on it: the tile entity name
 * for `xr run-sequence` (pinch) and the tile center for `xr look-at` (gaze).
 */
export interface SolutionTarget extends SolutionStep {
  target: string;
  /** Tile center in world space, meters. Null before the board is placed. */
  position: { x: number; y: number; z: number } | null;
}

export interface ReachFitTestApi {
  version: 1;
  state(): ReachFitState;
  log(): LogEvent[];
  /** Steps that solve the current level from its current state. */
  solution(): SolutionTarget[];
  /** Entity names of every tile on the current board. */
  targets(): string[];
  /** False for an unknown code. */
  setLocale(locale: string): boolean;
}

declare global {
  interface Window {
    __reachfit?: ReachFitTestApi;
  }
}

/** Entity name of the tile at row r, column c, e.g. Tile_0_2. */
export function tileEntityName(r: number, c: number): string {
  return `Tile_${r}_${c}`;
}

export function emptyState(): ReachFitState {
  return {
    phase: 'boot',
    levelId: null,
    levelIndex: -1,
    solved: false,
    rotations: 0,
    minRotations: null,
    locale: DEFAULT_LOCALE,
    inputs: ['pinch', 'gaze'],
    reach: null,
    table: null,
    xr: false,
  };
}

/** Sets window.__reachfit. Missing functions fall back to empty answers. */
export function installTestApi(
  impl: Partial<Omit<ReachFitTestApi, 'version'>> = {},
): ReachFitTestApi {
  const api: ReachFitTestApi = {
    version: 1,
    state: impl.state ?? emptyState,
    log: impl.log ?? (() => []),
    solution: impl.solution ?? (() => []),
    targets: impl.targets ?? (() => []),
    setLocale: impl.setLocale ?? (() => false),
  };
  window.__reachfit = api;
  return api;
}

export type BridgeKind = 'state' | 'level' | 'log';

/**
 * Dev-server only bridge for the IWSDK CLI, which can read console logs
 * (`npx @iwsdk/cli browser logs`) but cannot evaluate page code. Prints one
 * line `[reachfit:<kind>] <json>`. Call it on level start (kind 'level' with
 * solution() and targets()), on every state change (kind 'state'), and when
 * the run ends (kind 'log' with log()). Production builds print nothing.
 */
export function emitDevBridge(kind: BridgeKind, payload: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }
  console.info(`[reachfit:${kind}] ${JSON.stringify(payload)}`);
}
