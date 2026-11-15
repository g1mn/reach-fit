/**
 * The game on top of the XR layer: 12 levels (L01 is the one-turn tutorial
 * right after setting the reach), then today's board, saved after every solve
 * and resumed on the next visit. Wires in the theme (skin.ts), positional
 * sound, the language and sound buttons, the play logger, window.__reachfit
 * and the dev-server console bridge the autorun scripts read.
 *
 * Replaces src/xr/standalone.ts as what src/index.ts starts.
 */
import { createSystem, Vector3, type World } from '@iwsdk/core';
import { createSpatialAudio, type SfxName } from '../audio/index.ts';
import { getLocale, setLocale } from '../i18n/index.ts';
import { nextLocale } from '../i18n/locales.ts';
import { logger } from '../logger.ts';
import { localDate } from '../puzzle/daily.ts';
import { puzzle } from '../puzzle/engine.ts';
import { emptyRecord, recordSolve } from '../puzzle/save.ts';
import type { Board, InputKind, Level, LightResult, SaveRecord } from '../puzzle/types.ts';
import {
  emitDevBridge,
  installTestApi,
  tileEntityName,
  type ReachFitState,
  type SolutionTarget,
} from '../test-api.ts';
import { updateTheme } from '../theme/index.ts';
import { lookSeconds, repeatMsFor } from '../xr/access.ts';
import { createXrLayer, type MessagePart, type XrLayer } from '../xr/layer.ts';
import { MisGrabTracker, selectMisGrab, shapeMask } from '../xr/misgrab.ts';
import { readHead } from '../xr/probe.ts';
import { BUTTON_NAMES, type ButtonName } from '../xr/view.ts';
import { BRIDGE_LINE_MAX, logLines } from './bridge.ts';
import {
  DAILY_INDEX,
  flowReducer,
  initialFlow,
  isPlaying,
  MAIN_LEVEL_COUNT,
  type FlowEvent,
  type FlowState,
} from './flow.ts';
import { TutorialHint } from './hint.ts';
import { mountStartOver } from './page-extras.ts';
import { createBoardSkin, wrapTileView } from './skin.ts';

/** How long a notice (cannot turn, resumed, cannot save) stays, ms. Design value. */
const NOTICE_MS = 1500;
const LONG_NOTICE_MS = 3000;
/** Most connect sounds per turn. Design value. */
const MAX_CONNECT_SOUNDS = 3;
/** Gaze ring steps that tick, as shares of the dwell. Design value. */
const GAZE_TICK_STEP = 0.25;
/** localStorage key of the sound switch. */
const SOUND_KEY = 'reachfit.sound.v1';
/** Characters kept free in each log line for the page field ('"page":<13 digits>,' is 21). */
const PAGE_FIELD_ROOM = 32;

const UP = new Vector3(0, 1, 0);

function loadSoundOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function storeSoundOn(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Not saved; the switch still works for this visit.
  }
}

export interface Game {
  layer: XrLayer;
  state(): ReachFitState;
  /** Clears saved progress and plays from L01 (the 2D 'Start over' button). */
  startOver(): void;
}

