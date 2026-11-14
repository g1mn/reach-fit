/**
 * The 12 main levels. L01 is written by hand: one straight tile turned away,
 * one turn to solve, shown right after the reach sweep. L02 to L12 come from
 * makeBoard() with a fixed seed each, so every run gets the same boards.
 * Sizes and turn ranges below are design values; check-levels prints what
 * each board actually needs.
 */
import type { Board, Level, Tile, TileKind } from './types.ts';
import { fnv1a, makeBoard, mulberry32, type MakeOptions, type Rules } from './daily.ts';

/** Per level: size, path length range and accepted fewest-turns range. */
interface LevelPlan {
  rows: number;
  cols: number;
  pathMin: number;
  pathMax: number;
  minTurns: readonly [number, number];
}

/** L02 to L12 (design values). */
const PLANS: readonly LevelPlan[] = [
  { rows: 3, cols: 4, pathMin: 4, pathMax: 6, minTurns: [2, 2] },
  { rows: 3, cols: 4, pathMin: 5, pathMax: 7, minTurns: [3, 3] },
  { rows: 3, cols: 5, pathMin: 5, pathMax: 8, minTurns: [4, 4] },
  { rows: 3, cols: 5, pathMin: 6, pathMax: 9, minTurns: [5, 5] },
  { rows: 4, cols: 4, pathMin: 7, pathMax: 10, minTurns: [5, 6] },
  { rows: 3, cols: 6, pathMin: 7, pathMax: 10, minTurns: [6, 7] },
  { rows: 4, cols: 5, pathMin: 8, pathMax: 11, minTurns: [7, 8] },
  { rows: 4, cols: 5, pathMin: 9, pathMax: 12, minTurns: [8, 9] },
  { rows: 4, cols: 5, pathMin: 10, pathMax: 13, minTurns: [9, 10] },
  { rows: 4, cols: 6, pathMin: 11, pathMax: 14, minTurns: [10, 11] },
  { rows: 4, cols: 6, pathMin: 12, pathMax: 15, minTurns: [11, 12] },
];

/** Board maker chances shared by L02 to L12 (design values). */
const CHANCES = { scramble: 0.8, tee: 0.12, block: 0.2 } as const;

/** Tutorial: source on the left, light runs along the middle row. */
function tutorialBoard(): Board {
  const rows = 3;
  const cols = 4;
  const middle: [TileKind, number][] = [
    ['source', 1],
    ['straight', 0],
    ['straight', 1],
    ['target', 0],
  ];
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [kind, rot] = r === 1 ? middle[c] : (['empty', 0] as [TileKind, number]);
      tiles.push({ r, c, kind, rot: rot as Tile['rot'], rotatable: kind === 'straight' });
    }
  }
  return { rows, cols, tiles };
}

export function levelId(index: number): string {
  return `L${String(index + 1).padStart(2, '0')}`;
}

export function buildLevels(rules: Rules): Level[] {
  const tutorial = tutorialBoard();
  const levels: Level[] = [
    {
      id: levelId(0),
      index: 0,
      kind: 'tutorial',
      board: tutorial,
      minRotations: rules.minRotations(tutorial),
    },
  ];
  PLANS.forEach((plan, x) => {
    const index = x + 1;
    const id = levelId(index);
    const options: MakeOptions = { ...plan, ...CHANCES };
    const { board, minRotations } = makeBoard(mulberry32(fnv1a(`reachfit-level:${id}`)), options, rules);
    levels.push({ id, index, kind: 'level', board, minRotations });
  });
  return levels;
}
