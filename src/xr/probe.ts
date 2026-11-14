/**
 * Reads the world: head pose, the visible index finger tip, the pinch points
 * of tracked hands, and table candidates from plane detection and hit testing. Converts XR poses from the
 * session reference space to world space through the player origin.
 */
import { Vector3, type World } from '@iwsdk/core';
import type { TableSurface } from '../test-api.ts';
import { yawDegOfForward } from './arc.ts';
import { pinchPoint, type PinchPoint } from './pinch.ts';
import {
  chooseTable,
  isTableHeight,
  VIRTUAL_TABLE_HEIGHT,
  type HitCandidate,
  type PlaneCandidate,
} from './table.ts';

export interface HeadPose {
  position: Vector3;
  /** Unit forward vector (where the face points). */
  forward: Vector3;
  yawDeg: number;
}

const tmpHeadPos = new Vector3();
const tmpHeadFwd = new Vector3();

/** Head in world space: the tracked head in XR, the camera otherwise. */
export function readHead(world: World): HeadPose {
  if (world.session) {
    const head = world.player.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(tmpHeadPos);
    // Object3D.getWorldDirection gives +Z; the face looks down -Z.
    head.getWorldDirection(tmpHeadFwd).multiplyScalar(-1);
  } else {
    world.camera.updateWorldMatrix(true, false);
    world.camera.getWorldPosition(tmpHeadPos);
    world.camera.getWorldDirection(tmpHeadFwd);
  }
  return {
    position: tmpHeadPos.clone(),
    forward: tmpHeadFwd.clone().normalize(),
    yawDeg: yawDegOfForward(tmpHeadFwd.x, tmpHeadFwd.z),
  };
}

function refToWorld(world: World, p: DOMPointReadOnly): Vector3 {
  world.player.updateWorldMatrix(true, false);
  return world.player.localToWorld(new Vector3(p.x, p.y, p.z));
}

/**
 * World position of a visible index finger tip, right hand first, or null
 * when no hand is tracked this frame.
 */
export function readIndexTip(world: World): { x: number; y: number; z: number } | null {
  const session = world.session;
  const frame = world.xrFrame;
  const ref = world.xrReferenceSpace;
  if (!session || !frame || !ref || !frame.getJointPose) {
    return null;
  }
  const hands = Array.from(session.inputSources).filter((s) => s.hand);
  hands.sort((a, b) => (a.handedness === 'right' ? -1 : 0) - (b.handedness === 'right' ? -1 : 0));
  for (const source of hands) {
    const joint = source.hand?.get('index-finger-tip');
    if (!joint) {
      continue;
    }
    const pose = frame.getJointPose(joint, ref);
    if (pose) {
      const p = refToWorld(world, pose.transform.position);
      return { x: p.x, y: p.y, z: p.z };
    }
  }
  return null;
}

export interface HandPinch extends PinchPoint {
  handedness: XRHandedness;
}

/**
 * Pinch points (thumb tip and index tip midpoint) of every tracked hand this
 * frame, world space. Empty outside XR or without hand joints.
 */
export function readPinchPoints(world: World): HandPinch[] {
  const session = world.session;
  const frame = world.xrFrame;
  const ref = world.xrReferenceSpace;
  if (!session || !frame || !ref || !frame.getJointPose) {
    return [];
  }
  const out: HandPinch[] = [];
  for (const source of session.inputSources) {
    const hand = source.hand;
    const thumbJoint = hand?.get('thumb-tip');
    const indexJoint = hand?.get('index-finger-tip');
    if (!thumbJoint || !indexJoint) {
      continue;
    }
    const thumbPose = frame.getJointPose(thumbJoint, ref);
    const indexPose = frame.getJointPose(indexJoint, ref);
    if (!thumbPose || !indexPose) {
      continue;
    }
    const thumb = refToWorld(world, thumbPose.transform.position);
    const index = refToWorld(world, indexPose.transform.position);
    out.push({ handedness: source.handedness, ...pinchPoint(thumb, index) });
  }
  return out;
}

/** True when a hand is tracked, false when only controllers or nothing. */
export function handsPresent(world: World): boolean {
  const s = world.session;
  return !!s && Array.from(s.inputSources).some((src) => !!src.hand);
}

export function controllersPresent(world: World): boolean {
  const s = world.session;
  return !!s && Array.from(s.inputSources).some((src) => !src.hand && !!src.gamepad);
}

function polygonArea(points: readonly DOMPointReadOnly[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/**
 * Collects table candidates while calibration runs, then picks one with
 * chooseTable. Plane detection and hit testing are optional session
 * features: when the browser does not grant them the probe simply finds
 * nothing and the virtual table is used. Permission prompts are only logged.
 */
export class TableProbe {
  private planes = new Map<XRPlane, PlaneCandidate>();
  private hit: HitCandidate | null = null;
  private hitSource: XRHitTestSource | undefined;
  private requesting = false;
  private active = false;

  start(world: World): void {
    this.planes.clear();
    this.hit = null;
    this.active = true;
    const session = world.session;
    if (!session || this.requesting || this.hitSource) {
      return;
    }
    if (typeof XRRay === 'undefined') {
      console.info('[reachfit] hit test unavailable: no XRRay');
      return;
    }
    this.requesting = true;
    void session
      .requestReferenceSpace('viewer')
      .then((viewer) => {
        // Forward and down, so a table in front of a seated player is hit.
        const ray = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.6, z: -0.8, w: 0 });
        return world.requestHitTestSource({ space: viewer, offsetRay: ray });
      })
      .then((source) => {
        this.hitSource = source;
        console.info(`[reachfit] hit test source ${source ? 'ready' : 'not granted'}`);
      })
      .catch((error: unknown) => {
        console.info('[reachfit] hit test request failed (feature not granted?)', error);
      })
      .finally(() => {
        this.requesting = false;
      });
  }

  /** Call once per frame while active. */
  update(world: World, head: HeadPose): void {
    if (!this.active) {
      return;
    }
    const frame = world.xrFrame;
    const ref = world.xrReferenceSpace;
    if (!frame || !ref) {
      return;
    }
    const detected = frame.detectedPlanes;
    if (detected) {
      for (const plane of detected) {
        if (plane.orientation !== 'horizontal') {
          continue;
        }
        const pose = frame.getPose(plane.planeSpace, ref);
        if (!pose) {
          continue;
        }
        const p = refToWorld(world, pose.transform.position);
        this.planes.set(plane, {
          height: p.y,
          horizontal: true,
          distance: Math.hypot(p.x - head.position.x, p.z - head.position.z),
          area: polygonArea(plane.polygon),
        });
      }
    }
    if (this.hitSource) {
      const [result] = world.getHitTestResults(this.hitSource);
      const pose = result?.getPose(ref);
      if (pose) {
        const p = refToWorld(world, pose.transform.position);
        if (isTableHeight(p.y) || !this.hit) {
          this.hit = { height: p.y };
        }
      }
    }
  }

  /** Picks the surface from what was seen so far and stops sampling. */
  decide(): TableSurface {
    this.active = false;
    const surface = chooseTable([...this.planes.values()], this.hit, VIRTUAL_TABLE_HEIGHT);
    console.info(
      `[reachfit] table ${surface.source} ${surface.height.toFixed(3)} m (planes ${this.planes.size}, hit ${this.hit ? this.hit.height.toFixed(3) : 'none'})`,
    );
    return surface;
  }

  stop(): void {
    this.active = false;
    this.hitSource?.cancel();
    this.hitSource = undefined;
  }
}
