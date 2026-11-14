#!/usr/bin/env node
// Level loop of the autorun. autorun.sh starts the dev session, enters XR,
// sets the input mode and (pinch) runs the reach sweep, then calls this.
//
//   node run.mjs --mode pinch|gaze --levels N --locale en --daily 1
//                --started ISO --disconnected JSON --out FILE
//
// It talks to the page only through the IWSDK CLI: xr look-at / run-sequence
// to act, browser logs to read the app's [reachfit:*] console bridge lines.
// Each turn is planned from the latest state line (remaining solution), so a
// missed or extra turn is corrected on the next step. When the page reloads
// under the run (a watched file in app/ changed), it keeps the old page's log,
// enters XR again and goes on from the saved level (at most MAX_RELOADS times).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bridgePayloads,
  cliFailed,
  countErrors,
  findLogEntries,
  gazeEdgeTargets,
  latestPayload,
  levelRows,
  mergeLog,
  parseCliOutput,
} from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const CLI_JS = join(APP, 'node_modules/@iwsdk/cli/bin/iwsdk.js');

// Design values for the script, not measurements.
const STATE_POLL_MS = 700;
const LEVEL_WAIT_MS = 15000;
const PLACE_WAIT_MS = 60000;
const RUN_SEQUENCE_TIMEOUT_MS = 45000;
/** Extra turns allowed per level beyond the fewest, before giving up on it. */
const SPARE_TURNS = 8;
/**
 * Gaze: how long a look stays past the dwell fire, ms. With the 0.8 s dwell a
 * look is 1.0 s (MV08 spec). A look that ends too early only costs one more
 * look (the next step reads the state again); one that runs into the repeat
 * turns the tile twice. The middle of the window (1.4 s) did that once in
 * the run of 2026-11-11 20:02: the look-away call took 924 ms instead of
 * about 140 ms, and L05 took 7 turns for 5.
 */
const GAZE_HOLD_PAST_FIRE_MS = 200;
/** Gaze: share of a CLI call's wall time before its effect lands (rough, for timing). */
const CLI_EFFECT_SHARE = 0.8;

function parseArgs(argv) {
  const out = { mode: '', levels: 12, locale: '', daily: 1, started: '', disconnected: '[]', out: '', shot: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    out[key] = argv[i + 1];
  }
  out.levels = Math.max(1, Math.min(12, Number(out.levels) || 12));
  out.daily = String(out.daily) === '1';
  return out;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.mode !== 'pinch' && opts.mode !== 'gaze') {
  console.error('run.mjs: --mode pinch|gaze is required');
  process.exit(64);
}

const calls = [];
const DEBUG_DIR = process.env.AUTORUN_DEBUG_DIR || '';
if (DEBUG_DIR) {
  mkdirSync(DEBUG_DIR, { recursive: true });
}
const notes = [];

function say(text) {
  console.log(`[autorun] ${text}`);
}

function sleep(ms) {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
  }
}

/** One CLI call. Returns the parsed JSON result (or null). */
function cli(path, input, extra = [], timeoutMs = 60000) {
  const args = [CLI_JS, ...path];
  if (input !== undefined) {
    args.push('--input-json', JSON.stringify(input));
  }
  args.push(...extra);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, {
    cwd: APP,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const out = parseCliOutput(r.stdout);
  const ok = r.status === 0 && !cliFailed(out);
  calls.push({ cmd: path.join(' '), ms, ok });
  if (DEBUG_DIR) {
    // Raw CLI traffic for debugging a run (AUTORUN_DEBUG_DIR). Not part of the result.
    const name = String(calls.length).padStart(4, '0') + '-' + path.join('-');
    writeFileSync(join(DEBUG_DIR, name + '.json'), JSON.stringify({ args: args.slice(1), ms, status: r.status, out }, null, 1));
  }
  if (!ok) {
    say(`cli ${path.join(' ')} failed (status ${r.status}): ${JSON.stringify(out?.error ?? null)} ${(r.stderr || '').slice(-300)}`);
  }
  return out;
}

function logEntries(input) {
  return findLogEntries(cli(['browser', 'logs'], input));
}

function latest(kind, count = 5) {
  return latestPayload(bridgePayloads(logEntries({ pattern: `\\[reachfit:${kind}\\]`, count }), kind));
}

function waitState(pred, timeoutMs, label) {
  const end = Date.now() + timeoutMs;
  let st = null;
  while (Date.now() < end) {
    st = latest('state');
    if (st && pred(st)) {
      return st;
    }
    sleep(STATE_POLL_MS);
  }
  say(`timed out waiting for ${label}`);
  return st;
}

/** Waits for a level line newer than `before` (a later seq, or a new page load). */
function waitLevel(before, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const lvl = latest('level');
    if (lvl && (!before || lvl.page !== before.page || lvl.seq > before.seq)) {
      return lvl;
    }
    sleep(STATE_POLL_MS);
  }
  return null;
}

