#!/usr/bin/env node
// Pictures of Reach Fit in the IWSDK emulator (MV09): one per UI language and
// candidates for the submission images. shots.sh starts the dev session (with
// browser automation on) and starts over at L01, then calls this.
//
//   node shots-run.mjs --out-dir DIR [--burst-dir DIR] [--manifest FILE] [--level N]
//
// Steps: seat the head, hand sweep (board placed), picture A (board on the
// arc, hand at the arc end), hands and controllers off, one picture per
// language at the panel, then the levels up to --level played by head gaze.
// The last turn of that level is shot as a burst (gaze ring filling, then the
// light connecting); picture C is the solved board.
//
// Picture size: shots.sh starts the session in agent mode with a 1920x1080
// screenshot size, which is the page viewport there. Without agent mode the
// app frame is 756x469, and a viewport set from a script did not reach the XR
// canvas (run of 2026-11-11 20:44: back to 756x469 by the first picture).
//
// Files: DIR/i18n/<code>.png, DIR/submission/<name>.png (B is b1-gaze-ring.jpg,
// the last burst frame before the turn), burst frames (JPEG) in
// --burst-dir (default DIR/submission/burst). The manifest lists poses, states,
// canvas sizes and console errors.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgePayloads, cliFailed, countErrors, findLogEntries, latestPayload, parseCliOutput } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const CLI_JS = join(APP, 'node_modules/@iwsdk/cli/bin/iwsdk.js');
const PAGE_SCRIPT = 'tools/autorun/shots-page.mjs';
const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'vi'];

// Design values for the pictures, not measurements.
const VIEW = { w: 1920, h: 1080 };
const STATE_POLL_MS = 700;

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
}
/**
 * Head before the sweep: seated at the desk of the home_office room. The
 * sweep is body-relative, so the arc center lands at about this z. The desk
 * top spans z -2.38 to -1.68 (room z0 -2.4, desk 0.7 deep, 2 cm off the back
 * wall: @iwsdk/vite-plugin-dev home_office chunk). At -1.35 the near rows hung off
 * the front edge (run of 2026-11-11 21:14); at -1.5 the board lies on the desk
 * (21:18). --seat-z moves the board
 * on or off its front edge.
 */
const SEAT = { x: 0, y: 1.2, z: Number(arg('seat-z', -1.5)) };
const OUT_DIR = resolve(arg('out-dir', join(APP, 'artifacts')));
const I18N_DIR = join(OUT_DIR, 'i18n');
const SUB_DIR = join(OUT_DIR, 'submission');
const BURST_DIR = resolve(arg('burst-dir', join(SUB_DIR, 'burst')));
const MANIFEST = arg('manifest', '');
const SHOT_LEVEL = Math.max(1, Math.min(12, Number(arg('level', 5)) || 5));
for (const d of [I18N_DIR, SUB_DIR, BURST_DIR]) {
  mkdirSync(d, { recursive: true });
}

const calls = [];
const manifest = { startedAt: new Date().toISOString(), view: VIEW, seat: SEAT, steps: [], notes: [] };
const say = (t) => console.log(`[shots] ${t}`);
const sleep = (ms) => ms > 0 && Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));

function cli(path, input, extra = [], timeoutMs = 60000, env = undefined) {
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
    env: env ? { ...process.env, ...env } : process.env,
  });
  const out = parseCliOutput(r.stdout);
  const ok = r.status === 0 && !cliFailed(out);
  calls.push({ cmd: path.join(' '), ms: Date.now() - t0, ok });
  if (!ok) {
    say(`cli ${path.join(' ')} failed (status ${r.status}): ${JSON.stringify(out?.error ?? null)} ${(r.stderr || '').slice(-300)}`);
  }
  return out;
}

/**
 * One `browser run` of shots-page.mjs. Returns its result object (or null).
 * The CLI refuses a --timeout above 110000 ms ('Managed browser scripts are
 * limited to 110000ms per lease', run of 2026-11-11 20:41).
 */
function pageRun(env, label) {
  const out = cli(['browser', 'run', PAGE_SCRIPT], undefined, ['--timeout', '100000'], 130000, env);
  const result = out?.data?.result ?? null;
  manifest.steps.push({ label, action: env.SHOTS_ACTION, ok: !!result && !result.error, result });
  return result;
}

const latest = (kind) =>
  latestPayload(bridgePayloads(findLogEntries(cli(['browser', 'logs'], { pattern: `\\[reachfit:${kind}\\]`, count: 5 })), kind));

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
  manifest.notes.push(`timed out waiting for ${label}`);
  return st;
}

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

