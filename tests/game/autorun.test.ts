import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { yawDegOfForward } from '../../src/xr/arc.ts';
import {
  GAZE_HOLD_MS,
  HAND_WAIT_MS,
  ReachCalibrator,
  type CalibrateEvent,
} from '../../src/xr/calibrate.ts';
import { BRIDGE_LINE_MAX, logLines } from '../../src/game/bridge.ts';
import {
  bridgePayloads,
  gazeEdgeTargets,
  latestPayload,
  levelRows,
  mergeLog,
  pagesOf,
} from '../../tools/autorun/parse.mjs';

const gazeCal = JSON.parse(
  readFileSync(new URL('../../tools/autorun/sequences/gaze-calibrate.json', import.meta.url), 'utf8'),
) as { leftDeg: number; rightDeg: number; distance: number; tableY: number };

/** Head yaw when looking from head (x, z) at the point. */
function yawTo(head: { x: number; z: number }, p: { x: number; z: number }): number {
  return yawDegOfForward(p.x - head.x, p.z - head.z);
}

test('autorun gaze edges: both angles are taken from the yaw at the left prompt', () => {
  for (const yaw0 of [0, 20, -30, 170]) {
    const head = { x: 0.1, y: 1.2, z: -0.2, yawDeg: yaw0 };
    const [left, right] = gazeEdgeTargets(head, gazeCal);
    assert.equal(left.phase, 'gaze-left');
    assert.equal(right.phase, 'gaze-right');
    const dl = ((yawTo(head, left.target) - yaw0 + 540) % 360) - 180;
    const dr = ((yawTo(head, right.target) - yaw0 + 540) % 360) - 180;
    assert.ok(Math.abs(dl - gazeCal.leftDeg) < 1e-6, `left ${dl}`);
    assert.ok(Math.abs(dr - gazeCal.rightDeg) < 1e-6, `right ${dr}`);
    assert.equal(left.target.y, gazeCal.tableY);
  }
});

test('autorun gaze edges: the real calibrator reaches a gaze arc with the script targets', () => {
  // Same order as run.mjs: wait for the gaze prompt, hold left, then hold right.
  const cal = new ReachCalibrator();
  const head = { x: 0, z: 0, yawDeg: 0 };
  const events: CalibrateEvent[] = [];
  let t = 0;
  const step = (yawDeg: number, ms: number): void => {
    for (const end = t + ms; t <= end; t += 50) {
      events.push(...cal.update({ t, hand: null, head: { ...head, yawDeg }, tableY: 0.72 }));
    }
  };
  step(0, HAND_WAIT_MS + 100);
  assert.equal(cal.phase, 'gaze-left');
  const targets = gazeEdgeTargets({ ...head, y: 1.2 }, gazeCal);
  for (const { target } of targets) {
    step(yawTo(head, target), GAZE_HOLD_MS + 300);
  }
  assert.equal(cal.phase, 'done');
  assert.equal(cal.arc?.source, 'gaze');
});

/** Console entries as `browser logs` returns them. */
function entries(kind: string, payloads: object[]): { message: string }[] {
  return payloads.map((p) => ({ message: `[reachfit:${kind}] ${JSON.stringify(p)}` }));
}

test('page reload: the newest page wins over a higher seq from the page that is gone', () => {
  const OLD = 1794344000000;
  const NEW = 1794344020000;
  const lines = entries('state', [
    { page: OLD, seq: 40, levelId: 'L02', xr: true },
    { page: OLD, seq: 41, levelId: 'L02', xr: true },
    { page: NEW, seq: 2, levelId: 'L02', xr: false },
    { page: NEW, seq: 3, levelId: 'L02', xr: false },
  ]);
  const got = latestPayload(bridgePayloads(lines, 'state'));
  assert.equal(got.page, NEW);
  assert.equal(got.seq, 3);
  assert.deepEqual(pagesOf(bridgePayloads(lines, 'state')), [OLD, NEW]);
  // Lines from before the page field still read by seq.
  assert.equal(latestPayload([{ seq: 5 }, { seq: 9 }, { seq: 7 }]).seq, 9);
});

test('page reload: logs of two pages join into one play log with every level row', () => {
  const OLD = 1794344000000;
  const NEW = 1794344020000;
  const oldEvents = [
    { type: 'level-start', levelId: 'L01', t: 1 },
    { type: 'rotate', target: 'Tile_1_1', r: 1, c: 1, input: 'pinch', t: 2 },
    { type: 'level-end', levelId: 'L01', rotations: 1, minRotations: 1, ms: 1000, t: 3 },
    { type: 'level-start', levelId: 'L02', t: 4 },
  ];
  const newEvents = [
    { type: 'level-start', levelId: 'L02', t: 1 },
    { type: 'rotate', target: 'Tile_0_0', r: 0, c: 0, input: 'pinch', t: 2 },
    { type: 'rotate', target: 'Tile_0_0', r: 0, c: 0, input: 'pinch', t: 3 },
    { type: 'level-end', levelId: 'L02', rotations: 2, minRotations: 2, ms: 2000, t: 4 },
  ];
  // Short lines so each page's dump comes in several parts, as game.ts prints them.
  const printed = [
    ...logLines(1, oldEvents.slice(0, 3), [], 200).map((l) => ({ page: OLD, ...l })),
    ...logLines(2, oldEvents, [], 200).map((l) => ({ page: OLD, ...l })),
    ...logLines(1, newEvents, [], 200).map((l) => ({ page: NEW, ...l })),
  ];
  const lines = bridgePayloads(entries('log', printed), 'log');
  const kept = mergeLog(lines, OLD);
  const last = mergeLog(lines);
  assert.equal(kept?.dump, 2);
  assert.deepEqual(kept?.events, oldEvents);
  assert.equal(last?.page, NEW);
  assert.deepEqual(last?.events, newEvents);
  const rows = levelRows([...(kept?.events ?? []), ...(last?.events ?? [])]);
  assert.deepEqual(
    rows.map((r: { levelId: string; rotations: number; inputs: Record<string, number> }) => [r.levelId, r.rotations, r.inputs]),
    [
      ['L01', 1, { pinch: 1 }],
      ['L02', 2, { pinch: 2 }],
    ],
  );
});

test('page field: log lines with the page id stay within the line limit', () => {
  // game.ts keeps 32 characters free for the page field (PAGE_FIELD_ROOM).
  const events = Array.from({ length: 400 }, (_, i) => ({
    type: 'reach-sample',
    x: 0.123456789 + i,
    y: 0.74,
    z: -0.4,
    source: 'hand',
    t: 1000.5 + i,
  }));
  const lines = logLines(12, events, [], BRIDGE_LINE_MAX - 32).map((l) => ({ page: 1794344057688, ...l }));
  assert.ok(lines.length > 3);
  for (const line of lines) {
    assert.ok(JSON.stringify(line).length <= BRIDGE_LINE_MAX, String(JSON.stringify(line).length));
  }
});