/** Mean wall time of the look-at calls so far, ms (first guess 600 before any). */
function lookLatency() {
  const looks = calls.filter((c) => c.cmd === 'xr look-at' && c.ok);
  if (looks.length === 0) {
    return 600;
  }
  return looks.reduce((a, c) => a + c.ms, 0) / looks.length;
}

function lookAt(target) {
  return cli(['xr', 'look-at'], { device: 'headset', target });
}

/** A point well above the board, so the head ray hits no tile and no button. */
function neutral(st) {
  const h = st?.head ?? { x: 0, y: 1.5, z: 0 };
  return { x: h.x, y: h.y + 1.5, z: h.z - 1.0 };
}

// Acting --------------------------------------------------------------------

let dwellMs = 800;
let repeatMs = 1200;

function gazeHold(target, st, fires) {
  // Look, stay through `fires` dwell fires, then look away well before the next one.
  const want = dwellMs + (fires - 1) * repeatMs + Math.min(GAZE_HOLD_PAST_FIRE_MS, repeatMs / 2);
  lookAt(target);
  sleep(want - CLI_EFFECT_SHARE * lookLatency());
  lookAt(neutral(st));
}

/** Pinch: height of the grasp point over the tile center, m. Inside the app's near-pinch window (src/xr/pinch.ts). */
const PINCH_LIFT = 0.02;

function pinchTile(step) {
  // Open hand comes straight down over the tile, fingers pointing down, and
  // pinches in place. Pinching while still moving selected a neighbour, and
  // an open hand with the fingers forward poked a panel button (MV08 runs).
  // The grasp point goes on the tile center the app reports (solution
  // position), not on the CLI target: with `target` the CLI put the grasp on
  // the near side of the tile's box, 3.4 cm toward the body for Tile_1_4 of
  // L05, and the app's pinch point pick (nearest center) took Tile_1_3 every
  // time (MV08 run 2026-11-11 07:49).
  const first = step.position
    ? {
        position: { x: step.position.x, y: step.position.y + PINCH_LIFT, z: step.position.z },
        anchor: 'grasp',
        orientation: { fingers: 'down', palm: 'left' },
        approach: { distance: 0.06 },
      }
    : { target: step.target, anchor: 'grasp', orientation: { fingers: 'down', palm: 'left' }, approach: { distance: 0.06 } };
  return cli(
    ['xr', 'run-sequence'],
    {
      device: 'hand-right',
      gaze: 'fixed',
      steps: [first, { pinch: 1, duration: 0.2 }, { pinch: 0, duration: 0.15 }, { depart: { distance: 0.08 } }],
    },
    ['--timeout', String(RUN_SEQUENCE_TIMEOUT_MS)],
    RUN_SEQUENCE_TIMEOUT_MS + 15000,
  );
}

function pressButton(name, st) {
  if (opts.mode === 'pinch') {
    return cli(
      ['xr', 'run-sequence'],
      { device: 'hand-right', gaze: 'fixed', steps: [{ target: name, press: {} }] },
      ['--timeout', String(RUN_SEQUENCE_TIMEOUT_MS)],
      RUN_SEQUENCE_TIMEOUT_MS + 15000,
    );
  }
  const at = st?.buttons?.[name];
  if (!at) {
    say(`no position for ${name}`);
    return null;
  }
  gazeHold(at, st, 1);
  return true;
}

function turnOnce(step, st) {
  if (opts.mode === 'pinch') {
    pinchTile(step);
  } else if (step.position) {
    gazeHold(step.position, st, 1);
  } else {
    say(`no position for ${step.target}`);
  }
}

// Run -----------------------------------------------------------------------

const startedAt = opts.started || new Date().toISOString();
let disconnected = [];
try {
  disconnected = JSON.parse(opts.disconnected);
} catch {
  disconnected = [];
}
const gazeCal = JSON.parse(readFileSync(join(HERE, 'sequences/gaze-calibrate.json'), 'utf8'));
const sweep = JSON.parse(readFileSync(join(HERE, 'sequences/sweep-right.json'), 'utf8'));

/** Page reloads the run sets up again after, before it gives up. Design value. */
const MAX_RELOADS = 2;
/** Page id (src/game/game.ts pageId) the run is driving. */
let page = null;
let reloads = 0;
let lastLevelId = null;
/** Play log of pages that reloaded away, from their last complete dump. */
const keptEvents = [];
const keptFrames = [];

function placedInXr(s) {
  return s.xr && s.phase !== 'calibrate' && s.phase !== 'boot';
}

