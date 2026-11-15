/**
 * Head gaze dwell timer. Pure, so Node tests drive it.
 *
 * Looking at the same target for DWELL_MS fires once. Targets that repeat
 * (tiles) fire again every DWELL_REPEAT_MS while the look stays. Targets that
 * do not repeat (buttons) need the look to leave and come back. A short
 * dropout (GAZE_GRACE_MS) keeps the timer, so head jitter at an edge does not
 * restart it.
 *
 * The Look button changes the look time (setTiming); DWELL_MS and
 * DWELL_REPEAT_MS are the defaults.
 */

/** Look time before the first action, ms. Design value (task spec). */
export const DWELL_MS = 800;
/** Time between repeated turns while the look stays on a tile, ms. Design value (task spec). */
export const DWELL_REPEAT_MS = 1200;
/** A target lost for less than this keeps its timer, ms. Design value. */
export const GAZE_GRACE_MS = 150;

export interface DwellState {
  /** Target the timer is on, or null. */
  target: string | null;
  /** 0 to 1 toward the next action. */
  progress: number;
  /** True on the frame an action fires. */
  fire: boolean;
}

export class DwellTimer {
  private target: string | null = null;
  private cycleStart = -1;
  private cycleLength = DWELL_MS;
  private armed = true;
  private lastSeen = -1;
  private dwellMs = DWELL_MS;
  private repeatMs = DWELL_REPEAT_MS;
  private holdNextLook = false;

  constructor(dwellMs = DWELL_MS, repeatMs = DWELL_REPEAT_MS) {
    this.setTiming(dwellMs, repeatMs);
  }

  /** Look time before the first action and between repeats, ms. Applies from the next look. */
  setTiming(dwellMs: number, repeatMs: number): void {
    this.dwellMs = dwellMs;
    this.repeatMs = repeatMs;
  }

  /** Look time before the first action, ms. */
  get lookMs(): number {
    return this.dwellMs;
  }

  /** Forget the current target (after a board change, for example). */
  reset(): void {
    this.target = null;
    this.cycleStart = -1;
    this.armed = true;
    this.lastSeen = -1;
  }

  /**
   * Forget the current target unless keep(target) says otherwise. A kept
   * target keeps its timer and whether it may fire. Used on a board change:
   * tiles are rebuilt, but a button that just fired (Restart) must not fire
   * again while the look is still on it.
   */
  resetUnless(keep: (target: string) => boolean): void {
    if (this.target !== null && keep(this.target)) {
      return;
    }
    this.reset();
  }

  /**
   * Whatever the look rests on at the next update must not fire until the
   * look leaves and comes back. Called when the board and panel appear: they
   * can land under a look that was already resting there (seen in the capture
   * of 11-15: the look of the sweep fell on 'Set reach again' and restarted
   * the setup 0.8 s after the board appeared).
   */
  holdNext(): void {
    this.holdNextLook = true;
  }

  /**
   * When the look is on `target`, stop it from firing until the look leaves
   * and comes back. Used when a hand already acted on the tile (pinch, ray,
   * controller) or is touching it, so the same look does not add a second turn.
   */
  holdIfOn(target: string): void {
    if (this.target === target) {
      this.armed = false;
    }
  }

  update(hit: string | null, t: number, repeats: (target: string) => boolean): DwellState {
    let current = hit;
    if (current === null && this.target !== null && t - this.lastSeen < GAZE_GRACE_MS) {
      current = this.target;
    }
    if (hit !== null) {
      this.lastSeen = t;
    }
    if (current !== this.target) {
      this.target = current;
      this.cycleStart = t;
      this.cycleLength = this.dwellMs;
      this.armed = true;
    }
    if (this.holdNextLook) {
      this.holdNextLook = false;
      if (current !== null) {
        this.armed = false;
      }
    }
    if (current === null || !this.armed) {
      return { target: current, progress: 0, fire: false };
    }
    const elapsed = t - this.cycleStart;
    if (elapsed >= this.cycleLength) {
      if (repeats(current)) {
        this.cycleStart = t;
        this.cycleLength = this.repeatMs;
      } else {
        this.armed = false;
      }
      return { target: current, progress: 1, fire: true };
    }
    return { target: current, progress: elapsed / this.cycleLength, fire: false };
  }
}