const lookAt = (target) => cli(['xr', 'look-at'], { device: 'headset', target });
const placeHead = (position) => cli(['xr', 'set-transform'], { device: 'headset', position });
function pose(position, target, label) {
  placeHead(position);
  lookAt(target);
  manifest.steps.push({ label, pose: { position, target } });
}
const neutral = (h) => ({ x: h.x, y: h.y + 1.5, z: h.z - 1.0 });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });

/** Middle of the tiles still to turn plus the solution, as a look target: board middle. */
function boardMiddle(lvl, st) {
  const pts = [...(lvl?.solution ?? []), ...(st?.remaining ?? [])].map((s) => s.position).filter(Boolean);
  const c = st.reach.center;
  if (!pts.length) {
    return { x: c[0], y: c[1], z: c[2] - st.reach.radius };
  }
  const m = pts.reduce((a, p) => add(a, p), { x: 0, y: 0, z: 0 });
  return { x: m.x / pts.length, y: m.y / pts.length, z: m.z / pts.length };
}

function panelMiddle(st) {
  const pts = Object.values(st.buttons ?? {}).filter(Boolean);
  const m = pts.reduce((a, p) => add(a, p), { x: 0, y: 0, z: 0 });
  return { x: m.x / pts.length, y: m.y / pts.length, z: m.z / pts.length };
}

// Gaze play, as run.mjs: look through one dwell fire, then away.
let dwellMs = 800;
let repeatMs = 1200;
function lookLatency() {
  const looks = calls.filter((c) => c.cmd === 'xr look-at' && c.ok);
  return looks.length ? looks.reduce((a, c) => a + c.ms, 0) / looks.length : 600;
}
function gazeHold(target, st) {
  lookAt(target);
  sleep(dwellMs + Math.min(200, repeatMs / 2) - 0.8 * lookLatency());
  lookAt(neutral(st.head));
}
const turnsLeft = (st) => (st.remaining ?? []).reduce((a, s) => a + (s.turns ?? 1), 0);

// Run ------------------------------------------------------------------------

const vp = pageRun({ SHOTS_ACTION: 'sizes' }, 'sizes before xr enter');
say(`page ${JSON.stringify(vp?.sizes ?? null)}`);
cli(['xr', 'enter'], {});
cli(['xr', 'set-transform'], { device: 'headset', position: SEAT, orientation: { pitch: -30, yaw: 0, roll: 0 } });
cli(['xr', 'set-input-mode'], { mode: 'hand' });
cli(['xr', 'run-sequence'], JSON.parse(readFileSync(join(HERE, 'sequences/sweep-right.json'), 'utf8')), ['--timeout', '45000'], 60000);
let st = waitState((s) => s.xr && s.phase === 'play' && s.calibratePhase === 'done', 60000, 'board placed');
let lvl = latest('level');
dwellMs = lvl?.dwellMs ?? dwellMs;
repeatMs = lvl?.repeatMs ?? repeatMs;
manifest.reach = st?.reach ?? null;
manifest.table = st?.table ?? null;
say(`board placed: ${st?.levelId} reach ${st?.reach?.source} r=${st?.reach?.radius}`);

const files = { i18n: [], submission: [] };
const shot = (name, keepPage, label) => {
  const out = join(SUB_DIR, `${name}.png`);
  const r = pageRun({ SHOTS_ACTION: 'shot', SHOTS_OUT: out, SHOTS_PAGE: keepPage ? '1' : '0' }, label);
  if (r?.out) {
    files.submission.push(out);
  }
  return r;
};

// Geometry from the placed board: C the arc center (under the player), d the
// unit direction from C to the board middle on the table.
const mid = boardMiddle(lvl, st);
const center = { x: st.reach.center[0], y: st.reach.center[1], z: st.reach.center[2] };
const towardBoard = (() => {
  const d = { x: mid.x - center.x, z: mid.z - center.z };
  const l = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / l, y: 0, z: d.z / l };
})();
const up = (k) => ({ x: 0, y: k, z: 0 });
const along = (k) => ({ x: towardBoard.x * k, y: 0, z: towardBoard.z * k });
const at = (r, h) => add(add(center, along(r)), up(h));
manifest.geometry = { center, mid, towardBoard };

