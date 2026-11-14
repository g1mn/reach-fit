/**
 * Positional sound: each board cell has its own HRTF panner at the tile's
 * place in the room, and its own note (pitch.ts). With eyes closed you can
 * tell which tile turned from where the sound comes from and how high it is.
 *
 * If the browser cannot make an AudioContext, everything here turns into a
 * silent no-op. Nothing throws.
 */
import { tilePitch, tileWave } from './pitch.ts';
import { playSfx, type SfxName } from './sfx.ts';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface SpatialAudio {
  /** False when no AudioContext could be made. */
  readonly available: boolean;
  readonly enabled: boolean;
  /** Board size for the per-cell notes. Clears the panners. */
  setBoardSize(rows: number, cols: number): void;
  /** Plays `name` from world position `position` (meters). rotate, connect and gazeTick use cell (r, c)'s note. */
  playAt(name: SfxName, position: Vec3Like, r: number, c: number): void;
  /** Plays `name` without position (level done, reach set). */
  play(name: SfxName): void;
  /** Head pose, every frame: world position and unit forward and up vectors. */
  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void;
  /** Sound on or off (settings). On by default. */
  setEnabled(on: boolean): void;
  /** Call on the first user action and when the immersive session starts. Until the context runs, play calls are dropped. */
  resume(): Promise<void>;
  dispose(): void;
}

export interface SpatialAudioOptions {
  rows?: number;
  cols?: number;
  /** Master volume 0..1. Design value 0.8. */
  volume?: number;
}

/** Design values for the panners, meters. Tiles sit about arm's length away. */
export const PANNER = {
  refDistance: 0.5,
  maxDistance: 20,
  rolloffFactor: 1,
} as const;

/** Effects that take the cell's note. The others keep their own pitch (error stays low). */
export const CELL_NOTE_SFX: readonly SfxName[] = ['rotate', 'connect', 'gazeTick'];

function makeContext(): AudioContext | null {
  try {
    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
  } catch {
    return null;
  }
}

function setParam(param: AudioParam | undefined, value: number): boolean {
  if (!param || !Number.isFinite(value)) {
    return false;
  }
  param.value = value;
  return true;
}

export function createSpatialAudio(options: SpatialAudioOptions = {}): SpatialAudio {
  const ctx = makeContext();
  const volume = Math.min(1, Math.max(0, options.volume ?? 0.8));
  let rows = Math.max(1, options.rows ?? 1);
  let cols = Math.max(1, options.cols ?? 1);
  let enabled = true;
  let master: GainNode | null = null;
  const panners = new Map<string, PannerNode>();

  if (ctx) {
    try {
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch {
      master = null;
    }
  }

  // Only while the context runs. A suspended context keeps its clock still, so
  // sounds asked for before resume() would all play at once when it resumes.
  const live = () => (ctx && master && enabled && ctx.state === 'running' ? { ctx, master } : null);

  const pannerFor = (c: AudioContext, out: AudioNode, r: number, col: number): PannerNode => {
    const key = `${r}_${col}`;
    let p = panners.get(key);
    if (!p) {
      p = c.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = PANNER.refDistance;
      p.maxDistance = PANNER.maxDistance;
      p.rolloffFactor = PANNER.rolloffFactor;
      p.connect(out);
      panners.set(key, p);
    }
    return p;
  };

  const clearPanners = () => {
    for (const p of panners.values()) {
      try {
        p.disconnect();
      } catch {
        // already disconnected
      }
    }
    panners.clear();
  };

  return {
    get available() {
      return ctx !== null && master !== null;
    },
    get enabled() {
      return enabled;
    },
    setBoardSize(r, c) {
      rows = Math.max(1, Math.floor(r));
      cols = Math.max(1, Math.floor(c));
      clearPanners();
    },
    playAt(name, position, r, c) {
      const l = live();
      if (!l) {
        return;
      }
      try {
        const p = pannerFor(l.ctx, l.master, r, c);
        if (!setParam(p.positionX, position.x)) {
          p.setPosition(position.x, position.y, position.z);
        } else {
          setParam(p.positionY, position.y);
          setParam(p.positionZ, position.z);
        }
        playSfx(
          l.ctx,
          p,
          name,
          CELL_NOTE_SFX.includes(name) ? { pitch: tilePitch(r, c, rows, cols), wave: tileWave(r, rows) } : {},
        );
      } catch {
        // Sound is a help, never a reason to stop the game.
      }
    },
    play(name) {
      const l = live();
      if (!l) {
        return;
      }
      try {
        playSfx(l.ctx, l.master, name);
      } catch {
        // ignore
      }
    },
    setListener(position, forward, up) {
      if (!ctx) {
        return;
      }
      try {
        const lis = ctx.listener;
        if (setParam(lis.positionX, position.x)) {
          setParam(lis.positionY, position.y);
          setParam(lis.positionZ, position.z);
          setParam(lis.forwardX, forward.x);
          setParam(lis.forwardY, forward.y);
          setParam(lis.forwardZ, forward.z);
          setParam(lis.upX, up.x);
          setParam(lis.upY, up.y);
          setParam(lis.upZ, up.z);
        } else {
          lis.setPosition(position.x, position.y, position.z);
          lis.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
        }
      } catch {
        // ignore
      }
    },
    setEnabled(on) {
      enabled = on;
      if (ctx && master) {
        try {
          master.gain.setTargetAtTime(on ? volume : 0, ctx.currentTime, 0.02);
        } catch {
          // ignore
        }
      }
    },
    async resume() {
      if (ctx && ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Autoplay rules can refuse until a user action. Try again then.
        }
      }
    },
    dispose() {
      clearPanners();
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    },
  };
}
