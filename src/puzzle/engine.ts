/**
 * Rules engine for the light puzzle. Pure functions over Board (types.ts),
 * plus `puzzle`, the PuzzleApi object the XR layer uses.
 *
 * Fewest turns: in a solved board some chain of lit tiles runs from the
 * source to the target, so the cheapest solution is the cheapest simple path
 * where each tile on it costs the fewest clockwise turns that open both the
 * side the light enters and the side it leaves. The search below walks simple
 * paths depth first and cuts a branch once its cost plus a lower bound for the
 * rest reaches the best found so far. Tiles off the path keep their rotation.
 */
import { DIRS, OPENINGS } from './types.ts';
import type {
  Board,
  Dir,
  LightResult,
  PuzzleApi,
  Rotation,
  SolutionStep,
  Tile,
  TileKind,
} from './types.ts';
import { buildDaily, type Rules } from './daily.ts';
import { buildLevels } from './levels.ts';
import { load, save } from './save.ts';

/** Row and column step for each side, in DIRS order N, E, S, W. */
const STEP: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
];

const TURNABLE: ReadonlySet<TileKind> = new Set<TileKind>([
  'straight',
  'corner',
  'tee',
  'cross',
]);

const NO_WAY = Number.POSITIVE_INFINITY;

/** Open sides as a 4-bit mask, bit 0 = N, 1 = E, 2 = S, 3 = W. */
export function openMask(kind: TileKind, rot: number): number {
  let mask = 0;
  for (const d of OPENINGS[kind]) {
    mask |= 1 << ((DIRS.indexOf(d) + rot) % 4);
  }
  return mask;
}

/** Open sides of a tile kind at a rotation, in N, E, S, W order. */
export function openSides(kind: TileKind, rot: number): Dir[] {
  const mask = openMask(kind, rot);
  return DIRS.filter((_, i) => (mask & (1 << i)) !== 0);
}

export function tileAt(board: Board, r: number, c: number): Tile | undefined {
  if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) {
    return undefined;
  }
  return board.tiles[r * board.cols + c];
}

/** Index of the neighbour of tile i on side d, or -1 off the board. */
function neighbour(board: Board, i: number, d: number): number {
  const r = Math.floor(i / board.cols) + STEP[d][0];
  const c = (i % board.cols) + STEP[d][1];
  if (r < 0 || c < 0 || r >= board.rows || c >= board.cols) {
    return -1;
  }
  return r * board.cols + c;
}

/**
 * New board with (r, c) turned clockwise. Returns the same board object,
 * unchanged, for a tile that cannot turn, a cell off the board, or a whole
 * number of full turns, so the caller can spot a wasted grab with ===.
 */
export function rotate(board: Board, r: number, c: number, turns = 1): Board {
  const tile = tileAt(board, r, c);
  const k = ((Math.trunc(turns) % 4) + 4) % 4;
  if (!tile || !tile.rotatable || !TURNABLE.has(tile.kind) || k === 0) {
    return board;
  }
  const tiles = board.tiles.slice();
  tiles[r * board.cols + c] = { ...tile, rot: ((tile.rot + k) % 4) as Rotation };
  return { ...board, tiles };
}

export function trace(board: Board): LightResult {
  const { tiles } = board;
  const lit = new Array<boolean>(tiles.length).fill(false);
  const queue: number[] = [];
  tiles.forEach((t, i) => {
    if (t.kind === 'source') {
      lit[i] = true;
      queue.push(i);
    }
  });
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const mask = openMask(tiles[i].kind, tiles[i].rot);
    for (let d = 0; d < 4; d++) {
      if ((mask & (1 << d)) === 0) {
        continue;
      }
      const j = neighbour(board, i, d);
      if (j < 0 || lit[j]) {
        continue;
      }
      if (openMask(tiles[j].kind, tiles[j].rot) & (1 << ((d + 2) % 4))) {
        lit[j] = true;
        queue.push(j);
      }
    }
  }
  let targetsTotal = 0;
  let targetsLit = 0;
  tiles.forEach((t, i) => {
    if (t.kind === 'target') {
      targetsTotal++;
      if (lit[i]) {
        targetsLit++;
      }
    }
  });
  return {
    lit,
    targetsLit,
    targetsTotal,
    solved: targetsTotal > 0 && targetsLit === targetsTotal,
  };
}

interface Plan {
  cost: number;
  steps: SolutionStep[];
}

/**
 * Cheapest set of turns that lights the target, or null when no rotation of
 * the board lights it. Boards must have exactly one target and at least one
 * source (every board this engine makes does).
 */
