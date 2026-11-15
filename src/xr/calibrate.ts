/**
 * Reach calibration flow, as a pure state machine fed once per frame.
 *
 * hand: the player sweeps one hand across the table. Samples are collected
 *   while a hand tip is visible; the sweep ends when the hand rests or leaves.
 *   A rejected sweep (radius out of range, too short, not round) restarts it.
 *   If no sweep movement comes for HAND_WAIT_MS, the flow moves to gaze. That
 *   covers both no hand in view and a tracked hand that stays still (resting
 *   in the lap, or a player who cannot sweep), so nobody gets stuck here.
 * gaze-left / gaze-right: the player looks at the left edge and holds, then
 *   the right edge and holds (GAZE_HOLD_MS each). Radius is the default.
 * If gaze does not finish in GAZE_MAX_MS, the default arc is used.
 *
 * No three.js here, so Node tests drive it with synthetic frames.
 */
import type { ReachArc } from '../test-api.ts';
import {
  arcFromGaze,
  arcFromSweep,
  defaultArc,
  DEFAULT_REACH_RADIUS,
  dirFromDeg,
  type Point2,
  type SweepRejectReason,
  wrapDeg,
} from './arc.ts';

/** No sweep movement (hand absent or still) for this long switches to the gaze path, ms. Design value (task spec). */
export const HAND_WAIT_MS = 10000;
/** Head held still this long counts as looking at an edge, ms. Design value (task spec). */
export const GAZE_HOLD_MS = 800;
/** Head yaw may wobble this much during a hold, degrees. Design value. */
export const GAZE_STABLE_DEG = 3;
/** An edge must be at least this far from the starting direction, degrees. Design value. */
export const GAZE_MIN_TURN_DEG = 10;
/** Gaze path gives up after this long and uses the default arc, ms. Design value. */
export const GAZE_MAX_MS = 20000;
/** Hand movement below this is not a new sample, m. Design value. */
export const SAMPLE_MIN_STEP = 0.01;
/** A sweep needs this much hand travel before it can end, m. Design value. */
export const SWEEP_MIN_PATH = 0.2;
/** Hand resting this long ends a sweep, ms. Design value. */
export const SWEEP_SETTLE_MS = 700;
/** A sweep is evaluated after this long even if the hand keeps moving, ms. Design value. */
export const SWEEP_MAX_MS = 8000;
/**
 * The hand counts as moving (holds off the gaze path) only once it is this far
 * from where the current sweep started, so tracking jitter of a resting hand
 * does not keep the flow waiting. m. Design value.
 */
export const SWEEP_PROGRESS_SPAN = 0.05;
/**
 * A failed sweep that got at least this far from its start is a real try: it
 * shows the retry message and gives a fresh HAND_WAIT_MS. Smaller ones are
 * dropped silently. m. Design value.
 */
export const SWEEP_ATTEMPT_SPAN = 0.1;

export type CalibratePhase = 'hand' | 'gaze-left' | 'gaze-right' | 'done';

export interface CalibrateInput {
  /** ms */
  t: number;
  /** Visible index tip in world meters, or null. */
  hand: { x: number; y: number; z: number } | null;
  /** Head position (x, z) and yaw in degrees (0 = -z, positive = left). Null when untracked. */
  head: { x: number; z: number; yawDeg: number } | null;
  /** Table top height, m. */
  tableY: number;
}

export type CalibrateEvent =
  | { type: 'phase'; phase: CalibratePhase }
  | { type: 'sample'; x: number; y: number; z: number; source: 'hand' | 'gaze' }
  | { type: 'rejected'; reason: SweepRejectReason }
  | { type: 'progress'; value: number }
  | { type: 'done'; arc: ReachArc };

export class ReachCalibrator {
  phase: CalibratePhase = 'hand';
  arc: ReachArc | null = null;
  /** Edge hold on the gaze path, ms. The Look button sets it with the tile look time. */
  holdMs = GAZE_HOLD_MS;
  private phaseStart = -1;
  /** Last time the hand was SWEEP_PROGRESS_SPAN or more from its sweep start. Not cleared by resetSweep. */
  private lastMove = -1;
  private sweepFirst: Point2 | null = null;
  private sweepSpan = 0;
  private samples: Point2[] = [];
  private lastSample: { x: number; y: number; z: number } | null = null;
  private lastSampleAt = -1;
  private sweepStart = -1;
  private path = 0;
  private yaw0 = 0;
  private holdYaw = 0;
  private holdStart = -1;
  private leftDeg = 0;
  private lastHead: Point2 = { x: 0, z: 0 };

  /** Restart from the hand phase (the 'Set reach again' button). */
  restart(): void {
    this.phase = 'hand';
    this.arc = null;
    this.phaseStart = -1;
    this.lastMove = -1;
    this.resetSweep();
    this.holdStart = -1;
  }

  /** Skip straight to the default arc (no XR session, for example). */
  finishDefault(input: CalibrateInput): CalibrateEvent[] {
    const head = input.head ?? { x: 0, z: 0, yawDeg: 0 };
    return this.finish(defaultArc({ x: head.x, z: head.z }, input.tableY, head.yawDeg));
  }

