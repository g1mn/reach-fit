/**
 * Play log. Holds the LogEvent stream that window.__reachfit.log() returns
 * and the 2D page downloads as JSON.
 *
 * Frames are not stored one by one: the last FRAME_RING_SIZE intervals sit in
 * a ring buffer and every level gets a summary (count, mean, max, percentiles
 * from a 1 ms histogram). Other events are capped at MAX_EVENTS; when full,
 * the oldest are dropped and counted.
 *
 * Pure apart from performance.now() defaults, so Node tests can use it.
 */
import type { LogEvent } from './test-api.ts';

/** Recent frame intervals kept. Design value. */
export const FRAME_RING_SIZE = 600;
/** Non-frame events kept. Design value. */
export const MAX_EVENTS = 5000;
/** Histogram buckets of 1 ms; the last bucket holds everything longer. Design value. */
export const FRAME_HIST_BUCKETS = 101;

export interface FrameSummary {
  /** Level id, or 'calibrate' / 'idle' outside a level. */
  segment: string;
  frames: number;
  meanMs: number;
  maxMs: number;
  /** From a 1 ms histogram, so accurate to about 1 ms. */
  p50Ms: number;
  p95Ms: number;
  /** Intervals longer than 1.5 times the median. */
  longFrames: number;
}

export interface PlayLogFile {
  kind: 'reach-fit-play-log';
  version: 1;
  createdAt: string;
  dropped: number;
  frameSummaries: FrameSummary[];
  events: LogEvent[];
}

type Without<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type LogInput = Without<LogEvent, 't'>;

class SegmentStats {
  readonly segment: string;
  frames = 0;
  sum = 0;
  max = 0;
  readonly hist = new Uint32Array(FRAME_HIST_BUCKETS);

  constructor(segment: string) {
    this.segment = segment;
  }

  add(dt: number): void {
    this.frames++;
    this.sum += dt;
    if (dt > this.max) {
      this.max = dt;
    }
    const b = Math.min(FRAME_HIST_BUCKETS - 1, Math.max(0, Math.floor(dt)));
    this.hist[b]++;
  }

  private percentile(q: number): number {
    if (this.frames === 0) {
      return 0;
    }
    const want = q * this.frames;
    let seen = 0;
    for (let i = 0; i < this.hist.length; i++) {
      seen += this.hist[i];
      if (seen >= want) {
        return i + 0.5;
      }
    }
    return this.max;
  }

  summary(): FrameSummary {
    const p50 = this.percentile(0.5);
    let long = 0;
    const limit = Math.floor(p50 * 1.5);
    for (let i = limit + 1; i < this.hist.length; i++) {
      long += this.hist[i];
    }
    return {
      segment: this.segment,
      frames: this.frames,
      meanMs: this.frames ? this.sum / this.frames : 0,
      maxMs: this.max,
      p50Ms: p50,
      p95Ms: this.percentile(0.95),
      longFrames: long,
    };
  }
}

export class PlayLogger {
  private events: LogEvent[] = [];
  private dropped = 0;
  private readonly ring = new Float32Array(FRAME_RING_SIZE);
  private readonly ringT = new Float64Array(FRAME_RING_SIZE);
  private ringCount = 0;
  private ringHead = 0;
  private segments: SegmentStats[] = [new SegmentStats('idle')];
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Adds an event, stamping t when missing. Frame events go to the ring. */
  push(event: LogInput & { t?: number }): void {
    const t = event.t ?? this.now();
    const full = { ...event, t } as LogEvent;
    if (full.type === 'frame') {
      this.frame(full.dt, t);
      return;
    }
    if (full.type === 'level-start') {
      this.startSegment(full.levelId);
    }
    this.events.push(full);
    if (this.events.length > MAX_EVENTS) {
      const extra = this.events.length - MAX_EVENTS;
      this.events.splice(0, extra);
      this.dropped += extra;
    }
  }

  /** One XRFrame (or animation frame) interval in ms. */
  frame(dt: number, t: number = this.now()): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }
    this.ring[this.ringHead] = dt;
    this.ringT[this.ringHead] = t;
    this.ringHead = (this.ringHead + 1) % FRAME_RING_SIZE;
    this.ringCount = Math.min(FRAME_RING_SIZE, this.ringCount + 1);
    this.segments[this.segments.length - 1].add(dt);
  }

  /** Starts a new frame summary segment (level id, 'calibrate', ...). */
  startSegment(name: string): void {
    const last = this.segments[this.segments.length - 1];
    if (last.frames === 0) {
      this.segments.pop();
    }
    this.segments.push(new SegmentStats(name));
    // Keep summaries bounded too.
    if (this.segments.length > 200) {
      this.segments.splice(0, this.segments.length - 200);
    }
  }

  frameSummaries(): FrameSummary[] {
    return this.segments.filter((s) => s.frames > 0).map((s) => s.summary());
  }

  /** Recent frame intervals as 'frame' events, oldest first. */
  recentFrames(): LogEvent[] {
    const out: LogEvent[] = [];
    const start = (this.ringHead - this.ringCount + FRAME_RING_SIZE) % FRAME_RING_SIZE;
    for (let i = 0; i < this.ringCount; i++) {
      const k = (start + i) % FRAME_RING_SIZE;
      out.push({ t: this.ringT[k], type: 'frame', dt: this.ring[k] });
    }
    return out;
  }

  /** All kept events plus the recent frame ring, in time order. */
  log(): LogEvent[] {
    return [...this.events, ...this.recentFrames()].sort((a, b) => a.t - b.t);
  }

  droppedCount(): number {
    return this.dropped;
  }

  toFile(): PlayLogFile {
    return {
      kind: 'reach-fit-play-log',
      version: 1,
      createdAt: new Date().toISOString(),
      dropped: this.dropped,
      frameSummaries: this.frameSummaries(),
      events: this.log(),
    };
  }

  clear(): void {
    this.events = [];
    this.dropped = 0;
    this.ringCount = 0;
    this.ringHead = 0;
    this.segments = [new SegmentStats('idle')];
  }
}

/** The app-wide logger. */
export const logger = new PlayLogger();

/** Saves the play log as a JSON file through a temporary link. */
export function downloadLog(target: PlayLogger = logger): void {
  const blob = new Blob([JSON.stringify(target.toFile(), null, 1)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `reach-fit-log-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
