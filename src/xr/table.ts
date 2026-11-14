/**
 * Which table surface the board sits on. Pure, so Node tests import it.
 *
 * Order: a detected horizontal plane at table height, then a hit test result
 * at table height, then a virtual table.
 */
import type { TableSurface } from '../test-api.ts';

/** Heights accepted as a table top, meters above the floor. Design value. */
export const TABLE_MIN_HEIGHT = 0.6;
export const TABLE_MAX_HEIGHT = 0.9;
/** Virtual table height when nothing is found, m. Design value. */
export const VIRTUAL_TABLE_HEIGHT = 0.72;

export interface PlaneCandidate {
  /** Height of the plane above the floor, m. */
  height: number;
  horizontal: boolean;
  /** Horizontal distance from the player's head to the plane center, m. Optional. */
  distance?: number;
  /** Plane area in square meters. Optional. */
  area?: number;
}

export interface HitCandidate {
  height: number;
}

export function isTableHeight(height: number): boolean {
  return height >= TABLE_MIN_HEIGHT && height <= TABLE_MAX_HEIGHT;
}

/**
 * Picks the surface. Among usable planes the nearest one wins (then the
 * larger one). A hit is used only when no plane qualifies. `fallback` is
 * the virtual table height.
 */
export function chooseTable(
  planes: readonly PlaneCandidate[],
  hit: HitCandidate | null,
  fallback: number = VIRTUAL_TABLE_HEIGHT,
): TableSurface {
  const usable = planes.filter((p) => p.horizontal && isTableHeight(p.height));
  if (usable.length > 0) {
    const best = [...usable].sort((a, b) => {
      const da = a.distance ?? Infinity;
      const db = b.distance ?? Infinity;
      if (da !== db) {
        return da - db;
      }
      return (b.area ?? 0) - (a.area ?? 0);
    })[0];
    return { height: best.height, source: 'plane' };
  }
  if (hit && isTableHeight(hit.height)) {
    return { height: hit.height, source: 'hit-test' };
  }
  return { height: fallback, source: 'virtual' };
}
