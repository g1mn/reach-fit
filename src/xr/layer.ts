/**
 * XR layer: reach calibration, the arc board, the panel and its buttons, and
 * the two input paths that are always on.
 *
 *  - Pinch: each tile root (Tile_r_c) carries RayInteractable, so a far hand
 *    ray pinch or a controller trigger selects it. The near hand pinch needs
 *    OneHandGrabbable, but the grab system marks a grabbable object
 *    pointerEventsType {deny: 'ray'} (@iwsdk/core grab/grab-system.js) and
 *    pointer-events passes that down to every child, which would switch the
 *    ray path off. So the grabbable sits on its own child entity (Grip_r_c,
 *    an invisible box over the tile, move and turn locked) and the ray keeps
 *    the visible meshes.
 *    A pinch whose pinch point (thumb tip and index tip midpoint) is on the
 *    board is decided by that point, not by the pointer that fired: the
 *    session's selectstart picks the tile under the fingers (pinch.ts), and
 *    pointerdowns from that pinch are ignored. The grab pointer alone picks the
 *    tile nearest the palm, often the next row. Far pinches, controllers and
 *    the 2D mouse still select through pointerdown.
 *  - Head gaze: a ray from the head; resting it on a turnable tile or a button
 *    for DWELL_MS selects it, with a progress ring. Tiles repeat every
 *    DWELL_REPEAT_MS while the look stays.
 *
 * The layer never changes the board itself. It reports selects through
 * callbacks and draws whatever board the caller passes (standalone.ts now,
 * src/game in MV08).
 */
