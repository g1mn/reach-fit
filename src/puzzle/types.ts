/**
 * Puzzle data shared by the rules engine (src/puzzle) and the XR layer
 * (src/xr, src/ui). Pure data: no DOM, no three.js, no storage here.
 *
 * The board is a square grid in logic. Laying it out on an arc that follows
 * the player's reach is the XR layer's job; the engine never sees positions.
 *
 * Light model: a source sends light out of its open side. Light passes from a
 * tile to its neighbour when both tiles are open on the shared edge. A level
 * is solved when every target is lit. Tiles outside the lit network do not
 * matter.
 */

/** Quarter turns clockwise, seen from above. */
export type Rotation = 0 | 1 | 2 | 3;

/** Grid edges. N is the far edge (away from the player), E is to the right. */
export type Dir = 'N' | 'E' | 'S' | 'W';

export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

export type TileKind =
  | 'empty'
  | 'straight'
  | 'corner'
  | 'tee'
  | 'cross'
  | 'source'
  | 'target'
  | 'block';

/**
 * Open sides at rotation 0. Turning a tile by one step maps N to E, E to S,
 * S to W and W to N. Empty and block tiles have no open side.
 */
export const OPENINGS: Readonly<Record<TileKind, readonly Dir[]>> = {
  empty: [],
  straight: ['N', 'S'],
  corner: ['N', 'E'],
  tee: ['N', 'E', 'S'],
  cross: ['N', 'E', 'S', 'W'],
  source: ['N'],
  target: ['N', 'E', 'S', 'W'],
  block: [],
};

export interface Tile {
  r: number;
  c: number;
  kind: TileKind;
  rot: Rotation;
  /** False for empty, block, source and target: the player cannot turn them. */
  rotatable: boolean;
}

export interface Board {
  rows: number;
  cols: number;
  /** Row-major, length rows * cols. Row 0 is the far row. */
  tiles: Tile[];
}

export type LevelKind = 'tutorial' | 'level' | 'daily';

export interface Level {
  /** 'L01' to 'L12', or 'daily-YYYY-MM-DD'. */
  id: string;
  /** 0 to 11 for the main run, -1 for the daily board. */
  index: number;
  kind: LevelKind;
  /** Start state, already scrambled. Never solved at start. */
  board: Board;
  /** Fewest quarter turns from the start state to a solved state. */
  minRotations: number;
  /** Daily board only: the local date used as the seed. */
  seed?: string;
}

/** How the player triggered an action. 'auto' is the scripted autorun. */
export type InputKind = 'pinch' | 'gaze' | 'voice' | 'controller' | 'keyboard' | 'auto';

/** One player action: turn the tile at (r, c) clockwise by one step. */
export interface Move {
  r: number;
  c: number;
  input: InputKind;
  /** performance.now() in ms. */
  at: number;
}

/** One entry of a solution: turn (r, c) clockwise `turns` times. */
export interface SolutionStep {
  r: number;
  c: number;
  turns: 1 | 2 | 3;
}

export interface LightResult {
  /** Same order as Board.tiles. */
  lit: boolean[];
  targetsLit: number;
  targetsTotal: number;
  solved: boolean;
}

export interface LevelRecord {
  bestRotations: number;
  /** ISO 8601 time of the first solve. */
  solvedAt: string;
}

export interface SaveRecord {
  version: 1;
  /** Index of the level to resume, 0 to 11. 12 means the main run is done. */
  currentLevel: number;
  /** Keyed by Level.id. */
  levels: Record<string, LevelRecord>;
  /** Keyed by local date YYYY-MM-DD. */
  daily: Record<string, LevelRecord>;
  /** A Locale code from src/i18n/locales.ts. */
  locale: string;
  updatedAt: string;
}

/** What the rules engine exports. Every function is pure except load/save. */
export interface PuzzleApi {
  /** The 12 main levels in order. Level 0 is the one-turn tutorial. */
  levels(): Level[];
  /** Today's board for a local date YYYY-MM-DD. Same date, same board. */
  daily(date: string): Level;
  /** Returns a new board with (r, c) turned clockwise. Does not mutate. */
  rotate(board: Board, r: number, c: number, turns?: 1 | 2 | 3): Board;
  trace(board: Board): LightResult;
  minRotations(board: Board): number;
  /** Steps that solve the board from its current state, fewest turns. */
  solution(board: Board): SolutionStep[];
  /** Never throws. Returns an empty record when storage fails. */
  load(): SaveRecord;
  /** Never throws. False when storage is unavailable. */
  save(record: SaveRecord): boolean;
}