// A: board on the arc right after the sweep, the right hand back at the arc end.
// Before a level is solved a look that rests on a tile or a button turns or
// presses it (gaze is always on; only turnable tiles and buttons take a look),
// so this look aims at the table just inside the board, and the board and
// panel sit in the upper half of the picture.
// Tile positions from the CLI target list. In L01 rows 0 and 2 are empty
// tiles (src/puzzle/levels.ts tutorialBoard), which take no look, so a look at
// the middle of row 0 frames the board without turning anything.
const vec = (p) => (Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p);
const fetchTargets = () => (cli(['xr', 'list-targets'], {})?.data?.result?.targets ?? []).filter((t) => t.position);
let targets = fetchTargets();
const tilePos = (name) => {
  const t = targets.find((x) => x.name === name);
  return t ? vec(t.position) : null;
};
const mean = (ps) => {
  const s = ps.reduce((a, p) => add(a, p), { x: 0, y: 0, z: 0 });
  return { x: s.x / ps.length, y: s.y / ps.length, z: s.z / ps.length };
};
const tileCenter = () => {
  const ps = targets.filter((t) => /^Tile_\d+_\d+$/.test(t.name)).map((t) => vec(t.position));
  return ps.length ? mean(ps) : null;
};
const boardCenterA = tileCenter() ?? mid;
const rowZero = [tilePos('Tile_0_1'), tilePos('Tile_0_2')].filter(Boolean);
const lookA = rowZero.length === 2 && st.levelId === 'L01' ? mean(rowZero) : at(0.22, 0.002);
manifest.geometry.boardCenterA = boardCenterA;
manifest.geometry.lookA = lookA;
manifest.geometry.targetCount = targets.length;

// The right hand back at the right end of the arc, where the sweep ended; the
// idle left hand off.
const arcEnd = (() => {
  const a = ((st.reach.startDeg + 4) * Math.PI) / 180;
  // Yaw convention as src/xr/arc.ts: 0 looks down -Z, positive turns left.
  return { x: center.x - Math.sin(a) * st.reach.radius, y: center.y + 0.03, z: center.z - Math.cos(a) * st.reach.radius };
})();
cli(['xr', 'set-connected'], { device: 'hand-left', connected: false });
cli(
  ['xr', 'run-sequence'],
  { device: 'hand-right', gaze: 'fixed', steps: [{ position: arcEnd, anchor: 'index-tip', duration: 0.6 }] },
  ['--timeout', '45000'],
  60000,
);
const rA = Math.hypot(boardCenterA.x - center.x, boardCenterA.z - center.z);
pose(at(rA - 0.3, 0.36), lookA, 'A1 close');
shot('a1-arc-placed', false, 'A1 board on the arc, hand at the arc end');
pose(at(rA - 0.45, 0.46), lookA, 'A2 wider');
shot('a2-arc-placed-wide', false, 'A2 board on the arc, wider');

// Head gaze only from here: hands and controllers off (also keeps the hands
// out of the language pictures).
for (const device of ['hand-left', 'hand-right', 'controller-left', 'controller-right']) {
  cli(['xr', 'set-connected'], { device, connected: false });
}

// One picture per language, head in front of the panel, the look on the panel
// text above the button row (a look on a button would press it).
const panel = panelMiddle(st);
const toUser = { x: center.x - panel.x, y: 0, z: center.z - panel.z };
const len = Math.hypot(toUser.x, toUser.z) || 1;
const headI18n = add(add(panel, { x: toUser.x / len, y: 0, z: toUser.z / len }, 0.36), up(0.14));
pose(headI18n, add(panel, up(0.065)), 'i18n');
const i18n = pageRun(
  { SHOTS_ACTION: 'i18n', SHOTS_DIR: I18N_DIR, SHOTS_LOCALES: LOCALES.join(','), SHOTS_PAGE: '1', SHOTS_FINAL_LOCALE: 'en' },
  'i18n',
);
for (const s of i18n?.shots ?? []) {
  files.i18n.push(s.out);
  say(`i18n ${s.code}: setLocale ${s.setLocale}, state ${s.stateLocale}`);
}

// Gaze play from a head over the arc center.
const PLAY_HEAD = at(0.05, 0.42);
pose(PLAY_HEAD, neutral(PLAY_HEAD), 'gaze play head');
st = latest('state') ?? st;
manifest.steps.push({ label: 'before gaze play', state: { levelId: st.levelId, rotations: st.rotations, solved: st.solved, locale: st.locale } });

