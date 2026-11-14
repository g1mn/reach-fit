/**
 * Minimal game loop on top of the XR layer, so MV04 runs end to end on its
 * own: calibrate, play the stand-in levels, turn tiles by pinch or gaze,
 * Next / Restart / Reach / Language / Sound. It also fills window.__reachfit
 * and the dev-server console bridge.
 *
 * MV08 replaces this file's role with src/game (12 levels, saving, daily
 * board, theme and sound). Everything it needs is on the XrLayer interface.
 */
import type { World } from '@iwsdk/core';
import { getLocale, setLocale } from '../i18n/index.ts';
import { nextLocale } from '../i18n/locales.ts';
import { logger } from '../logger.ts';
import type { Board, InputKind, Level } from '../puzzle/types.ts';
import {
  emitDevBridge,
  installTestApi,
  tileEntityName,
  type Phase,
  type ReachFitState,
  type SolutionTarget,
} from '../test-api.ts';
import { DWELL_MS } from './dwell.ts';
import { createXrLayer, type XrLayer } from './layer.ts';
import { MisGrabTracker, selectMisGrab, shapeMask } from './misgrab.ts';
import { puzzle } from './puzzle-source.ts';
import { BUTTON_NAMES, type ButtonName } from './view.ts';

/** How long 'This tile does not turn.' stays before the hint returns, ms. Design value. */
const NOTICE_MS = 1500;
/** Longest console bridge line, characters (CLI log reader limit, see MV08 spec). */
const BRIDGE_LINE_MAX = 4000;

export interface Standalone {
  layer: XrLayer;
  state(): ReachFitState;
}