export function startGame(world: World): Game {
  const levels: Level[] = puzzle.levels();
  let record: SaveRecord = puzzle.load();
  // Writing the loaded record back tells whether this browser can save.
  let canSave = puzzle.save(record);
  let saveWarned = false;
  let flow: FlowState = initialFlow(record.currentLevel);
  // Shown once on the 2D page and once more on the first board in XR.
  let bootNotice: MessagePart[] | null =
    flow.levelIndex > 0
      ? [['save.resumed', { n: flow.levelIndex + 1 }]]
      : !canSave
        ? [['save.unavailable']]
        : null;
  const bootNoticeShown = { page: false, xr: false };
  let dailyLevel: Level | null = null;
  let level: Level = levelFor(flow.levelIndex);
  let board: Board = level.board;
  let light: LightResult = puzzle.trace(board);
  let shown = false;
  let rotations = 0;
  let levelStart = 0;
  let soundOn = loadSoundOn();
  let notice: MessagePart[] | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let bridgeSeq = 0;
  let logDump = 0;
  // Tells page loads apart in the console bridge: a reload (Vite reloads the
  // page when a watched file changes) starts seq again from 1, and a reader
  // must not take a higher seq from the page that is gone.
  const pageId = Math.round(performance.timeOrigin);
  let lastStateKey = '';
  const misgrab = new MisGrabTracker();
  const gazeTicks = new Map<string, number>();

  const audio = createSpatialAudio({ rows: board.rows, cols: board.cols });
  audio.setEnabled(soundOn);
  wrapTileView(onGazeProgress);
  const skin = createBoardSkin(world.scene);
  const hint = new TutorialHint();
  hint.addTo(world.scene);

  const layer: XrLayer = createXrLayer(world, {
    logger,
    onCalibrateStart: () => {
      dispatch('calibrate');
      skin.clear();
      hint.hide();
      emitState();
    },
    onReachSet: () => {
      play('reachSet');
      dispatch('reach-set');
      // First placement starts the level; a later one moves the same board to the new arc.
      showLevel(!shown);
    },
    onTileSelect: (r, c, input) => {
      wake();
      turn(r, c, input);
    },
    onButton: (name, input) => {
      wake();
      button(name, input);
    },
    onAccessChange: () => {
      // The look time is in the play message ('hold for 0.8 s').
      if (flow.phase !== 'calibrate') {
        render();
      }
      emitLevel();
      emitState();
    },
    onVoiceChange: (voiceState) => {
      if (voiceState === 'none') {
        showNotice([['voice.noMic']], LONG_NOTICE_MS);
      }
      emitState();
    },
    onXrChange: (inXr) => {
      if (inXr) {
        wake();
      } else {
        // Leaving XR is also how a script asks for the full log.
        emitLog();
      }
      emitState();
    },
  });
  layer.setSoundOn(soundOn);

  function levelFor(index: number): Level {
    if (index === DAILY_INDEX) {
      const today = localDate();
      if (!dailyLevel || dailyLevel.seed !== today) {
        dailyLevel = puzzle.daily(today);
      }
      return dailyLevel;
    }
    return levels[index];
  }

  function dispatch(event: FlowEvent): void {
    flow = flowReducer(flow, event);
  }

  function wake(): void {
    void audio.resume();
  }

  function play(name: SfxName, r?: number, c?: number): void {
    if (r === undefined || c === undefined) {
      audio.play(name);
      return;
    }
    const at = layer.tilePosition(r, c);
    if (at) {
      audio.playAt(name, at, r, c);
    } else {
      audio.play(name);
    }
  }

  // Messages ------------------------------------------------------------------

  function playMessage(): MessagePart[] {
    const seconds = lookSeconds(layer.access().lookMs);
    switch (flow.phase) {
      case 'level-done': {
        const best = record.levels[level.id]?.bestRotations;
        return best !== undefined ? [['level.solved'], ['level.best', { n: best }]] : [['level.solved']];
      }
      case 'finished':
        return [['daily.done'], ['finish.title', { total: MAIN_LEVEL_COUNT }]];
      case 'daily':
        return [['daily.date', { date: level.seed ?? localDate() }], ['input.gaze', { seconds }]];
      default:
        if (level.kind === 'tutorial') {
          return [['level.tutorial']];
        }
        return [['input.pinch'], ['input.gaze', { seconds }]];
    }
  }

  function render(): void {
    layer.setMessage(...(notice ?? playMessage()));
    if (level.kind === 'daily') {
      layer.setStatus(['daily.title'], ['level.turns', { n: rotations }], ['level.fewest', { n: level.minRotations }]);
    } else {
      layer.setStatus(
        ['level.label', { n: level.index + 1 }],
        ['level.turns', { n: rotations }],
        ['level.fewest', { n: level.minRotations }],
      );
    }
    layer.setButtonVisible('Btn_Next', flow.phase === 'level-done');
  }

  function showNotice(parts: MessagePart[], ms = NOTICE_MS): void {
    notice = parts;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice = null;
      if (flow.phase !== 'calibrate') {
        render();
      }
    }, ms);
    if (flow.phase !== 'calibrate') {
      render();
    }
  }

  // Levels --------------------------------------------------------------------

  /** fresh: a new start of the level (board reset). Otherwise the board on show is placed again on a new arc. */
  function showLevel(fresh: boolean): void {
    const arc = layer.reach();
    if (fresh) {
      level = levelFor(flow.levelIndex);
      board = level.board;
      rotations = 0;
      misgrab.reset();
      gazeTicks.clear();
    }
    light = puzzle.trace(board);
    if (fresh || (rotations === 0 && !flow.solved)) {
      // Time a level from when its board is in reach, not from before calibration.
      levelStart = performance.now();
      logger.push({ type: 'level-start', levelId: level.id });
    }
    layer.showBoard(board, light);
    if (arc) {
      skin.apply(arc, board, light);
    }
    audio.setBoardSize(board.rows, board.cols);
    shown = true;
    updateHint();
    render();
    const where = layer.inXr() ? 'xr' : 'page';
    if (bootNotice && !bootNoticeShown[where]) {
      bootNoticeShown[where] = true;
      saveWarned = saveWarned || !canSave;
      showNotice(bootNotice, LONG_NOTICE_MS);
    }
    emitLevel();
    emitState();
  }

  function updateHint(): void {
    if (level.kind !== 'tutorial' || flow.solved || rotations > 0 || !isPlaying(flow)) {
      hint.hide();
      return;
    }
    const step = puzzle.solution(board)[0];
    const at = step ? layer.tilePosition(step.r, step.c) : null;
    if (at) {
      hint.show(at);
    } else {
      hint.hide();
    }
  }

  function turn(r: number, c: number, input: InputKind): void {
    if (!isPlaying(flow)) {
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
      play('error', r, c);
      showNotice([['level.cannotTurn']]);
      return;
    }
    const before = shapeMask(tile.kind, tile.rot);
    const prevLit = light.lit;
    board = puzzle.rotate(board, r, c, 1);
    const turned = board.tiles[r * board.cols + c];
    rotations++;
    logger.push({ type: 'rotate', target, r, c, input });
    const undo = misgrab.onTurn(target, before, shapeMask(turned.kind, turned.rot), performance.now());
    if (undo) {
      logger.push({ type: 'mis-grab', target, reason: undo, input });
    }
    light = puzzle.trace(board);
    layer.updateBoard(board, light);
    play('rotate', r, c);
    let connects = 0;
    light.lit.forEach((lit, i) => {
      const t = board.tiles[i];
      if (lit && !prevLit[i] && t.kind !== 'source' && connects < MAX_CONNECT_SOUNDS) {
        connects++;
        play('connect', t.r, t.c);
      }
    });
    if (light.solved) {
      solved();
    }
    updateHint();
    render();
    emitState();
  }

  function solved(): void {
    dispatch('solved');
    logger.push({
      type: 'level-end',
      levelId: level.id,
      rotations,
      minRotations: level.minRotations,
      ms: performance.now() - levelStart,
    });
    record = recordSolve(record, level, rotations);
    canSave = puzzle.save(record);
    play('levelDone');
    if (!canSave && !saveWarned) {
      saveWarned = true;
      showNotice([['save.unavailable']], LONG_NOTICE_MS);
    }
    emitLog();
  }

  function button(name: ButtonName, _input: InputKind): void {
    switch (name) {
      case 'Btn_Next':
        if (flow.phase === 'level-done') {
          dispatch('next');
          showLevel(true);
        }
        break;
      case 'Btn_Restart':
        if (shown && flow.phase !== 'calibrate') {
          dispatch('restart');
          showLevel(true);
        }
        break;
      case 'Btn_Language':
        changeLocale(nextLocale(getLocale()));
        break;
      case 'Btn_Sound':
        soundOn = !soundOn;
        audio.setEnabled(soundOn);
        layer.setSoundOn(soundOn);
        storeSoundOn(soundOn);
        break;
      case 'Btn_Reach':
        // The layer restarted calibration; onReachSet places the same board again.
        break;
    }
    emitState();
  }

  function changeLocale(code: string): boolean {
    const ok = setLocale(code);
    if (ok) {
      record = { ...record, locale: getLocale() };
      canSave = puzzle.save(record);
      logger.push({ type: 'locale', locale: getLocale() });
      emitState();
    }
    return ok;
  }

  function startOver(): void {
    record = { ...emptyRecord(), locale: getLocale() };
    canSave = puzzle.save(record);
    bootNotice = null;
    dispatch('reset');
    if (shown && flow.phase !== 'calibrate') {
      showLevel(true);
    } else {
      level = levelFor(flow.levelIndex);
      board = level.board;
      rotations = 0;
      emitState();
    }
  }

  function onGazeProgress(tileName: string, progress: number): void {
    // One tick each time the ring passes a quarter, so the dwell can be heard.
    const step = Math.floor(progress / GAZE_TICK_STEP);
    const last = gazeTicks.get(tileName) ?? 0;
    if (progress <= 0 || step < last) {
      gazeTicks.set(tileName, 0);
      return;
    }
    if (step > last && step < 1 / GAZE_TICK_STEP) {
      gazeTicks.set(tileName, step);
      const m = /^Tile_(\d+)_(\d+)$/.exec(tileName);
      if (m) {
        play('gazeTick', Number(m[1]), Number(m[2]));
      }
    }
  }

  // Test API and console bridge -----------------------------------------------

  function state(): ReachFitState {
    return {
      phase: flow.phase,
      levelId: shown ? level.id : null,
      levelIndex: shown ? level.index : -1,
      solved: flow.solved,
      rotations,
      minRotations: shown ? level.minRotations : null,
      locale: getLocale(),
      inputs: layer.inputs(),
      reach: layer.reach(),
      table: layer.table(),
      xr: layer.inXr(),
      access: layer.access(),
    };
  }

  function solution(): SolutionTarget[] {
    if (!shown || flow.solved || !isPlaying(flow)) {
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

  function headPose(): { x: number; y: number; z: number; yawDeg: number } {
    const h = readHead(world);
    return { x: h.position.x, y: h.position.y, z: h.position.z, yawDeg: h.yawDeg };
  }

  function emitState(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    emitDevBridge('state', {
      ...state(),
      page: pageId,
      seq: ++bridgeSeq,
      calibratePhase: layer.calibratePhase(),
      remaining: solution(),
      head: headPose(),
      buttons: buttonPositions(),
    });
  }

  function emitLevel(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    emitDevBridge('level', {
      page: pageId,
      seq: ++bridgeSeq,
      levelId: level.id,
      levelIndex: level.index,
      kind: level.kind,
      minRotations: level.minRotations,
      solution: solution(),
      targets: layer.targets(),
      buttons: buttonPositions(),
      dwellMs: layer.access().lookMs,
      repeatMs: repeatMsFor(layer.access().lookMs),
    });
  }

  function emitLog(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    const events = logger.log().filter((e) => e.type !== 'frame');
    logDump++;
    // Room for the page field in each line, so a line stays within BRIDGE_LINE_MAX.
    for (const line of logLines(logDump, events, logger.frameSummaries(), BRIDGE_LINE_MAX - PAGE_FIELD_ROOM)) {
      emitDevBridge('log', { page: pageId, ...line });
    }
  }

  function stateKey(): string {
    return [
      flow.phase,
      layer.calibratePhase(),
      layer.inXr(),
      shown ? level.id : '',
      rotations,
      flow.solved,
      getLocale(),
    ].join('|');
  }

  // Per frame -----------------------------------------------------------------

  function frame(dtSec: number): void {
    updateTheme(dtSec * 1000);
    const head = readHead(world);
    audio.setListener(head.position, head.forward, UP);
    hint.face(head.position);
    const key = stateKey();
    if (key !== lastStateKey) {
      lastStateKey = key;
      emitState();
    }
  }

  class ReachFitGameSystem extends createSystem({}) {
    update(delta: number): void {
      try {
        frame(delta);
      } catch (error) {
        logger.push({ type: 'error', message: `game frame: ${String(error)}` });
        console.error('[reachfit] game frame failed', error);
      }
    }
  }
  world.registerSystem(ReachFitGameSystem);

  if (typeof window !== 'undefined') {
    const onFirstAction = (): void => wake();
    window.addEventListener('pointerdown', onFirstAction, { once: true });
    window.addEventListener('keydown', onFirstAction, { once: true });
  }
  mountStartOver(startOver);

  installTestApi({
    state,
    log: () => logger.log(),
    solution,
    targets: () => layer.targets(),
    setLocale: changeLocale,
  });

  return { layer, state, startOver };
}