function gazeCalibrate() {
  // Hands and controllers are off: after the hand wait the layer asks for the two edges.
  let s = waitState((x) => x.calibratePhase === 'gaze-left' || placedInXr(x), gazeCal.waitForGazeS * 1000, 'gaze-left');
  if (s?.calibratePhase === 'gaze-left') {
    // Both edges are angles from the head yaw when gaze-left began: the
    // calibrator measures both turns from that yaw (src/xr/calibrate.ts yaw0).
    // Taking the right edge from the turned head would land near 0 deg.
    for (const { phase, target } of gazeEdgeTargets(s.head, gazeCal)) {
      lookAt(target);
      sleep(gazeCal.holdS * 1000);
      s = waitState((x) => x.calibratePhase !== phase, 5000, `${phase} hold`);
    }
  }
  return s;
}

/** After `xr enter` and the input setup: calibrate (gaze) and wait for the board in XR. */
function placeBoard() {
  const s0 = latest('state');
  if (s0) {
    lookAt(neutral(s0));
  }
  if (opts.mode === 'gaze') {
    gazeCalibrate();
  }
  const s = waitState(placedInXr, PLACE_WAIT_MS, 'board placed in XR');
  lookAt(neutral(s));
  return s;
}

/** What autorun.sh does after `dev up`, again, for a page that reloaded. No start over: the page resumes at its saved level. */
function setupAgain() {
  cli(['xr', 'enter'], {});
  if (opts.mode === 'pinch') {
    cli(['xr', 'set-input-mode'], { mode: 'hand' });
    cli(['xr', 'run-sequence'], sweep, ['--timeout', String(RUN_SEQUENCE_TIMEOUT_MS)], RUN_SEQUENCE_TIMEOUT_MS + 15000);
  } else {
    for (const device of disconnected) {
      cli(['xr', 'set-connected'], { device, connected: false });
    }
  }
}

/**
 * The page reloaded under the run (Vite reloads it when a watched file in
 * app/ changes, for example another task editing src/i18n): keep the old
 * page's last log dump, enter XR again and go on from the level the page
 * resumed at (progress is saved at every solve). Null after MAX_RELOADS.
 */
function recover(s) {
  reloads++;
  notes.push(`page reloaded (${reloads}) during ${lastLevelId ?? 'setup'}: a watched file under app/ changed`);
  say(`page reloaded (${reloads}) during ${lastLevelId ?? 'setup'}`);
  const old = mergeLog(bridgePayloads(logEntries({ pattern: '\\[reachfit:log\\]', count: 200 }), 'log'), page);
  if (old) {
    keptEvents.push(...old.events);
    keptFrames.push(...old.frameSummaries);
  } else {
    notes.push(`no log dump kept from page ${page}`);
  }
  if (reloads > MAX_RELOADS) {
    notes.push(`gave up after ${MAX_RELOADS} reloads`);
    return null;
  }
  page = s.page;
  waitState((x) => x.page === page && !!x.levelId, PLACE_WAIT_MS, 'reloaded page');
  setupAgain();
  const placed = placeBoard();
  if (!placed || !placedInXr(placed)) {
    notes.push('board was not placed in XR after the reload');
    return null;
  }
  page = placed.page ?? page;
  return placed;
}

/** Newest state line, recovering first when it comes from a new page load. */
function current() {
  const s = latest('state');
  if (!s || page === null || typeof s.page !== 'number' || s.page === page) {
    return s;
  }
  return recover(s);
}

let st = placeBoard();
if (!st || !st.xr) {
  notes.push('board was not placed in XR');
}
page = typeof st?.page === 'number' ? st.page : null;
const reach = st?.reach ?? null;
const table = st?.table ?? null;
say(`board placed: reach ${reach?.source} r=${reach?.radius}, table ${table?.source}`);

if (st && st.levelId && st.levelId !== 'L01') {
  // autorun.sh already started over before entering XR; this is the second
  // chance, with the board on show (the page button works in XR too).
  notes.push(`board opened at ${st.levelId}, pressed start over in XR`);
  cli(['browser', 'interact'], { steps: [{ action: 'click', locator: { testId: 'rf-start-over' } }] });
  st = waitState((s) => s.levelId === 'L01' && s.rotations === 0, LEVEL_WAIT_MS, 'L01 after start over') ?? st;
}

const lvl = latest('level');
if (lvl) {
  dwellMs = lvl.dwellMs ?? dwellMs;
  repeatMs = lvl.repeatMs ?? repeatMs;
}

if (opts.locale && st && st.locale !== opts.locale) {
  for (let i = 0; i < 10 && st.locale !== opts.locale; i++) {
    pressButton('Btn_Language', st);
    st = latest('state') ?? st;
  }
  if (st.locale !== opts.locale) {
    notes.push(`locale ${opts.locale} not reached (now ${st.locale})`);
  }
}

