/**
 * Capture clock (MV07).
 *
 * src/index.ts imports this module only when import.meta.env.VITE_CAPTURE is
 * '1', and before the world is created, so a normal build never contains it.
 * Only the capture folder's tasks edit this folder.
 *
 * The page starts on the real clock, so the app, the emulator and its room
 * load as usual. The CDP driver (/capture/capture.mjs) then calls
 * window.__cap.freeze(), and for every recorded frame window.__cap.step(ms)
 * followed by a screenshot. step() moves the clock exactly ms and runs the
 * queued requestAnimationFrame callbacks once. The emulator's XR frame loop
 * asks window.requestAnimationFrame for its next frame and reads
 * performance.now(), so one step is one XR frame however long the headless
 * render takes, and every recorded frame is exactly ms apart.
 *
 * Replaced: requestAnimationFrame, cancelAnimationFrame, performance.now.
 * Not replaced: setTimeout, setInterval, Date.now (they stay on the real clock).
 */

export interface CaptureClock {
  /** True after freeze() until thaw(). */
  readonly frozen: boolean;
  /** Frames run by step() since the page loaded. */
  readonly frames: number;
  /** The clock in ms: what performance.now() returns now. */
  now(): number;
  /** Stop following the real clock. Frames then run only through step(). Returns now(). */
  freeze(): number;
  /** Follow the real clock again, continuing from now() without a jump. Returns now(). */
  thaw(): number;
  /**
   * Move the clock by ms (default one 30 fps frame) and run one frame.
   * Freezes first if needed. Resolves with the number of callbacks run.
   */
  step(ms?: number): Promise<number>;
}

declare global {
  interface Window {
    __cap?: CaptureClock;
  }
}

const FRAME_MS = 1000 / 30;

const nativeRaf = window.requestAnimationFrame.bind(window);
const nativeNow = performance.now.bind(performance);

let queue = new Map<number, FrameRequestCallback>();
let nextId = 1;
let frozen = false;
let frames = 0;
/** Real mode: clock = nativeNow() + offset. Nonzero only after a thaw(). */
let offset = 0;
/** Frozen mode: the clock itself. */
let frozenAt = 0;
let pumpPending = false;

const now = (): number => (frozen ? frozenAt : nativeNow() + offset);

function runQueue(t: number): number {
  const batch = queue;
  queue = new Map();
  for (const callback of batch.values()) {
    try {
      callback(t);
    } catch (err) {
      console.error(err);
    }
  }
  return batch.size;
}

function pump(): void {
  pumpPending = false;
  if (!frozen) runQueue(now());
}

function schedulePump(): void {
  if (frozen || pumpPending) return;
  pumpPending = true;
  nativeRaf(pump);
}

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const id = nextId++;
  queue.set(id, callback);
  schedulePump();
  return id;
};

window.cancelAnimationFrame = (id: number): void => {
  queue.delete(id);
};

Object.defineProperty(performance, 'now', {
  configurable: true,
  writable: true,
  value: now,
});

const clock: CaptureClock = {
  get frozen() {
    return frozen;
  },
  get frames() {
    return frames;
  },
  now,
  freeze() {
    if (!frozen) {
      frozenAt = now();
      frozen = true;
    }
    return frozenAt;
  },
  thaw() {
    if (frozen) {
      offset = frozenAt - nativeNow();
      frozen = false;
      schedulePump();
    }
    return now();
  },
  async step(ms = FRAME_MS) {
    clock.freeze();
    frozenAt += ms;
    frames += 1;
    const ran = runQueue(frozenAt);
    // Let promise jobs and zero-delay timers queued by the frame finish
    // before the driver takes its screenshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    return ran;
  },
};

window.__cap = clock;
console.info('[capture] fixed-step clock installed');
