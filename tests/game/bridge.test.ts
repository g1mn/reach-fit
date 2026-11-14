import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BRIDGE_LINE_MAX, chunkForLines, logLines } from '../../src/game/bridge.ts';
import { PlayLogger } from '../../src/logger.ts';
import type { LogEvent } from '../../src/test-api.ts';
import {
  bridgePayloads,
  latestPayload,
  levelRows,
  mergeLog,
} from '../../tools/autorun/parse.mjs';

/** A long play log: calibration samples, then 13 boards of turns. */
function bigLog(): { events: LogEvent[]; logger: PlayLogger } {
  let t = 0;
  const logger = new PlayLogger(() => (t += 7));
  for (let i = 0; i < 150; i++) {
    logger.push({ type: 'reach-sample', x: 0.1 + i / 1000, y: 0.74, z: -0.4, source: 'hand' });
  }
  for (let level = 1; level <= 13; level++) {
    const id = level <= 12 ? `L${String(level).padStart(2, '0')}` : 'daily-2026-11-18';
    logger.push({ type: 'level-start', levelId: id });
    for (let k = 0; k < 40; k++) {
      logger.frame(13.9);
    }
    for (let k = 0; k < 12; k++) {
      logger.push({ type: 'rotate', target: `Tile_${k % 4}_${k % 6}`, r: k % 4, c: k % 6, input: k % 2 ? 'gaze' : 'pinch' });
    }
    logger.push({ type: 'mis-grab', target: 'Tile_0_0', reason: 'not-rotatable', input: 'pinch' });
    logger.push({ type: 'level-end', levelId: id, rotations: 12, minRotations: 9, ms: 4321.5 });
  }
  logger.push({ type: 'locale', locale: 'vi' });
  logger.push({ type: 'error', message: 'x'.repeat(300) });
  return { events: logger.log().filter((e) => e.type !== 'frame'), logger };
}

test('log split: every line is at most 4000 characters and parts join back to the log', () => {
  const { events, logger } = bigLog();
  const summaries = logger.frameSummaries();
  assert.ok(JSON.stringify(events).length > 3 * BRIDGE_LINE_MAX, 'the log needs several lines');
  const lines = logLines(3, events, summaries);
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.ok(JSON.stringify(line).length <= BRIDGE_LINE_MAX, `line ${line.part} is ${JSON.stringify(line).length}`);
    assert.equal(line.of, lines.length);
    assert.equal(line.dump, 3);
  }
  assert.deepEqual(
    lines.map((l) => l.part),
    lines.map((_, i) => i + 1),
  );
  const merged = mergeLog(lines);
  assert.ok(merged);
  assert.deepEqual(merged.events, events);
  assert.deepEqual(merged.frameSummaries, summaries);
});

test('log split: the reader takes the newest complete dump through console lines', () => {
  const { events, logger } = bigLog();
  const old = logLines(1, events.slice(0, 50), []);
  const fresh = logLines(2, events, logger.frameSummaries());
  // Console text as the app prints it, newest dump missing nothing.
  const entries = [...old, ...fresh].map((l) => ({ message: `[reachfit:log] ${JSON.stringify(l)}` }));
  const merged = mergeLog(bridgePayloads(entries, 'log'));
  assert.equal(merged?.dump, 2);
  assert.deepEqual(merged?.events, events);
  // A dump with a part missing is skipped for the previous complete one.
  const broken = entries.slice(0, old.length + fresh.length - 1);
  assert.equal(mergeLog(bridgePayloads(broken, 'log'))?.dump, 1);
});

test('log split: tight limits, empty logs and one oversized item', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ n: i, s: 'abc'.repeat(i % 7) }));
  for (const max of [120, 400, 1000]) {
    const chunks = chunkForLines(items, (part, of, chunk) => ({ part, of, items: chunk }), max);
    assert.deepEqual(chunks.flat(), items);
    chunks.forEach((chunk, i) => {
      assert.ok(JSON.stringify({ part: i + 1, of: chunks.length, items: chunk }).length <= max);
    });
  }
  assert.deepEqual(logLines(1, [], []), [{ dump: 1, part: 1, of: 1, events: [] }]);
  const huge = [{ s: 'y'.repeat(5000) }, { s: 'z' }];
  const chunks = chunkForLines(huge, (part, of, chunk) => ({ part, of, items: chunk }));
  assert.deepEqual(chunks, [[huge[0]], [huge[1]]]);
});

test('reader: latest payload by seq, level rows from level-end events', () => {
  const entries = [
    { message: '[reachfit:state] {"seq":4,"solved":false}' },
    { message: 'unrelated line' },
    { message: '[reachfit:state] {"seq":9,"solved":true}' },
    { message: '[reachfit:state] {"seq":7,"solved":false}' },
    { message: '[reachfit:state] {broken' },
  ];
  assert.deepEqual(latestPayload(bridgePayloads(entries, 'state')), { seq: 9, solved: true });
  const { events } = bigLog();
  const rows = levelRows(events);
  assert.equal(rows.length, 13);
  assert.deepEqual(rows[0], {
    levelId: 'L01',
    solved: true,
    rotations: 12,
    minRotations: 9,
    ms: 4322,
    misGrabs: 1,
    inputs: { pinch: 6, gaze: 6 },
  });
  assert.equal(rows[12].levelId, 'daily-2026-11-18');
});
