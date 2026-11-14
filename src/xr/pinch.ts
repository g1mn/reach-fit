/**
 * Near pinch: which tile a hand pinch on the board means. Pure, so Node tests
 * import it.
 *
 * The pinch point is the midpoint of the thumb tip and the index tip, the spot
 * the player sees between the two fingers. A pinch whose point is over the
 * board picks the tile whose center is nearest on the table plane.
 *
 * Why not the grab pointer alone: it is a 0.07 m sphere around the hand's grip
 * space (the palm), and picks the nearest grabbable to the palm. With tiles
 * TILE_SIZE apart the palm often hangs over the neighbouring tile. Seen in the
 * emulator on 2026-11-10 (MV04): 9 pinches aimed at Tile_1_1 with the fingers
 * down all selected Tile_2_2, whose grip box was the nearest to the palm.
 */
import { TILE_SIZE } from './arc.ts';

/** Pinch point height window over the board surface, m. Below zero allows tracking dips. Design value. */
export const NEAR_PINCH_MIN_HEIGHT = -0.03;
export const NEAR_PINCH_MAX_HEIGHT = 0.12;
/**
 * A pinch picks a tile only within this distance of its center on the table
 * plane, m. Inside the grid the nearest center is never further than half the
 * cell diagonal (about 0.71 x TILE_SIZE), so this covers the whole board and a
 * thin rim. Design value.
 */
export const PINCH_PICK_RADIUS = TILE_SIZE * 0.75;
/** Within this distance of any tile center a pinch counts as on the board, m. Design value. */
export const NEAR_ZONE_RADIUS = TILE_SIZE * 1.5;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CellCenter {
  r: number;
  c: number;
  /** Cell center on the table plane, world meters. */
  x: number;
  z: number;
}

export interface PinchPoint extends Vec3 {
  /** Thumb tip to index tip distance, m. */
  gap: number;
}

export interface PinchPick {
  /** True when the pinch point is on or right next to the board, so the near path owns the pinch. */
  near: boolean;
  /** The picked cell, or null when the pinch is off the board or beside it. */
  cell: { r: number; c: number } | null;
  /** Distance on the table plane to the nearest cell center, m. Infinity without cells. */
  distance: number;
}

/** Midpoint of the thumb tip and the index tip, and their distance. */
export function pinchPoint(thumb: Vec3, index: Vec3): PinchPoint {
  return {
    x: (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
    z: (thumb.z + index.z) / 2,
    gap: Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z),
  };
}

/** The cell a pinch at `point` means, given the cell centers and the board surface height. */
export function pickByPinch(point: Vec3, cells: readonly CellCenter[], surfaceY: number): PinchPick {
  let best: CellCenter | null = null;
  let distance = Infinity;
  for (const cell of cells) {
    const d = Math.hypot(point.x - cell.x, point.z - cell.z);
    if (d < distance) {
      distance = d;
      best = cell;
    }
  }
  const h = point.y - surfaceY;
  const inHeight = h >= NEAR_PINCH_MIN_HEIGHT && h <= NEAR_PINCH_MAX_HEIGHT;
  if (!best || !inHeight || distance > NEAR_ZONE_RADIUS) {
    return { near: false, cell: null, distance };
  }
  return {
    near: true,
    cell: distance <= PINCH_PICK_RADIUS ? { r: best.r, c: best.c } : null,
    distance,
  };
}

/** Of several hands, the one pinching hardest (smallest gap), or null. */
export function pinchingHand<T extends { gap: number }>(hands: readonly T[]): T | null {
  let best: T | null = null;
  for (const h of hands) {
    if (!best || h.gap < best.gap) {
      best = h;
    }
  }
  return best;
}
