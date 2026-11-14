/** Synthetic sweeps for the XR tests. */
import { dirFromDeg, type Point2 } from '../../src/xr/arc.ts';

/** Small deterministic random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Sweep {
  center: Point2;
  radius: number;
  fromDeg: number;
  toDeg: number;
  points: Point2[];
}

/**
 * Points on a circle around `center` from fromDeg to toDeg every stepDeg,
 * each moved by up to `noise` meters in x and z.
 */
export function sweep(
  center: Point2,
  radius: number,
  fromDeg: number,
  toDeg: number,
  noise: number,
  seed: number,
  stepDeg = 2,
): Sweep {
  const rand = rng(seed);
  const points: Point2[] = [];
  for (let a = fromDeg; a <= toDeg + 1e-9; a += stepDeg) {
    const d = dirFromDeg(a);
    points.push({
      x: center.x + d.x * radius + (rand() * 2 - 1) * noise,
      z: center.z + d.z * radius + (rand() * 2 - 1) * noise,
    });
  }
  return { center, radius, fromDeg, toDeg, points };
}