import {
  BoxGeometry,
  createSystem,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  PokeInteractable,
  Raycaster,
  RayInteractable,
  Vector3,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';
import { LOCALE_NAMES, type MessageKey } from '../i18n/locales.ts';
import { getLocale, onLocaleChange, t, type MessageParams } from '../i18n/index.ts';
import type { PlayLogger } from '../logger.ts';
import type { Board, InputKind, LightResult } from '../puzzle/types.ts';
import { tileEntityName, type ReachArc, type TableSurface } from '../test-api.ts';
import { dirFromDeg, layoutBoard, TILE_SIZE, TILE_VISUAL_RATIO, type BoardLayout } from './arc.ts';
import { ReachCalibrator, type CalibrateEvent, type CalibratePhase } from './calibrate.ts';
import { DwellTimer } from './dwell.ts';
import { openMic, SoundGate, type Mic } from './voice.ts';
import { pickByPinch, pinchingHand, type PinchPick, type Vec3 } from './pinch.ts';
import {
  controllersPresent,
  handsPresent,
  readHead,
  readIndexTip,
  readPinchPoints,
  TableProbe,
  type HandPinch,
  type HeadPose,
} from './probe.ts';
import { VIRTUAL_TABLE_HEIGHT } from './table.ts';
import {
  BUTTON_NAMES,
  ButtonView,
  makeBoardBase,
  PANEL_H,
  PanelView,
  Reticle,
  TileView,
  Trail,
  type ButtonName,
} from './view.ts';

/** Same tile selected again within this time is one select, ms. Design value. */
const TILE_DEBOUNCE_MS = 150;
/** Same button pressed again within this time is one press, ms. Design value. */
const BUTTON_DEBOUNCE_MS = 350;
/** Gaze ray length, m. Design value. */
const GAZE_MAX_DISTANCE = 3;
/** Panel distance beyond the far row and tilt back. Design value. */
const PANEL_GAP = 0.05;
const PANEL_TILT_RAD = -0.35;
/** Where the panel floats during calibration: ahead of and below the head, m. Design value. */
const CALIBRATE_PANEL_AHEAD = 0.5;
const CALIBRATE_PANEL_DROP = 0.28;
/** Reticle distance along the head ray during gaze calibration, m. Design value. */
const RETICLE_DISTANCE = 0.6;
/** Height of the invisible near-pinch box over each tile, m. Design value. */
const GRIP_HEIGHT = 0.03;

/** Entity name of the near-pinch box of the tile at row r, column c. */
export function gripEntityName(r: number, c: number): string {
  return `Grip_${r}_${c}`;
}

export type LayerPhase = 'calibrate' | 'ready';

/** One message line: a key from en.json and its placeholder values. */
export type MessagePart = [MessageKey, MessageParams?];

export interface XrLayerCallbacks {
  /** A tile was selected. The layer does not change the board. */
  onTileSelect?: (r: number, c: number, input: InputKind) => void;
  onButton?: (name: ButtonName, input: InputKind) => void;
  /** Calibration started (also on entering XR and on Btn_Reach). */
  onCalibrateStart?: () => void;
  /** A reach arc and a table were chosen. Call showBoard after this. */
  onReachSet?: (arc: ReachArc, table: TableSurface) => void;
  onXrChange?: (inXr: boolean) => void;
}

export interface XrLayerOptions extends XrLayerCallbacks {
  logger: PlayLogger;
}

export interface XrLayer {
  phase(): LayerPhase;
  calibratePhase(): CalibratePhase;
  inXr(): boolean;
  reach(): ReachArc | null;
  table(): TableSurface | null;
  /** Input methods on right now. Pinch and gaze always; controller when one is connected. */
  inputs(): InputKind[];
  /** Draws a board on the reach arc, replacing the previous one. */
  showBoard(board: Board, light?: LightResult): void;
  /** Updates rotations (animated) and lit paths of the board on show. */
  updateBoard(board: Board, light: LightResult): void;
  hideBoard(): void;
  setMessage(...parts: MessagePart[]): void;
  setStatus(...parts: MessagePart[]): void;
  setButtonVisible(name: ButtonName, visible: boolean): void;
  setSoundOn(on: boolean): void;
  /** Starts calibration again (Btn_Reach). */
  recalibrate(): void;
  /** Tile center in world space, or null. */
  tilePosition(r: number, c: number): { x: number; y: number; z: number } | null;
  buttonPosition(name: ButtonName): { x: number; y: number; z: number } | null;
  /** Tile entity names of the board on show. */
  targets(): string[];
  dispose(): void;
}

interface TileEntry {
  r: number;
  c: number;
  rotatable: boolean;
  kind: Board['tiles'][number]['kind'];
  view: TileView;
  entity: Entity;
  /** Child entity with OneHandGrabbable for the near pinch. */
  gripEntity: Entity;
  pointerHover: number;
  /** Pointers on the near-pinch grip only (a hand touching the tile). */
  gripHover: number;
  lastSelect: number;
}

interface ButtonEntry {
  view: ButtonView;
  entity: Entity;
  visible: boolean;
  pointerHover: number;
  lastPress: number;
}

export function createXrLayer(world: World, options: XrLayerOptions): XrLayer {
  const { logger } = options;
  const scene = world.scene;
  const calibrator = new ReachCalibrator();
  const probe = new TableProbe();
  const dwell = new DwellTimer();
  const raycaster = new Raycaster();
  raycaster.far = GAZE_MAX_DISTANCE;

  let phase: LayerPhase = 'calibrate';
  let xr = false;
  let arc: ReachArc | null = null;
  let table: TableSurface | null = null;
  let layout: BoardLayout | null = null;
  let soundOn = true;
  /** Voice confirm: 'off' until the button is pressed, 'none' when no microphone could be opened. */
  let voice: 'off' | 'on' | 'none' = 'off';
  let mic: Mic | null = null;
  const soundGate = new SoundGate();
  let messageParts: MessagePart[] = [];
  let statusParts: MessagePart[] = [];
  let lastGazeTarget: string | null = null;
  let disposed = false;
  /** Pinch points of the tracked hands, refreshed every XR frame while the board is up. */
  let pinches: HandPinch[] = [];
  let listenedSession: XRSession | null = null;

  // Board root: tiles and the base plate hang under it.
  const boardRoot = new Group();
  boardRoot.name = 'ReachFitBoard';
  const boardEntity = world.createTransformEntity(boardRoot, { persistent: true });
  let boardBase: Mesh | null = null;
  const tiles = new Map<string, TileEntry>();
  // One invisible box shape for every tile's near-pinch grip. Hidden by the
  // material, not by Object3D.visible, so pointer hit tests still see it.
  const gripSize = TILE_SIZE * TILE_VISUAL_RATIO;
  const gripGeometry = new BoxGeometry(gripSize, GRIP_HEIGHT, gripSize);
  const gripMaterial = new MeshBasicMaterial({ visible: false });

  // Panel and buttons.
  const panel = new PanelView();
  const panelEntity = world.createTransformEntity(panel.root, { persistent: true });
  panel.root.rotation.order = 'YXZ';
  const buttons = new Map<ButtonName, ButtonEntry>();
  BUTTON_NAMES.forEach((name, i) => {
    const view = new ButtonView(name);
    const slot = panel.buttonSlot(i, BUTTON_NAMES.length);
    view.root.position.set(slot.x, slot.y, slot.z);
    const entity = world.createTransformEntity(view.root, { parent: panelEntity });
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    const entry: ButtonEntry = { view, entity, visible: true, pointerHover: 0, lastPress: -Infinity };
    view.root.addEventListener('pointerdown', () => pressButton(name, pointerKind()));
    view.root.addEventListener('pointerenter', () => {
      entry.pointerHover++;
      view.setHover(true);
    });
    view.root.addEventListener('pointerleave', () => {
      entry.pointerHover = Math.max(0, entry.pointerHover - 1);
      view.setHover(entry.pointerHover > 0 || lastGazeTarget === name);
    });
    buttons.set(name, entry);
  });

  // Calibration helpers.
  const trail = new Trail();
  scene.add(trail.line);
  const reticle = new Reticle();
  scene.add(reticle.mesh);

  function pointerKind(): InputKind {
    if (!world.session) {
      return 'controller';
    }
    return handsPresent(world) || !controllersPresent(world) ? 'pinch' : 'controller';
  }

  function render(): void {
    panel.message.setText(messageParts.map(([k, p]) => t(k, p)).join('\n'));
    panel.status.setText(statusParts.map(([k, p]) => t(k, p)).join('   '));
    buttons.get('Btn_Next')?.view.setLabel(t('level.next'));
    buttons.get('Btn_Restart')?.view.setLabel(t('level.restart'));
    buttons.get('Btn_Reach')?.view.setLabel(t('reach.redo'));
    buttons.get('Btn_Language')?.view.setLabel(LOCALE_NAMES[getLocale()]);
    buttons
      .get('Btn_Sound')
      ?.view.setLabel(`${t('settings.sound')}: ${soundOn ? t('settings.on') : t('settings.off')}`);
    buttons
      .get('Btn_Voice')
      ?.view.setLabel(
        `${t('settings.voice')}: ${voice === 'on' ? t('settings.on') : voice === 'none' ? t('settings.voiceNone') : t('settings.off')}`,
      );
  }
  const offLocale = onLocaleChange(render);

  function setButtonVisible(name: ButtonName, visible: boolean): void {
    const b = buttons.get(name);
    if (!b) {
      return;
    }
    b.visible = visible;
    b.view.root.visible = visible;
  }

  function pressButton(name: ButtonName, input: InputKind): void {
    const b = buttons.get(name);
    const now = performance.now();
    if (!b || !b.visible || now - b.lastPress < BUTTON_DEBOUNCE_MS) {
      return;
    }
    b.lastPress = now;
    if (name === 'Btn_Reach') {
      recalibrate();
    }
    if (name === 'Btn_Voice') {
      toggleVoice();
    }
    if (input === 'voice') {
      dwell.holdIfOn(name);
    }
    options.onButton?.(name, input);
  }

  function toggleVoice(): void {
    if (voice === 'on') {
      mic?.stop();
      mic = null;
      voice = 'off';
      render();
      return;
    }
    // Asked from a press, so the browser's permission prompt has a reason to show.
    void openMic().then((opened) => {
      if (disposed) {
        opened?.stop();
        return;
      }
      mic = opened;
      voice = opened ? 'on' : 'none';
      render();
    });
  }

  function selectTile(key: string, input: InputKind): void {
    const tile = tiles.get(key);
    const now = performance.now();
    if (!tile || phase !== 'ready' || now - tile.lastSelect < TILE_DEBOUNCE_MS) {
      return;
    }
    tile.lastSelect = now;
    if (input !== 'gaze') {
      // A hand or controller turned it; a look resting on the same tile must
      // not add another turn 0.8 s later.
      dwell.holdIfOn(key);
    }
    options.onTileSelect?.(tile.r, tile.c, input);
  }

  function pinchPick(point: Vec3): PinchPick | null {
    return arc && layout ? pickByPinch(point, layout.cells, arc.center[1]) : null;
  }

  /** pointerdown on a tile or its grip. */
  function onTilePointer(name: string): void {
    const input = pointerKind();
    if (input === 'pinch') {
      const hand = pinchingHand(pinches);
      if (hand && pinchPick(hand)?.near) {
        // A pinch on the board: onSessionSelectStart picks the tile from the pinch point.
        return;
      }
    }
    selectTile(name, input);
  }

  /** Near hand pinch: the tile under the pinch point turns. */
  function onSessionSelectStart(event: XRInputSourceEvent): void {
    if (disposed || phase !== 'ready' || !event.inputSource.hand) {
      return;
    }
    const hand = pinches.find((p) => p.handedness === event.inputSource.handedness);
    const pick = hand ? pinchPick(hand) : null;
    if (pick?.cell) {
      selectTile(tileEntityName(pick.cell.r, pick.cell.c), 'pinch');
    }
  }

  function listenSession(session: XRSession | null): void {
    if (listenedSession === session) {
      return;
    }
    listenedSession?.removeEventListener('selectstart', onSessionSelectStart);
    listenedSession = session;
    session?.addEventListener('selectstart', onSessionSelectStart);
  }

  function clearBoard(): void {
    // A look on a button survives the board change, so a gaze Restart (which
    // rebuilds the board) does not fire again every 0.8 s while the head stays
    // on the button. Seen in the emulator on 2026-11-10 (MV04): one held look
    // restarted the level three times.
    dwell.resetUnless((name) => buttons.has(name as ButtonName));
    for (const tile of tiles.values()) {
      tile.view.dispose();
      // The grip first: a child entity left alive would be re-parented to the
      // scene root by the transform system once its parent is gone.
      tile.gripEntity.dispose({ disposeResources: false });
      tile.entity.dispose({ disposeResources: false });
    }
    tiles.clear();
    if (boardBase) {
      boardRoot.remove(boardBase);
      boardBase.geometry.dispose();
      (boardBase.material as { dispose(): void }).dispose();
      boardBase = null;
    }
  }

  function placePanelForCalibration(head: HeadPose): void {
    const f = new Vector3(head.forward.x, 0, head.forward.z);
    if (f.lengthSq() < 1e-6) {
      f.set(0, 0, -1);
    }
    f.normalize();
    panel.root.position.set(
      head.position.x + f.x * CALIBRATE_PANEL_AHEAD,
      head.position.y - CALIBRATE_PANEL_DROP,
      head.position.z + f.z * CALIBRATE_PANEL_AHEAD,
    );
    panel.root.rotation.set(PANEL_TILT_RAD, (head.yawDeg * Math.PI) / 180, 0);
  }

  function placePanelOnArc(a: ReachArc, lay: BoardLayout): void {
    const d = dirFromDeg(lay.midDeg);
    const r = lay.rowRadii[0] + TILE_SIZE / 2 + PANEL_GAP;
    panel.root.position.set(
      a.center[0] + d.x * r,
      a.center[1] + PANEL_H / 2 + 0.02,
      a.center[2] + d.z * r,
    );
    panel.root.rotation.set(PANEL_TILT_RAD, (lay.midDeg * Math.PI) / 180, 0);
  }

  function startCalibration(): void {
    phase = 'calibrate';
    arc = null;
    calibrator.restart();
    trail.clear();
    clearBoard();
    lastGazeTarget = null;
    for (const name of BUTTON_NAMES) {
      setButtonVisible(name, name === 'Btn_Language' || name === 'Btn_Sound' || name === 'Btn_Voice');
    }
    if (xr) {
      probe.start(world);
      placePanelForCalibration(readHead(world));
    }
    messageParts = [['reach.title'], ['reach.sweep']];
    statusParts = [];
    render();
    logger.startSegment('calibrate');
    options.onCalibrateStart?.();
  }

  function recalibrate(): void {
    startCalibration();
    if (!xr) {
      finishWithoutXr();
    }
  }

  function finishCalibration(chosen: ReachArc): void {
    table = table && !xr ? table : xr ? probe.decide() : { height: VIRTUAL_TABLE_HEIGHT, source: 'virtual' };
    arc = { ...chosen, center: [chosen.center[0], table.height, chosen.center[2]] };
    logger.push({ type: 'table', surface: table });
    logger.push({ type: 'reach-set', arc });
    phase = 'ready';
    reticle.mesh.visible = false;
    setButtonVisible('Btn_Reach', true);
    setButtonVisible('Btn_Restart', true);
    messageParts = [
      [arc.source === 'default' ? 'reach.defaultWidth' : 'reach.done'],
      [table.source === 'virtual' ? 'table.virtual' : 'table.found'],
    ];
    render();
    options.onReachSet?.(arc, table);
  }

  function finishWithoutXr(): void {
    const head = readHead(world);
    const events = calibrator.finishDefault({
      t: performance.now(),
      hand: null,
      head: { x: head.position.x, z: head.position.z, yawDeg: head.yawDeg },
      tableY: VIRTUAL_TABLE_HEIGHT,
    });
    handleCalibrateEvents(events, head);
  }

  function handleCalibrateEvents(events: CalibrateEvent[], head: HeadPose): void {
    for (const e of events) {
      switch (e.type) {
        case 'sample':
          logger.push({ type: 'reach-sample', x: e.x, y: e.y, z: e.z, source: e.source });
          if (e.source === 'hand') {
            trail.add(e.x, e.y, e.z);
          }
          break;
        case 'rejected':
          trail.clear();
          logger.push({ type: 'error', message: `reach sweep rejected: ${e.reason}` });
          messageParts = [['reach.retry'], ['reach.sweep']];
          render();
          break;
        case 'phase':
          if (e.phase === 'gaze-left') {
            trail.clear();
            messageParts = [['reach.gazeFallback'], ['reach.gazeLeft']];
            render();
          } else if (e.phase === 'gaze-right') {
            messageParts = [['reach.gazeRight']];
            render();
          }
          break;
        case 'progress':
          reticle.mesh.visible = xr;
          reticle.setProgress(e.value);
          reticle.mesh.position.copy(head.position).addScaledVector(head.forward, RETICLE_DISTANCE);
          reticle.mesh.lookAt(head.position);
          break;
        case 'done':
          finishCalibration(e.arc);
          break;
      }
    }
  }

  function gazeCandidates(): Object3D[] {
    const out: Object3D[] = [];
    for (const tile of tiles.values()) {
      if (tile.rotatable) {
        out.push(tile.view.root);
      }
    }
    for (const b of buttons.values()) {
      if (b.visible) {
        out.push(b.view.root);
      }
    }
    return out;
  }

  function targetName(obj: Object3D | null): string | null {
    let o: Object3D | null = obj;
    while (o) {
      if (tiles.has(o.name) || buttons.has(o.name as ButtonName)) {
        return o.name;
      }
      o = o.parent;
    }
    return null;
  }

  function updateGaze(head: HeadPose, now: number): void {
    raycaster.set(head.position, head.forward);
    const hits = raycaster.intersectObjects(gazeCandidates(), true);
    const hitName = hits.length > 0 ? targetName(hits[0].object) : null;
    if (hitName && (tiles.get(hitName)?.gripHover ?? 0) > 0) {
      // A hand is on this tile: let the pinch act, not the look.
      dwell.holdIfOn(hitName);
    }
    const state = dwell.update(hitName, now, (name) => tiles.has(name));
    if (lastGazeTarget !== state.target) {
      setTargetGaze(lastGazeTarget, 0, false);
      lastGazeTarget = state.target;
    }
    // A sound while the look rests on a target fires it now, without waiting out the hold.
    const sound = mic !== null && soundGate.update(mic.level(), now);
    if (state.target) {
      setTargetGaze(state.target, state.progress, true);
      if (sound && !state.fire) {
        if (tiles.has(state.target)) {
          selectTile(state.target, 'voice');
        } else {
          pressButton(state.target as ButtonName, 'voice');
        }
      }
      if (state.fire) {
        if (tiles.has(state.target)) {
          selectTile(state.target, 'gaze');
        } else {
          pressButton(state.target as ButtonName, 'gaze');
        }
      }
    }
  }

  function setTargetGaze(name: string | null, progress: number, looking: boolean): void {
    if (!name) {
      return;
    }
    const tile = tiles.get(name);
    if (tile) {
      tile.view.setGazeProgress(progress);
      tile.view.setHover(looking || tile.pointerHover > 0);
      return;
    }
    const b = buttons.get(name as ButtonName);
    if (b) {
      b.view.setGazeProgress(progress);
      b.view.setHover(looking || b.pointerHover > 0);
    }
  }

  let lastTick = performance.now();
  let booted = false;
  function tick(dtSec: number): void {
    if (disposed) {
      return;
    }
    const now = performance.now();
    if (!booted) {
      // Outside XR, show the board on the default arc right away (2D preview).
      // Done on the first frame so callers already hold the returned layer.
      booted = true;
      if (!world.session) {
        startCalibration();
        finishWithoutXr();
      }
    }
    const inXr = !!world.session;
    listenSession(world.session ?? null);
    if (inXr !== xr) {
      xr = inXr;
      options.onXrChange?.(xr);
      if (xr) {
        startCalibration();
      } else {
        probe.stop();
        reticle.mesh.visible = false;
        if (phase === 'calibrate') {
          // Left XR mid-calibration: the 2D view still gets a board.
          finishWithoutXr();
        }
      }
    }
    const head = readHead(world);
    if (phase === 'calibrate' && xr) {
      probe.update(world, head);
      const events = calibrator.update({
        t: now,
        hand: readIndexTip(world),
        head: { x: head.position.x, z: head.position.z, yawDeg: head.yawDeg },
        tableY: VIRTUAL_TABLE_HEIGHT,
      });
      handleCalibrateEvents(events, head);
    } else if (phase === 'ready') {
      updateGaze(head, now);
    }
    pinches = xr && phase === 'ready' ? readPinchPoints(world) : [];
    for (const tile of tiles.values()) {
      tile.view.update(dtSec);
    }
    if (!xr) {
      // Outside XR there are no XRFrames; log the animation frame interval instead.
      logger.frame(now - lastTick, now);
    }
    lastTick = now;
  }

  class ReachFitLayerSystem extends createSystem({}) {
    update(delta: number): void {
      try {
        tick(delta);
      } catch (error) {
        logger.push({ type: 'error', message: `layer tick: ${String(error)}` });
        console.error('[reachfit] layer tick failed', error);
      }
    }
  }
  world.registerSystem(ReachFitLayerSystem);
  const offFrame = world.onXRFrame((_frame, delta) => logger.frame(delta * 1000));

  function showBoard(board: Board, light?: LightResult): void {
    clearBoard();
    if (!arc) {
      return;
    }
    layout = layoutBoard(arc, board.rows, board.cols);
    if (layout.pushedOut > 0) {
      console.info(`[reachfit] board moved out ${layout.pushedOut.toFixed(3)} m for a short reach`);
    }
    const inner = layout.rowRadii[layout.rowRadii.length - 1];
    const outer = layout.rowRadii[0];
    const degs = layout.cells.map((c) => c.deg);
    const padDeg = ((TILE_SIZE * 0.7) / inner) * (180 / Math.PI);
    const base = makeBoardBase(
      inner - TILE_SIZE * 0.7,
      outer + TILE_SIZE * 0.7,
      Math.min(...degs) - padDeg,
      Math.max(...degs) + padDeg,
    );
    base.position.set(arc.center[0], arc.center[1] + 0.001, arc.center[2]);
    boardRoot.add(base);
    boardBase = base;
    for (const cell of layout.cells) {
      const tile = board.tiles[cell.r * board.cols + cell.c];
      const name = tileEntityName(cell.r, cell.c);
      const view = new TileView(tile, name, cell.size);
      view.root.position.set(cell.x, cell.y + 0.002, cell.z);
      view.root.rotation.y = cell.yaw;
      const entity = world.createTransformEntity(view.root, { parent: boardEntity });
      entity.addComponent(RayInteractable);
      const grip = new Mesh(gripGeometry, gripMaterial);
      grip.name = gripEntityName(cell.r, cell.c);
      grip.position.y = GRIP_HEIGHT / 2;
      const gripEntity = world.createTransformEntity(grip, { parent: entity });
      gripEntity.addComponent(OneHandGrabbable, { translate: false, rotate: false });
      const entry: TileEntry = {
        r: cell.r,
        c: cell.c,
        rotatable: tile.rotatable,
        kind: tile.kind,
        view,
        entity,
        gripEntity,
        pointerHover: 0,
        gripHover: 0,
        lastSelect: -Infinity,
      };
      // The grab handle stops propagation at the grip, so the grip gets the
      // same listeners as the root.
      for (const target of [view.root, grip]) {
        target.addEventListener('pointerdown', () => onTilePointer(name));
        target.addEventListener('pointerenter', () => {
          entry.pointerHover++;
          view.setHover(true);
        });
        target.addEventListener('pointerleave', () => {
          entry.pointerHover = Math.max(0, entry.pointerHover - 1);
          view.setHover(entry.pointerHover > 0 || lastGazeTarget === name);
        });
      }
      grip.addEventListener('pointerenter', () => {
        entry.gripHover++;
      });
      grip.addEventListener('pointerleave', () => {
        entry.gripHover = Math.max(0, entry.gripHover - 1);
      });
      tiles.set(name, entry);
    }
    placePanelOnArc(arc, layout);
    if (light) {
      updateBoard(board, light);
    }
  }

  function updateBoard(board: Board, light: LightResult): void {
    board.tiles.forEach((tile, i) => {
      const entry = tiles.get(tileEntityName(tile.r, tile.c));
      if (!entry) {
        return;
      }
      entry.rotatable = tile.rotatable;
      entry.view.setRotation(tile.rot, true);
      entry.view.setLit(light.lit[i] ?? false, tile.kind);
    });
  }

  function worldPos(obj: Object3D): { x: number; y: number; z: number } {
    obj.updateWorldMatrix(true, false);
    const v = obj.getWorldPosition(new Vector3());
    return { x: v.x, y: v.y, z: v.z };
  }

  render();

  return {
    phase: () => phase,
    calibratePhase: () => calibrator.phase,
    inXr: () => xr,
    reach: () => arc,
    table: () => table,
    inputs: () => {
      const list: InputKind[] = ['pinch', 'gaze'];
      if (voice === 'on') {
        list.push('voice');
      }
      if (controllersPresent(world) || !world.session) {
        list.push('controller');
      }
      return list;
    },
    showBoard,
    updateBoard,
    hideBoard: clearBoard,
    setMessage: (...parts) => {
      messageParts = parts;
      render();
    },
    setStatus: (...parts) => {
      statusParts = parts;
      render();
    },
    setButtonVisible,
    setSoundOn: (on) => {
      soundOn = on;
      render();
    },
    recalibrate,
    tilePosition: (r, c) => {
      const entry = tiles.get(tileEntityName(r, c));
      return entry ? worldPos(entry.view.root) : null;
    },
    buttonPosition: (name) => {
      const b = buttons.get(name);
      return b && b.visible ? worldPos(b.view.root) : null;
    },
    targets: () => [...tiles.keys()],
    dispose: () => {
      disposed = true;
      mic?.stop();
      mic = null;
      listenSession(null);
      offLocale();
      offFrame();
      probe.stop();
      clearBoard();
      gripGeometry.dispose();
      gripMaterial.dispose();
      panel.dispose();
      for (const b of buttons.values()) {
        b.view.dispose();
      }
    },
  };
}
