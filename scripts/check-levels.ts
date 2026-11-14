/**
 * Prints one line per main level and per daily board, and exits 1 if any
 * board is solved at start or cannot be solved by its own solution().
 *   node app/scripts/check-levels.ts [YYYY-MM-DD ...]
 * Default daily dates: 2026-11-18, 2026-11-19, 2026-11-20 (judging week).
 */
import { puzzle } from '../src/puzzle/engine.ts';
import { boardHash } from '../src/puzzle/daily.ts';
import type { Level } from '../src/puzzle/types.ts';

const DEFAULT_DATES = ['2026-11-18', '2026-11-19', '2026-11-20'];

function verdict(level: Level): { ok: boolean; word: string } {
  const { board } = level;
  if (puzzle.trace(board).solved) return { ok: false, word: 'solved-at-start' };
  const min = puzzle.minRotations(board);
  if (min < 1 || min !== level.minRotations) return { ok: false, word: 'bad-minRot' };
  const steps = puzzle.solution(board);
  const total = steps.reduce((sum, s) => sum + s.turns, 0);
  let after = board;
  for (const s of steps) after = puzzle.rotate(after, s.r, s.c, s.turns);
  if (total !== min || !puzzle.trace(after).solved) return { ok: false, word: 'UNSOLVABLE' };
  return { ok: true, word: 'solvable' };
}

let failed = 0;
for (const level of puzzle.levels()) {
  const { board } = level;
  const rotatable = board.tiles.filter((t) => t.rotatable).length;
  const v = verdict(level);
  if (!v.ok) failed++;
  console.log(
    `${level.id} rows=${board.rows} cols=${board.cols} rotatable=${rotatable} minRot=${level.minRotations} ${v.word}`,
  );
}
const dates = process.argv.slice(2);
for (const date of dates.length ? dates : DEFAULT_DATES) {
  const level = puzzle.daily(date);
  const { board } = level;
  const v = verdict(level);
  if (!v.ok) failed++;
  console.log(
    `daily ${date} rows=${board.rows} cols=${board.cols} minRot=${level.minRotations} hash=${boardHash(board)} ${v.word}`,
  );
}
process.exitCode = failed ? 1 : 0;
