/**
 * Seeded board maker and the daily board.
 *
 * makeBoard() picks a random simple path from the source to the target first,
 * lays tiles that open that path, fills the other cells with decoys, then
 * turns some path tiles away. Undoing those turns always works, so every board
 * it returns can be solved. The rules engine passes its own trace and
 * minRotations in (Rules) so this file does not import engine.ts.
 */
import { DIRS, OPENINGS } from './types.ts';
import type { Board, Level, LightResult, Rotation, Tile, TileKind } from './types.ts';

export interface Rules {
  trace(board: Board): LightResult;
  minRotations(board: Board): number;
}

/** Board maker settings. Every number here is a design value. */
export interface MakeOptions {
  rows: number;
  cols: number;
  /** Path length in cells, source and target included. */
  pathMin: number;
  pathMax: number;
  /** Accept a board only when its fewest turns fall in this range. */
  minTurns: readonly [number, number];
  /** Chance that a path tile starts turned away from its solved rotation. */
  scramble: number;
  /** Chance that a path tile is a tee instead of a straight or corner. */
  tee: number;
  /** Chance that a cell off the path is a block. */
  block: number;
}

/** Daily board settings (design values). */
export const DAILY_OPTIONS: MakeOptions = {
  rows: 4,
  cols: 5,
  pathMin: 8,
  pathMax: 11,
  minTurns: [6, 10],
  scramble: 0.8,
  tee: 0.15,
  block: 0.2,
};

/** Tries per board before giving up (design value). */
const MAX_TRIES = 400;

/** FNV-1a 32-bit hash of a string, unsigned. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small seeded generator, returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Board content as text: size, then kind and rotation of every tile. */
export function boardKey(board: Board): string {
  return `${board.rows}x${board.cols}:${board.tiles.map((t) => `${t.kind}${t.rot}`).join(',')}`;
}

/** 8 hex digits identifying the board content. */
export function boardHash(board: Board): string {
  return fnv1a(boardKey(board)).toString(16).padStart(8, '0');
}

/** Local date of `when` as YYYY-MM-DD. */
export function localDate(when: Date = new Date()): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.toISOString().slice(0, 10) === text;
}

const STEP: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Side index (0 N, 1 E, 2 S, 3 W) from cell a to the neighbouring cell b. */
function sideTo(cols: number, a: number, b: number): number {
  const dr = Math.floor(b / cols) - Math.floor(a / cols);
  const dc = (b % cols) - (a % cols);
  return STEP.findIndex(([r, c]) => r === dr && c === dc);
}

/** Random simple path of a random length in [pathMin, pathMax], or null. */
function randomPath(rng: () => number, o: MakeOptions): number[] | null {
  const len = o.pathMin + Math.floor(rng() * (o.pathMax - o.pathMin + 1));
  const rim: number[] = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      if (r === 0 || c === 0 || r === o.rows - 1 || c === o.cols - 1) {
        rim.push(r * o.cols + c);
      }
    }
  }
  const start = pick(rng, rim);
  const path = [start];
  const used = new Set(path);
  let budget = 4000;
  const grow = (): boolean => {
    if (path.length === len) return true;
    if (--budget < 0) return false;
    const i = path[path.length - 1];
    for (const d of shuffled(rng, [0, 1, 2, 3])) {
      const r = Math.floor(i / o.cols) + STEP[d][0];
      const c = (i % o.cols) + STEP[d][1];
      if (r < 0 || c < 0 || r >= o.rows || c >= o.cols) continue;
      const j = r * o.cols + c;
      if (used.has(j)) continue;
      used.add(j);
      path.push(j);
      if (grow()) return true;
      path.pop();
      used.delete(j);
    }
    return false;
  };
  return grow() ? path : null;
}

/** Smallest rotation of `kind` that opens both sides a and b, or -1. */
function rotationOpening(kind: TileKind, a: number, b: number): number {
  for (let rot = 0; rot < 4; rot++) {
    const open = OPENINGS[kind].map((d) => (DIRS.indexOf(d) + rot) % 4);
    if (open.includes(a) && open.includes(b)) return rot;
  }
  return -1;
}

function tile(r: number, c: number, kind: TileKind, rot: number): Tile {
  const rotatable = kind === 'straight' || kind === 'corner' || kind === 'tee' || kind === 'cross';
  return { r, c, kind, rot: (rot % 4) as Rotation, rotatable };
}

function layTiles(rng: () => number, o: MakeOptions, path: number[]): Board {
  const n = o.rows * o.cols;
  const tiles: Tile[] = new Array(n);
  const onPath = new Set(path);
  for (let i = 0; i < n; i++) {
    if (onPath.has(i)) continue;
    const r = Math.floor(i / o.cols);
    const c = i % o.cols;
    tiles[i] =
      rng() < o.block
        ? tile(r, c, 'block', 0)
        : tile(r, c, pick(rng, ['straight', 'corner', 'corner', 'tee'] as const), Math.floor(rng() * 4));
  }
  const last = path.length - 1;
  path.forEach((i, x) => {
    const r = Math.floor(i / o.cols);
    const c = i % o.cols;
    if (x === 0) {
      // The source opens N at rotation 0, so rotation = side index.
      tiles[i] = tile(r, c, 'source', sideTo(o.cols, i, path[1]));
      return;
    }
    if (x === last) {
      tiles[i] = tile(r, c, 'target', 0);
      return;
    }
    const a = sideTo(o.cols, i, path[x - 1]);
    const b = sideTo(o.cols, i, path[x + 1]);
    const kind: TileKind = rng() < o.tee ? 'tee' : (a + 2) % 4 === b ? 'straight' : 'corner';
    const solved = rotationOpening(kind, a, b);
    const off = rng() < o.scramble ? 1 + Math.floor(rng() * 3) : 0;
    tiles[i] = tile(r, c, kind, solved + off);
  });
  return { rows: o.rows, cols: o.cols, tiles };
}

/**
 * A solvable, unsolved board whose fewest turns fall in o.minTurns. Same rng
 * state, same board. Throws when MAX_TRIES boards miss the range.
 */
export function makeBoard(
  rng: () => number,
  o: MakeOptions,
  rules: Rules,
): { board: Board; minRotations: number } {
  for (let t = 0; t < MAX_TRIES; t++) {
    const path = randomPath(rng, o);
    if (!path) continue;
    const board = layTiles(rng, o, path);
    const min = rules.minRotations(board);
    if (min >= Math.max(1, o.minTurns[0]) && min <= o.minTurns[1] && !rules.trace(board).solved) {
      return { board, minRotations: min };
    }
  }
  throw new Error(`puzzle: no board in range after ${MAX_TRIES} tries`);
}

/** Today's board for a local date YYYY-MM-DD. Same date, same board. */
export function buildDaily(date: string, rules: Rules): Level {
  if (!isDate(date)) {
    throw new RangeError(`puzzle: daily date must be YYYY-MM-DD, got ${date}`);
  }
  const rng = mulberry32(fnv1a(`reachfit-daily:${date}`));
  const { board, minRotations } = makeBoard(rng, DAILY_OPTIONS, rules);
  return { id: `daily-${date}`, index: -1, kind: 'daily', board, minRotations, seed: date };
}
