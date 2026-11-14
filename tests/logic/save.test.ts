import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzle } from '../../src/puzzle/engine.ts';
import { SAVE_KEY, emptyRecord, recordSolve } from '../../src/puzzle/save.ts';
import type { SaveRecord } from '../../src/puzzle/types.ts';

function setStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const EMPTY = { version: 1, currentLevel: 0, levels: {}, daily: {}, locale: 'en' };

test('without localStorage (Node), load gives an empty record and save gives false', () => {
  assert.equal((globalThis as { localStorage?: unknown }).localStorage, undefined);
  assert.deepEqual({ ...puzzle.load(), updatedAt: undefined }, { ...EMPTY, updatedAt: undefined });
  assert.equal(puzzle.save(emptyRecord()), false);
});

test('localStorage that throws on getItem and setItem never breaks load or save', () => {
  setStorage({
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  });
  let loaded: SaveRecord | undefined;
  assert.doesNotThrow(() => {
    loaded = puzzle.load();
  });
  assert.equal(loaded?.version, 1);
  assert.equal(loaded?.currentLevel, 0);
  let ok: boolean | undefined;
  assert.doesNotThrow(() => {
    ok = puzzle.save({ ...emptyRecord(), currentLevel: 3 });
  });
  assert.equal(ok, false);
});

test('a localStorage getter that throws is handled too', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('access denied');
    },
  });
  assert.doesNotThrow(() => puzzle.load());
  assert.equal(puzzle.save(emptyRecord()), false);
  assert.equal(puzzle.load().currentLevel, 0);
});

test('save then load round-trips progress, best turns and locale', () => {
  const mem = memoryStorage();
  setStorage(mem);
  const record: SaveRecord = {
    ...emptyRecord(),
    currentLevel: 5,
    levels: { L01: { bestRotations: 1, solvedAt: '2026-11-10T01:00:00.000Z' } },
    daily: { '2026-11-18': { bestRotations: 7, solvedAt: '2026-11-18T09:00:00.000Z' } },
    locale: 'ko',
  };
  assert.equal(puzzle.save(record), true);
  assert.ok(mem.data.has(SAVE_KEY));
  const back = puzzle.load();
  assert.equal(back.currentLevel, 5);
  assert.equal(back.locale, 'ko');
  assert.deepEqual(back.levels, record.levels);
  assert.deepEqual(back.daily, record.daily);
  assert.match(back.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('junk in storage falls back field by field, never throws', () => {
  const mem = memoryStorage();
  setStorage(mem);
  for (const raw of ['{not json', 'null', '[]', '42', JSON.stringify({ version: 2, currentLevel: 4 })]) {
    mem.data.set(SAVE_KEY, raw);
    assert.equal(puzzle.load().currentLevel, 0, raw);
  }
  mem.data.set(
    SAVE_KEY,
    JSON.stringify({
      version: 1,
      currentLevel: 99,
      levels: { L02: { bestRotations: 2, solvedAt: 'x' }, L03: { bestRotations: -1, solvedAt: 'x' }, __proto__x: 1 },
      daily: { 'not-a-date': { bestRotations: 1, solvedAt: 'x' } },
      locale: 'xx',
    }),
  );
  const r = puzzle.load();
  assert.equal(r.currentLevel, 0);
  assert.deepEqual(Object.keys(r.levels), ['L02']);
  assert.deepEqual(r.daily, {});
  assert.equal(r.locale, 'en');
});

test('recordSolve keeps the best count and first solve time, moves progress forward', () => {
  const [l1, l2] = puzzle.levels();
  const t1 = new Date('2026-11-11T00:00:00Z');
  const t2 = new Date('2026-11-12T00:00:00Z');
  let r = recordSolve(emptyRecord(), l1, 3, t1);
  assert.equal(r.currentLevel, 1);
  r = recordSolve(r, l1, 1, t2);
  assert.deepEqual(r.levels.L01, { bestRotations: 1, solvedAt: t1.toISOString() });
  r = recordSolve(r, l1, 5, t2);
  assert.equal(r.levels.L01.bestRotations, 1);
  r = recordSolve(r, l2, 4, t2);
  assert.equal(r.currentLevel, 2);
  // Replaying an early level does not move progress back.
  assert.equal(recordSolve(r, l1, 1, t2).currentLevel, 2);
  const last = puzzle.levels()[11];
  assert.equal(recordSolve(r, last, 20, t2).currentLevel, 12);
});

test('daily results are keyed by date and trimmed to the newest 60, so a save stays small', () => {
  const mem = memoryStorage();
  setStorage(mem);
  let r = emptyRecord();
  for (const level of puzzle.levels()) r = recordSolve(r, level, level.minRotations + 2);
  const start = Date.UTC(2026, 10, 1);
  for (let i = 0; i < 75; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const daily = { ...puzzle.levels()[0], id: `daily-${date}`, index: -1, kind: 'daily' as const, seed: date };
    r = recordSolve(r, daily, 6);
  }
  const dates = Object.keys(r.daily).sort();
  assert.equal(dates.length, 60);
  assert.equal(dates[0], '2026-11-16');
  assert.equal(dates[59], '2027-01-14');
  assert.equal(Object.keys(r.levels).length, 12);
  assert.equal(puzzle.save(r), true);
  const bytes = (mem.data.get(SAVE_KEY) ?? '').length;
  assert.ok(bytes < 8192, `save is ${bytes} bytes`);
});
