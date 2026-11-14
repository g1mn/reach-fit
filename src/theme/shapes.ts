/**
 * Flat shapes in the XZ plane (up is +Y), built as plain BufferGeometry.
 *
 * Every triangle faces +Y. Angles run clockwise seen from above, starting at
 * N (-Z): angle 0 is N, a quarter turn is E (+X). That matches Rotation in
 * src/puzzle/types.ts.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';

/** [x0, z0, x1, z1] with x0 < x1 and z0 < z1. */
export type Rect = readonly [number, number, number, number];

class Builder {
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }

  /** Adds a triangle, flipping it if needed so it faces +Y. */
  tri(a: number, b: number, c: number): void {
    const p = this.pos;
    const abx = p[b * 3] - p[a * 3];
    const abz = p[b * 3 + 2] - p[a * 3 + 2];
    const acx = p[c * 3] - p[a * 3];
    const acz = p[c * 3 + 2] - p[a * 3 + 2];
    // y of (b - a) x (c - a)
    const ny = abz * acx - abx * acz;
    if (ny >= 0) {
      this.idx.push(a, b, c);
    } else {
      this.idx.push(a, c, b);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Point at clockwise angle `a` (radians from N) and radius r. */
function polar(a: number, r: number): [number, number] {
  return [Math.sin(a) * r, -Math.cos(a) * r];
}

export function rectsGeometry(rects: readonly Rect[], y: number): BufferGeometry {
  const b = new Builder();
  for (const [x0, z0, x1, z1] of rects) {
    const v0 = b.vertex(x0, y, z0);
    const v1 = b.vertex(x1, y, z0);
    const v2 = b.vertex(x1, y, z1);
    const v3 = b.vertex(x0, y, z1);
    b.tri(v0, v1, v2);
    b.tri(v0, v2, v3);
  }
  return b.build();
}

export function discGeometry(radius: number, y: number, segments = 32): BufferGeometry {
  const b = new Builder();
  const center = b.vertex(0, y, 0);
  const rim: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const [x, z] = polar((i / segments) * Math.PI * 2, radius);
    rim.push(b.vertex(x, y, z));
  }
  for (let i = 0; i < segments; i += 1) {
    b.tri(center, rim[i], rim[(i + 1) % segments]);
  }
  return b.build();
}

/**
 * Ring from N clockwise. Each segment is exactly 6 indices, in order, so
 * setDrawRange(0, 6 * k) shows the first k segments (a progress arc).
 */
export function ringGeometry(
  inner: number,
  outer: number,
  y: number,
  segments = 48,
): BufferGeometry {
  const b = new Builder();
  const ins: number[] = [];
  const outs: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const [xi, zi] = polar(a, inner);
    const [xo, zo] = polar(a, outer);
    ins.push(b.vertex(xi, y, zi));
    outs.push(b.vertex(xo, y, zo));
  }
  for (let i = 0; i < segments; i += 1) {
    b.tri(ins[i], outs[i], outs[i + 1]);
    b.tri(ins[i], outs[i + 1], ins[i + 1]);
  }
  return b.build();
}

/** Star with `points` tips, one tip pointing N. */
export function starGeometry(
  outer: number,
  inner: number,
  y: number,
  points = 5,
): BufferGeometry {
  const b = new Builder();
  const center = b.vertex(0, y, 0);
  const rim: number[] = [];
  const n = points * 2;
  for (let i = 0; i < n; i += 1) {
    const [x, z] = polar((i / n) * Math.PI * 2, i % 2 === 0 ? outer : inner);
    rim.push(b.vertex(x, y, z));
  }
  for (let i = 0; i < n; i += 1) {
    b.tri(center, rim[i], rim[(i + 1) % n]);
  }
  return b.build();
}

/** Two crossing bars, like an X, `half` from the center to each tip. */
export function crossGeometry(half: number, width: number, y: number): BufferGeometry {
  const b = new Builder();
  const w = width / 2;
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const corners: [number, number][] = [
      [-half, -w],
      [half, -w],
      [half, w],
      [-half, w],
    ];
    const v = corners.map(([u, t]) => b.vertex(u * c - t * s, y, u * s + t * c));
    b.tri(v[0], v[1], v[2]);
    b.tri(v[0], v[2], v[3]);
  }
  return b.build();
}

/** Square frame between half sizes `inner` and `outer`. */
export function frameGeometry(inner: number, outer: number, y: number): BufferGeometry {
  return rectsGeometry(
    [
      [-outer, -outer, outer, -inner],
      [-outer, inner, outer, outer],
      [-outer, -inner, -inner, inner],
      [inner, -inner, outer, inner],
    ],
    y,
  );
}