function plan(board: Board): Plan | null {
  const { tiles } = board;
  const n = tiles.length;
  if (n !== board.rows * board.cols) {
    throw new Error('puzzle: tiles.length must equal rows * cols');
  }
  const targets: number[] = [];
  const sources: number[] = [];
  tiles.forEach((t, i) => {
    if (t.kind === 'target') targets.push(i);
    if (t.kind === 'source') sources.push(i);
  });
  if (targets.length !== 1 || sources.length === 0) {
    throw new Error('puzzle: a board needs exactly one target and a source');
  }
  const goal = targets[0];

  // masks[i][k]: open sides of tile i after k more clockwise turns.
  const masks = tiles.map((t) => {
    const turnable = t.rotatable && TURNABLE.has(t.kind);
    return [0, 1, 2, 3].map((k) => openMask(t.kind, t.rot + (turnable ? k : 0)));
  });
  /** Fewest turns that open every side in `need` on tile i. */
  const turnCost = (i: number, need: number): number => {
    for (let k = 0; k < 4; k++) {
      if ((masks[i][k] & need) === need) {
        return k;
      }
    }
    return NO_WAY;
  };

  // Lower bound for the rest of a path: entering tile j costs at least the
  // cheapest way through it from any side to any other side.
  const through = tiles.map((t, i) => {
    if (i === goal) return 0;
    if (t.kind === 'source') return NO_WAY;
    let best = NO_WAY;
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        best = Math.min(best, turnCost(i, (1 << a) | (1 << b)));
      }
    }
    return best;
  });
  // rest[j]: lower bound on the cost of tiles from j (included) to the goal.
  const rest = new Array<number>(n).fill(NO_WAY);
  rest[goal] = 0;
  const done = new Array<boolean>(n).fill(false);
  for (;;) {
    let k = -1;
    for (let i = 0; i < n; i++) {
      if (!done[i] && rest[i] < NO_WAY && (k < 0 || rest[i] < rest[k])) k = i;
    }
    if (k < 0) break;
    done[k] = true;
    for (let d = 0; d < 4; d++) {
      const j = neighbour(board, k, d);
      if (j >= 0 && !done[j] && through[j] + rest[k] < rest[j]) {
        rest[j] = through[j] + rest[k];
      }
    }
  }

  let best = NO_WAY;
  let bestSteps: SolutionStep[] = [];
  const onPath = new Array<boolean>(n).fill(false);
  for (const s of sources) onPath[s] = true;
  const path: number[] = [];
  const turns: number[] = [];

  // At tile i, entered through side `entry`, having spent `spent` before i.
  const walk = (i: number, entry: number, spent: number): void => {
    if (i === goal) {
      if (spent < best) {
        best = spent;
        bestSteps = [];
        path.forEach((p, x) => {
          if (turns[x] > 0) {
            bestSteps.push({
              r: Math.floor(p / board.cols),
              c: p % board.cols,
              turns: turns[x] as 1 | 2 | 3,
            });
          }
        });
      }
      return;
    }
    for (let d = 0; d < 4; d++) {
      if (d === entry) continue;
      const k = turnCost(i, (1 << entry) | (1 << d));
      if (k === NO_WAY) continue;
      const j = neighbour(board, i, d);
      if (j < 0 || onPath[j] || spent + k + rest[j] >= best) continue;
      onPath[j] = true;
      path.push(i);
      turns.push(k);
      walk(j, (d + 2) % 4, spent + k);
      path.pop();
      turns.pop();
      onPath[j] = false;
    }
  };

  for (const s of sources) {
    const mask = masks[s][0];
    for (let d = 0; d < 4; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const j = neighbour(board, s, d);
      if (j < 0 || onPath[j] || rest[j] >= best) continue;
      onPath[j] = true;
      walk(j, (d + 2) % 4, 0);
      onPath[j] = false;
    }
  }
  return best === NO_WAY ? null : { cost: best, steps: bestSteps };
}

/** Fewest clockwise quarter turns to light the target. -1 when impossible. */
export function minRotations(board: Board): number {
  const p = plan(board);
  return p ? p.cost : -1;
}

/**
 * Turns that solve the board with the fewest total, ordered from the source
 * along the lit path. Empty when already solved or impossible.
 */
export function solution(board: Board): SolutionStep[] {
  const p = plan(board);
  return p ? p.steps : [];
}

const RULES: Rules = { trace, minRotations };

let mainLevels: ReturnType<typeof buildLevels> | null = null;

export const puzzle: PuzzleApi = {
  // A fresh copy each call, so a caller cannot change the cached levels.
  levels: () => structuredClone((mainLevels ??= buildLevels(RULES))),
  daily: (date) => buildDaily(date, RULES),
  rotate,
  trace,
  minRotations,
  solution,
  load,
  save,
};
