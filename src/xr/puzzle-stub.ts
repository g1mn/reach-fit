/**
 * Stand-in rules engine so the XR layer runs before the real one is wired.
 * Follows PuzzleApi from puzzle/types.ts with two fixed boards: a one-turn
 * 3x3 tutorial and a 3x4 board. Brute force solver, fine for these sizes.
 *
 * MV08 swaps this for src/puzzle/engine.ts in xr/puzzle-source.ts.
 */
import { DIRS, OPENINGS } from '../puzzle/types.ts';
import type {
  Board,
  Dir,
  Level,
  LightResult,
  PuzzleApi,
  Rotation,
  SaveRecord,
  SolutionStep,
  Tile,
  TileKind,
} from '../puzzle/types.ts';

const STEP: Record<Dir, [number, number]> = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
const OPPOSITE: Record<Dir, Dir> = { N: 'S', E: 'W', S: 'N', W: 'E' };
const TURNABLE = new Set<TileKind>(['straight', 'corner', 'tee', 'cross']);

function open(kind: TileKind, rot: number): Set<Dir> {
  return new Set(OPENINGS[kind].map((d) => DIRS[(DIRS.indexOf(d) + rot) % 4]));
}

function tile(r: number, c: number, kind: TileKind, rot: Rotation): Tile {
  return { r, c, kind, rot, rotatable: TURNABLE.has(kind) };
}

function makeBoard(rows: number, cols: number, placed: Tile[]): Board {
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(placed.find((t) => t.r === r && t.c === c) ?? tile(r, c, 'empty', 0));
    }
  }
  return { rows, cols, tiles };
}

function rotate(board: Board, r: number, c: number, turns: 1 | 2 | 3 = 1): Board {
  return {
    ...board,
    tiles: board.tiles.map((t) =>
      t.r === r && t.c === c && t.rotatable ? { ...t, rot: ((t.rot + turns) % 4) as Rotation } : t,
    ),
  };
}

function trace(board: Board): LightResult {
  const lit = board.tiles.map(() => false);
  const at = (r: number, c: number): number =>
    r >= 0 && c >= 0 && r < board.rows && c < board.cols ? r * board.cols + c : -1;
  const queue: number[] = [];
  board.tiles.forEach((t, i) => {
    if (t.kind === 'source') {
      lit[i] = true;
      queue.push(i);
    }
  });
  while (queue.length > 0) {
    const i = queue.shift() as number;
    const t = board.tiles[i];
    for (const d of open(t.kind, t.rot)) {
      const j = at(t.r + STEP[d][0], t.c + STEP[d][1]);
      if (j < 0 || lit[j]) {
        continue;
      }
      const n = board.tiles[j];
      if (open(n.kind, n.rot).has(OPPOSITE[d])) {
        lit[j] = true;
        queue.push(j);
      }
    }
  }
  const targets = board.tiles.map((t, i) => (t.kind === 'target' ? i : -1)).filter((i) => i >= 0);
  const targetsLit = targets.filter((i) => lit[i]).length;
  return {
    lit,
    targetsLit,
    targetsTotal: targets.length,
    solved: targets.length > 0 && targetsLit === targets.length,
  };
}

function solution(board: Board): SolutionStep[] {
  const turnable = board.tiles.filter((t) => t.rotatable);
  let best: number[] | null = null;
  let bestCost = Infinity;
  const turns = new Array<number>(turnable.length).fill(0);
  const total = 4 ** turnable.length;
  for (let code = 0; code < total; code++) {
    let x = code;
    let cost = 0;
    for (let k = 0; k < turnable.length; k++) {
      turns[k] = x % 4;
      cost += turns[k];
      x = Math.floor(x / 4);
    }
    if (cost >= bestCost) {
      continue;
    }
    let b = board;
    turnable.forEach((t, k) => {
      if (turns[k] > 0) {
        b = rotate(b, t.r, t.c, turns[k] as 1 | 2 | 3);
      }
    });
    if (trace(b).solved) {
      best = [...turns];
      bestCost = cost;
    }
  }
  if (!best) {
    return [];
  }
  const steps: SolutionStep[] = [];
  turnable.forEach((t, k) => {
    if (best && best[k] > 0) {
      steps.push({ r: t.r, c: t.c, turns: best[k] as 1 | 2 | 3 });
    }
  });
  return steps;
}

function minRotations(board: Board): number {
  return solution(board).reduce((sum, s) => sum + s.turns, 0);
}

function level(id: string, index: number, kind: Level['kind'], board: Board): Level {
  return { id, index, kind, board, minRotations: minRotations(board) };
}

function buildLevels(): Level[] {
  const tutorial = makeBoard(3, 3, [
    tile(2, 1, 'source', 0),
    tile(1, 1, 'straight', 1),
    tile(0, 1, 'target', 0),
  ]);
  const second = makeBoard(3, 4, [
    tile(2, 0, 'source', 1),
    tile(2, 1, 'straight', 0),
    tile(2, 2, 'corner', 2),
    tile(1, 2, 'straight', 1),
    tile(0, 2, 'corner', 0),
    tile(0, 3, 'target', 0),
    tile(1, 1, 'corner', 0),
    tile(0, 1, 'straight', 0),
    tile(1, 3, 'block', 0),
  ]);
  return [level('L01', 0, 'tutorial', tutorial), level('L02', 1, 'level', second)];
}

function emptyRecord(): SaveRecord {
  return {
    version: 1,
    currentLevel: 0,
    levels: {},
    daily: {},
    locale: 'en',
    updatedAt: new Date(0).toISOString(),
  };
}

export const puzzleStub: PuzzleApi = {
  levels: buildLevels,
  daily(date: string): Level {
    const base = buildLevels()[1];
    return { ...base, id: `daily-${date}`, index: -1, kind: 'daily', seed: date };
  },
  rotate,
  trace,
  minRotations,
  solution,
  load: emptyRecord,
  save: () => false,
};