  update(input: CalibrateInput): CalibrateEvent[] {
    if (this.phase === 'done') {
      return [];
    }
    const out: CalibrateEvent[] = [];
    if (this.phaseStart < 0) {
      this.phaseStart = input.t;
      out.push({ type: 'phase', phase: this.phase });
    }
    if (input.head) {
      this.lastHead = { x: input.head.x, z: input.head.z };
    }
    if (this.phase === 'hand') {
      this.updateHand(input, out);
    } else {
      this.updateGaze(input, out);
    }
    return out;
  }

  private resetSweep(): void {
    this.samples = [];
    this.lastSample = null;
    this.lastSampleAt = -1;
    this.sweepStart = -1;
    this.path = 0;
    this.sweepFirst = null;
    this.sweepSpan = 0;
  }

  private finish(arc: ReachArc): CalibrateEvent[] {
    this.arc = arc;
    this.phase = 'done';
    return [
      { type: 'phase', phase: 'done' },
      { type: 'done', arc },
    ];
  }

  private enter(phase: CalibratePhase, t: number, out: CalibrateEvent[]): void {
    this.phase = phase;
    this.phaseStart = t;
    this.holdStart = -1;
    out.push({ type: 'phase', phase });
  }

  private updateHand(input: CalibrateInput, out: CalibrateEvent[]): void {
    const { t, hand } = input;
    if (hand) {
      const last = this.lastSample;
      const step = last ? Math.hypot(hand.x - last.x, hand.y - last.y, hand.z - last.z) : Infinity;
      if (step >= SAMPLE_MIN_STEP) {
        if (this.sweepStart < 0 || !this.sweepFirst) {
          this.sweepStart = t;
          this.sweepFirst = { x: hand.x, z: hand.z };
        }
        if (last) {
          this.path += step;
        }
        this.sweepSpan = Math.max(
          this.sweepSpan,
          Math.hypot(hand.x - this.sweepFirst.x, hand.z - this.sweepFirst.z),
        );
        if (this.sweepSpan >= SWEEP_PROGRESS_SPAN) {
          this.lastMove = t;
        }
        this.lastSample = { ...hand };
        this.lastSampleAt = t;
        this.samples.push({ x: hand.x, z: hand.z });
        out.push({ type: 'sample', x: hand.x, y: hand.y, z: hand.z, source: 'hand' });
      }
    }
    if (this.sweepStart >= 0) {
      const rested = t - this.lastSampleAt >= SWEEP_SETTLE_MS;
      const tooLong = t - this.sweepStart >= SWEEP_MAX_MS;
      if ((rested && this.path >= SWEEP_MIN_PATH) || tooLong) {
        const result = arcFromSweep(this.samples, input.tableY, this.lastHead);
        if (result.ok) {
          out.push(...this.finish(result.arc));
          return;
        }
        if (this.sweepSpan >= SWEEP_ATTEMPT_SPAN) {
          out.push({ type: 'rejected', reason: result.reason });
          this.phaseStart = t;
        }
        this.resetSweep();
      } else if (rested && (!hand || t - this.lastSampleAt >= 3 * SWEEP_SETTLE_MS)) {
        // Hand left or stopped before a real sweep: drop the partial samples.
        this.resetSweep();
      }
    }
    // Count from the last real hand movement or the phase start. A sweep that
    // is moving keeps lastMove fresh, so it is never cut short.
    const since = Math.max(this.lastMove, this.phaseStart);
    if (t - since >= HAND_WAIT_MS) {
      this.resetSweep();
      this.yaw0 = input.head ? input.head.yawDeg : 0;
      this.enter('gaze-left', t, out);
    }
  }

  private updateGaze(input: CalibrateInput, out: CalibrateEvent[]): void {
    const { t, head } = input;
    if (t - this.phaseStart >= GAZE_MAX_MS) {
      out.push(...this.finish(defaultArc(this.lastHead, input.tableY, this.yaw0)));
      return;
    }
    if (!head) {
      this.holdStart = -1;
      out.push({ type: 'progress', value: 0 });
      return;
    }
    const turn = wrapDeg(head.yawDeg - this.yaw0);
    const wanted =
      this.phase === 'gaze-left' ? turn >= GAZE_MIN_TURN_DEG : turn <= -GAZE_MIN_TURN_DEG;
    if (!wanted) {
      this.holdStart = -1;
      out.push({ type: 'progress', value: 0 });
      return;
    }
    if (this.holdStart < 0 || Math.abs(wrapDeg(head.yawDeg - this.holdYaw)) > GAZE_STABLE_DEG) {
      this.holdStart = t;
      this.holdYaw = head.yawDeg;
    }
    const held = t - this.holdStart;
    out.push({ type: 'progress', value: Math.min(1, held / this.holdMs) });
    if (held < this.holdMs) {
      return;
    }
    const d = dirFromDeg(this.holdYaw);
    out.push({
      type: 'sample',
      x: head.x + d.x * DEFAULT_REACH_RADIUS,
      y: input.tableY,
      z: head.z + d.z * DEFAULT_REACH_RADIUS,
      source: 'gaze',
    });
    if (this.phase === 'gaze-left') {
      this.leftDeg = this.holdYaw;
      // Each edge gets its own GAZE_MAX_MS.
      this.enter('gaze-right', t, out);
      return;
    }
    out.push(
      ...this.finish(arcFromGaze({ x: head.x, z: head.z }, input.tableY, this.leftDeg, this.holdYaw)),
    );
  }
}
