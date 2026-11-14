/**
 * Auto-save: progress and best turn counts only, never board state. Every
 * storage access is inside try/catch, so a blocked, full or missing
 * localStorage (private mode, Node tests) never breaks the game.
 */
import { DEFAULT_LOCALE, isLocale } from '../i18n/locales.ts';
import type { Level, LevelRecord, SaveRecord } from './types.ts';

export const SAVE_KEY = 'reachfit.save.v1';

/** Main levels in the run, so currentLevel tops out at this (12 = done). */
const LEVEL_COUNT = 12;

/** Daily results kept, newest first (design value). */
const DAILY_KEEP = 60;

export function emptyRecord(): SaveRecord {
  return {
    version: 1,
    currentLevel: 0,
    levels: {},
    daily: {},
    locale: DEFAULT_LOCALE,
    updatedAt: '',
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(): Store | null {
  try {
    const s = (globalThis as { localStorage?: Store }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keeps entries whose key matches `key` and whose value is a LevelRecord. */
function cleanBook(v: unknown, key: RegExp): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  if (!isObject(v)) return out;
  for (const [k, e] of Object.entries(v)) {
    if (
      key.test(k) &&
      isObject(e) &&
      Number.isInteger(e.bestRotations) &&
      (e.bestRotations as number) >= 0 &&
      typeof e.solvedAt === 'string'
    ) {
      out[k] = { bestRotations: e.bestRotations as number, solvedAt: e.solvedAt };
    }
  }
  return out;
}

const LEVEL_KEY = /^L\d{2}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A SaveRecord built from untrusted data. Bad fields fall back to empty. */
export function cleanRecord(v: unknown): SaveRecord {
  const out = emptyRecord();
  if (!isObject(v) || v.version !== 1) return out;
  const level = v.currentLevel;
  if (Number.isInteger(level) && (level as number) >= 0 && (level as number) <= LEVEL_COUNT) {
    out.currentLevel = level as number;
  }
  out.levels = cleanBook(v.levels, LEVEL_KEY);
  out.daily = cleanBook(v.daily, DATE_KEY);
  if (typeof v.locale === 'string' && isLocale(v.locale)) out.locale = v.locale;
  if (typeof v.updatedAt === 'string') out.updatedAt = v.updatedAt;
  return out;
}

/** Never throws. Returns an empty record when storage fails or holds junk. */
export function load(): SaveRecord {
  try {
    const raw = store()?.getItem(SAVE_KEY);
    return raw ? cleanRecord(JSON.parse(raw)) : emptyRecord();
  } catch {
    return emptyRecord();
  }
}

/** Never throws. False when storage is missing or refuses the write. */
export function save(record: SaveRecord): boolean {
  try {
    const s = store();
    if (!s) return false;
    const clean = cleanRecord(record);
    clean.updatedAt = new Date().toISOString();
    s.setItem(SAVE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/**
 * The record after solving `level` in `rotations` turns. Keeps the lowest
 * turn count and the first solve time, moves currentLevel past a main level,
 * and keeps only the newest DAILY_KEEP daily results. Pure: does not save.
 */
export function recordSolve(
  record: SaveRecord,
  level: Level,
  rotations: number,
  when: Date = new Date(),
): SaveRecord {
  const daily = level.kind === 'daily';
  const key = daily ? (level.seed ?? level.id.replace(/^daily-/, '')) : level.id;
  const book = { ...(daily ? record.daily : record.levels) };
  const prev = book[key];
  book[key] = {
    bestRotations: prev ? Math.min(prev.bestRotations, rotations) : rotations,
    solvedAt: prev ? prev.solvedAt : when.toISOString(),
  };
  if (!daily) {
    return {
      ...record,
      levels: book,
      currentLevel: Math.min(LEVEL_COUNT, Math.max(record.currentLevel, level.index + 1)),
    };
  }
  const kept = Object.keys(book).sort().reverse().slice(0, DAILY_KEEP);
  const trimmed: Record<string, LevelRecord> = {};
  for (const k of kept) trimmed[k] = book[k];
  return { ...record, daily: trimmed };
}