const plan = opts.levels + (opts.levels === 12 && opts.daily ? 1 : 0);
const attempted = [];
let lastPosition = null;
let aborted = false;
for (let n = 0; n < plan && !aborted; n++) {
  st = current();
  if (!st || !st.levelId) {
    notes.push(`no level on show before level ${n + 1}`);
    break;
  }
  const levelId = st.levelId;
  lastLevelId = levelId;
  const budget = (st.minRotations ?? 10) + SPARE_TURNS;
  let turns = 0;
  let actions = 0;
  let movedOn = false;
  while (!st.solved && turns < budget) {
    const step = (st.remaining ?? [])[0];
    if (!step) {
      break;
    }
    turnOnce(step, st);
    lastPosition = step.position ?? lastPosition;
    turns++;
    actions++;
    const pageBefore = page;
    const next = current();
    if (!next) {
      aborted = true;
      break;
    }
    st = next;
    if (page !== pageBefore) {
      if (st.levelId !== levelId) {
        // Solved and saved before the reload; the page resumed at the next one.
        movedOn = true;
        break;
      }
      // The same level again from its start: fresh budget.
      turns = 0;
    }
  }
  const solvedSeen = movedOn || !!st?.solved;
  attempted.push({ levelId, solvedSeen, actions });
  if (aborted) {
    say(`${levelId}: stopped (page reloads)`);
    break;
  }
  if (opts.shot && n === 0 && st.solved && lastPosition) {
    // One look at the first solved board, to check the look of a run. Turns are
    // off once a level is solved, so the look cannot add one. Not a deliverable.
    lookAt(lastPosition);
    sleep(400);
    cli(['browser', 'screenshot'], {}, ['--output-file', opts.shot]);
    lookAt(neutral(st));
  }
  say(`${levelId}: solved=${solvedSeen} after ${actions} actions${movedOn ? ' (seen after a reload)' : ''}`);
  if (movedOn) {
    continue;
  }
  if (n === plan - 1 || st.phase !== 'level-done') {
    break;
  }
  const before = latest('level');
  let opened = null;
  for (let tries = 0; tries < 2 && !opened; tries++) {
    pressButton('Btn_Next', latest('state') ?? st);
    opened = waitLevel(before, LEVEL_WAIT_MS);
  }
  if (!opened) {
    notes.push(`Btn_Next did not open a new level after ${levelId}`);
    break;
  }
  lookAt(neutral(st));
}

// Leaving XR makes the app print its whole log.
cli(['xr', 'exit'], {});
sleep(1500);
let merged = null;
for (let tries = 0; tries < 3 && !merged; tries++) {
  merged = mergeLog(bridgePayloads(logEntries({ pattern: '\\[reachfit:log\\]', count: 200 }), 'log'), page ?? undefined);
  if (!merged) {
    sleep(1500);
  }
}
if (!merged) {
  notes.push('no complete [reachfit:log] dump found');
}
// Pages that reloaded away come first, then the page the run ended on.
const appLog = [...keptEvents, ...(merged?.events ?? [])];
const frameSummaries = [...keptFrames, ...(merged?.frameSummaries ?? [])];
const errorEntries = logEntries({ level: 'error', count: 200 });
const consoleErrors = countErrors(errorEntries);

const rows = levelRows(appLog);
const levels = attempted.map((a) => {
  const row = [...rows].reverse().find((r) => r.levelId === a.levelId);
  // No level-end in the kept log (a dump lost to a reload, or not solved): the
  // state line is the only source, and the row says so.
  return row
    ? { ...row, actions: a.actions }
    : { levelId: a.levelId, solved: a.solvedSeen, actions: a.actions, fromAppLog: false };
});
const cliMs = calls.map((c) => c.ms);
const result = {
  mode: opts.mode,
  startedAt,
  finishedAt: new Date().toISOString(),
  device: {
    inputMode: opts.mode === 'pinch' ? 'hand' : 'head gaze only',
    disconnected,
  },
  reach,
  table,
  levels,
  solvedCount: levels.filter((l) => l.solved).length,
  attempted: levels.length,
  consoleErrors,
  consoleErrorSamples: errorEntries.slice(-5).map((e) => String(e.message).slice(0, 300)),
  cli: {
    calls: calls.length,
    failed: calls.filter((c) => !c.ok).length,
    meanMs: cliMs.length ? Math.round(cliMs.reduce((a, b) => a + b, 0) / cliMs.length) : 0,
    maxMs: cliMs.length ? Math.max(...cliMs) : 0,
  },
  pageReloads: reloads,
  notes,
  appLog,
  frameSummariesNote: 'Frame times of the emulator in a headless browser on a Mac. Not Quest performance.',
  frameSummaries,
};
mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, `${JSON.stringify(result, null, 1)}\n`);
say(`wrote ${opts.out}: solved ${result.solvedCount}/${result.attempted}, console errors ${consoleErrors}`);
process.exit(result.solvedCount === result.attempted && result.attempted === plan ? 0 : 2);
