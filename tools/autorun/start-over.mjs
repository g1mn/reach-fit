#!/usr/bin/env node
// Clicks the 2D page button 'Start over from level 1' (data-testid
// rf-start-over, src/game/page-extras.ts) and waits until the app's console
// bridge shows L01 with no turns. autorun.sh calls it after `dev up`, before
// `xr enter`, so a game saved in the browser profile does not change where a
// run starts. A click alone was not enough once (MV04 run: the click call
// returned ok but the run started at L02), so the result is read back.
//
//   node start-over.mjs [--timeout-ms 90000]
// Exit 0 when L01 is on show, 3 when not within the timeout.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgePayloads, cliFailed, findLogEntries, latestPayload, parseCliOutput } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../..');
const CLI_JS = join(APP, 'node_modules/@iwsdk/cli/bin/iwsdk.js');

// Design values for the script, not measurements.
const RETRY_MS = 2000;
const CONFIRM_MS = 8000;
const POLL_MS = 500;

const at = process.argv.indexOf('--timeout-ms');
const TIMEOUT_MS = at > 0 ? Number(process.argv[at + 1]) || 90000 : 90000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.round(ms));
}

function cli(path, input) {
  const r = spawnSync(process.execPath, [CLI_JS, ...path, '--input-json', JSON.stringify(input)], {
    cwd: APP,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = parseCliOutput(r.stdout);
  return { ok: r.status === 0 && !cliFailed(out), out };
}

function latestState() {
  const r = cli(['browser', 'logs'], { pattern: '\\[reachfit:state\\]', count: 5 });
  return latestPayload(bridgePayloads(findLogEntries(r.out), 'state'));
}

const end = Date.now() + TIMEOUT_MS;
let clicks = 0;
let last = null;
while (Date.now() < end) {
  const click = cli(['browser', 'interact'], {
    steps: [{ action: 'click', locator: { testId: 'rf-start-over' } }],
  });
  if (click.ok && click.out?.data?.result?.success !== false) {
    clicks++;
    const confirmEnd = Date.now() + CONFIRM_MS;
    while (Date.now() < confirmEnd) {
      last = latestState();
      if (last && last.levelId === 'L01' && last.rotations === 0 && !last.solved) {
        console.log(`[autorun] start over: L01 on show after ${clicks} click(s)`);
        process.exit(0);
      }
      sleep(POLL_MS);
    }
  }
  sleep(RETRY_MS);
}
console.error(
  `[autorun] start over did not show L01 (clicks ${clicks}, last state ${JSON.stringify(last && { levelId: last.levelId, rotations: last.rotations, phase: last.phase })})`,
);
process.exit(3);