let burst = null;
for (let n = 0; n < SHOT_LEVEL; n++) {
  st = latest('state') ?? st;
  const levelId = st.levelId;
  const isShotLevel = n === SHOT_LEVEL - 1;
  let guard = (st.minRotations ?? 10) + 8;
  while (!st.solved && guard-- > 0) {
    const step = (st.remaining ?? [])[0];
    if (!step?.position) {
      break;
    }
    if (isShotLevel && turnsLeft(st) === 1) {
      // Last turn of the level: burst while the ring fills and the light
      // connects, from a head closer to that tile (the look stays up and away
      // while the head moves).
      const rT = Math.hypot(step.position.x - center.x, step.position.z - center.z);
      const headB = at(Math.max(0, rT - 0.2), 0.3);
      placeHead(headB);
      lookAt(neutral(headB));
      manifest.steps.push({ label: 'B head', pose: { position: headB, target: step.position } });
      st = latest('state') ?? st;
      burst = pageRun(
        {
          SHOTS_ACTION: 'burst',
          SHOTS_DIR: BURST_DIR,
          SHOTS_CLI: CLI_JS,
          SHOTS_LOOK: JSON.stringify(step.position),
          SHOTS_AWAY: JSON.stringify(neutral(headB)),
          BURST_N: '18',
          BURST_EVERY_MS: '80',
          BURST_LOOK_FRAME: '1',
          BURST_AWAY_MS: String(dwellMs + 200),
        },
        `burst ${levelId}`,
      );
      if (!burst) {
        gazeHold(step.position, st);
      } else {
        // B: the last frame before the turn lands, the ring at its fullest.
        const ring = (burst.frames ?? []).filter((f) => f.i > 1 && !f.solved).pop();
        if (ring) {
          const out = join(SUB_DIR, 'b1-gaze-ring.jpg');
          copyFileSync(ring.out, out);
          files.submission.push(out);
          manifest.steps.push({ label: 'B picked', frame: ring });
        } else {
          manifest.notes.push('no burst frame between the look and the turn');
        }
      }
    } else {
      gazeHold(step.position, st);
    }
    sleep(300);
    st = latest('state') ?? st;
  }
  say(`${levelId}: solved=${st.solved} rotations ${st.rotations}/${st.minRotations}`);
  manifest.steps.push({ label: `gaze ${levelId}`, solved: st.solved, rotations: st.rotations, minRotations: st.minRotations });
  if (!st.solved) {
    manifest.notes.push(`${levelId} not solved by gaze`);
    break;
  }
  if (isShotLevel) {
    break;
  }
  const before = latest('level');
  let opened = null;
  for (let tries = 0; tries < 2 && !opened; tries++) {
    const s = latest('state') ?? st;
    if (s.buttons?.Btn_Next) {
      gazeHold(s.buttons.Btn_Next, s);
    }
    opened = waitLevel(before, 15000);
  }
  if (!opened) {
    manifest.notes.push(`Btn_Next did not open a level after ${levelId}`);
    break;
  }
  lvl = opened;
  sleep(500);
  st = latest('state') ?? st;
  lookAt(neutral(st.head));
}

// C: the solved board, light connected, close and wider.
st = latest('state') ?? st;
lvl = latest('level') ?? lvl;
targets = fetchTargets();
const midC = tileCenter() ?? boardMiddle(lvl, st);
// Turns are off once a level is solved, so these looks may rest on the board.
const rM = Math.hypot(midC.x - center.x, midC.z - center.z);
pose(at(rM - 0.26, 0.32), at(rM + 0.06, 0.03), 'C1 close');
shot('c1-light-connected', false, 'C1 solved board, light connected, close');
pose(at(rM - 0.42, 0.42), at(rM + 0.04, 0.02), 'C2 wider');
shot('c2-light-connected-wide', false, 'C2 solved board, light connected, wider');
manifest.finalState = st;

cli(['xr', 'exit'], {});
sleep(1000);
const errorEntries = findLogEntries(cli(['browser', 'logs'], { level: 'error', count: 200 }));
manifest.consoleErrors = countErrors(errorEntries);
manifest.consoleErrorSamples = errorEntries.slice(-5).map((e) => String(e.message).slice(0, 300));
manifest.burst = burst;
manifest.files = files;
manifest.cli = {
  calls: calls.length,
  failed: calls.filter((c) => !c.ok).length,
  failedCmds: calls.filter((c) => !c.ok).map((c) => c.cmd),
};
manifest.finishedAt = new Date().toISOString();
if (MANIFEST) {
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
}
say(`i18n ${files.i18n.length}, submission ${files.submission.length}, burst ${burst?.frames?.length ?? 0}, console errors ${manifest.consoleErrors}, cli failed ${manifest.cli.failed}`);
process.exit(files.i18n.length === LOCALES.length && manifest.cli.failed === 0 ? 0 : 2);