export function startStandalone(world: World): Standalone {
  const levels: Level[] = puzzle.levels();
  let index = 0;
  let level: Level = levels[0];
  let board: Board = level.board;
  let rotations = 0;
  let solved = false;
  let started = false;
  let levelStart = 0;
  let soundOn = true;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const misgrab = new MisGrabTracker();

  const layer: XrLayer = createXrLayer(world, {
    logger,
    onCalibrateStart: () => emitState(),
    onReachSet: () => {
      if (!started) {
        startLevel(index);
      } else {
        // Recalibrated mid-level: keep the board as it is.
        layer.showBoard(board, puzzle.trace(board));
        showPlayMessage();
        layer.setButtonVisible('Btn_Next', solved);
        emitLevel();
      }
      emitState();
    },
    onTileSelect: (r, c, input) => turn(r, c, input),
    onButton: (name, input) => button(name, input),
    onXrChange: () => emitState(),
  });

  function showPlayMessage(): void {
    if (solved) {
      layer.setMessage(['level.solved']);
    } else if (level.kind === 'tutorial') {
      layer.setMessage(['level.tutorial'], ['input.gaze', { seconds: DWELL_MS / 1000 }]);
    } else {
      layer.setMessage(['input.pinch'], ['input.gaze', { seconds: DWELL_MS / 1000 }]);
    }
  }

  function showStatus(): void {
    layer.setStatus(
      ['level.label', { n: index + 1 }],
      ['level.turns', { n: rotations }],
      ['level.fewest', { n: level.minRotations }],
    );
  }

  function startLevel(i: number): void {
    index = i;
    level = levels[i];
    board = level.board;
    rotations = 0;
    solved = false;
    started = true;
    misgrab.reset();
    levelStart = performance.now();
    logger.push({ type: 'level-start', levelId: level.id });
    layer.showBoard(board, puzzle.trace(board));
    layer.setButtonVisible('Btn_Next', false);
    showPlayMessage();
    showStatus();
    emitLevel();
    emitState();
  }

  function turn(r: number, c: number, input: InputKind): void {
    if (solved) {
      return;
    }
    const tile = board.tiles[r * board.cols + c];
    if (!tile) {
      return;
    }
    const target = tileEntityName(r, c);
    const bad = selectMisGrab(tile);
    if (bad) {
      logger.push({ type: 'mis-grab', target, reason: bad, input });
      layer.setMessage(['level.cannotTurn']);
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(showPlayMessage, NOTICE_MS);
      return;
    }
    const before = shapeMask(tile.kind, tile.rot);
    board = puzzle.rotate(board, r, c, 1);
    const turned = board.tiles[r * board.cols + c];
    rotations++;
    logger.push({ type: 'rotate', target, r, c, input });
    const undo = misgrab.onTurn(target, before, shapeMask(turned.kind, turned.rot), performance.now());
    if (undo) {
      logger.push({ type: 'mis-grab', target, reason: undo, input });
    }
    const light = puzzle.trace(board);
    layer.updateBoard(board, light);
    if (light.solved) {
      solved = true;
      logger.push({
        type: 'level-end',
        levelId: level.id,
        rotations,
        minRotations: level.minRotations,
        ms: performance.now() - levelStart,
      });
      layer.setButtonVisible('Btn_Next', true);
      emitLog();
    }
    showPlayMessage();
    showStatus();
    emitState();
  }

  function button(name: ButtonName, _input: InputKind): void {
    switch (name) {
      case 'Btn_Next':
        if (solved) {
          startLevel((index + 1) % levels.length);
        }
        break;
      case 'Btn_Restart':
        startLevel(index);
        break;
      case 'Btn_Language':
        changeLocale(nextLocale(getLocale()));
        break;
      case 'Btn_Sound':
        soundOn = !soundOn;
        layer.setSoundOn(soundOn);
        break;
      case 'Btn_Reach':
        // The layer already restarted calibration; onReachSet re-shows the board.
        break;
    }
    emitState();
  }

  function changeLocale(code: string): boolean {
    const ok = setLocale(code);
    if (ok) {
      logger.push({ type: 'locale', locale: getLocale() });
      emitState();
    }
    return ok;
  }

  function phase(): Phase {
    if (layer.phase() === 'calibrate') {
      return 'calibrate';
    }
    if (!started) {
      return 'boot';
    }
    return solved ? 'level-done' : 'play';
  }

  function state(): ReachFitState {
    return {
      phase: phase(),
      levelId: started ? level.id : null,
      levelIndex: started ? level.index : -1,
      solved,
      rotations,
      minRotations: started ? level.minRotations : null,
      locale: getLocale(),
      inputs: layer.inputs(),
      reach: layer.reach(),
      table: layer.table(),
      xr: layer.inXr(),
    };
  }

  function solution(): SolutionTarget[] {
    if (!started || solved) {
      return [];
    }
    return puzzle.solution(board).map((s) => ({
      ...s,
      target: tileEntityName(s.r, s.c),
      position: layer.tilePosition(s.r, s.c),
    }));
  }

  function buttonPositions(): Record<string, { x: number; y: number; z: number } | null> {
    const out: Record<string, { x: number; y: number; z: number } | null> = {};
    for (const name of BUTTON_NAMES) {
      out[name] = layer.buttonPosition(name);
    }
    return out;
  }

  function emitState(): void {
    emitDevBridge('state', state());
  }

  function emitLevel(): void {
    emitDevBridge('level', {
      levelId: level.id,
      solution: solution(),
      targets: layer.targets(),
      buttons: buttonPositions(),
    });
  }

  /** Splits the non-frame events into console lines of at most BRIDGE_LINE_MAX characters. */
  function emitLog(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    const events = logger.log().filter((e) => e.type !== 'frame');
    const chunks: (typeof events)[] = [];
    let current: typeof events = [];
    for (const e of events) {
      const trial = [...current, e];
      if (current.length > 0 && JSON.stringify({ part: 0, of: 0, events: trial }).length > BRIDGE_LINE_MAX - 40) {
        chunks.push(current);
        current = [e];
      } else {
        current = trial;
      }
    }
    chunks.push(current);
    chunks.forEach((part, i) => emitDevBridge('log', { part: i + 1, of: chunks.length, events: part }));
    emitDevBridge('log', { frameSummaries: logger.frameSummaries() });
  }

  installTestApi({
    state,
    log: () => logger.log(),
    solution,
    targets: () => layer.targets(),
    setLocale: changeLocale,
  });

  return { layer, state };
}
