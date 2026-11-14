/**
 * Mis-grab detection. Pure, so Node tests import it.
 *
 * This is a proxy metric, not ground truth: the app cannot know what the
 * player meant to touch. Two signals are counted:
 *  1. 'not-rotatable': the player selected a tile that cannot turn.
 *  2. 'undone-within-2s': the player turned a tile and, within UNDO_WINDOW_MS
 *     of the first turn, brought it back to the shape it had before. Shape
 *     means the set of open sides, so symmetry counts: a straight tile is back
 *     after two turns, a corner after four. A turn that changes nothing (a
 *     cross) starts no undo.
 */
import { DIRS, OPENINGS } from '../puzzle/types.ts';
import type { Tile, TileKind } from '../puzzle/types.ts';

/** Undo window, ms. Design value (from the task spec). */
export const UNDO_WINDOW_MS = 2000;

export type MisGrabReason = 'not-rotatable' | 'undone-within-2s';

/** Open sides as a 4-bit mask (bit 0 N, 1 E, 2 S, 3 W) for a kind at a rotation. */
export function shapeMask(kind: TileKind, rot: number): number {
  let mask = 0;
  for (const d of OPENINGS[kind]) {
    mask |= 1 << ((DIRS.indexOf(d) + rot) % 4);
  }
  return mask;
}

/** Rule 1. Returns the reason when selecting this tile is a mis-grab. */
export function selectMisGrab(tile: Pick<Tile, 'rotatable'>): MisGrabReason | null {
  return tile.rotatable ? null : 'not-rotatable';
}

interface Burst {
  t0: number;
  shape0: number;
  changed: boolean;
}

/** Rule 2. Feed every turn in time order; reset() on a new board. */
export class MisGrabTracker {
  private readonly bursts = new Map<string, Burst>();

  /**
   * @param key tile id, e.g. Tile_r_c
   * @param shapeBefore shapeMask before this turn
   * @param shapeAfter shapeMask after this turn
   * @param t time in ms
   */
  onTurn(key: string, shapeBefore: number, shapeAfter: number, t: number): MisGrabReason | null {
    let b = this.bursts.get(key);
    if (!b || t - b.t0 > UNDO_WINDOW_MS) {
      b = { t0: t, shape0: shapeBefore, changed: false };
      this.bursts.set(key, b);
    }
    if (shapeAfter !== b.shape0) {
      b.changed = true;
      return null;
    }
    if (b.changed) {
      this.bursts.delete(key);
      return 'undone-within-2s';
    }
    return null;
  }

  reset(): void {
    this.bursts.clear();
  }
}
