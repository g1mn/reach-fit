// Parsing helpers for the autorun scripts. No dependencies; Node 22+.
//
// The IWSDK CLI prints one JSON value per call: { ok: true, data: ... } or
// { ok: false, error: { code, message } }. `browser logs` entries carry the
// console text in `message`; the app prints bridge lines as
// `[reachfit:<kind>] <json>` (src/test-api.ts emitDevBridge, src/game/game.ts).

/** Parses CLI stdout. Takes the last line that parses as JSON when there is noise before it. */
export function parseCliOutput(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through: look for the last JSON object in the text.
  }
  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const start = lines[i].indexOf('{');
    if (start < 0) {
      continue;
    }
    const candidate = lines.slice(i).join('\n').slice(start);
    try {
      return JSON.parse(candidate);
    } catch {
      // keep looking further up
    }
  }
  return null;
}

/** True when a parsed CLI result reports failure. */
export function cliFailed(result) {
  return !result || result.ok === false;
}

/** Finds the first array of console entries ({ message }) anywhere in a CLI result. */
export function findLogEntries(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    if (value.length === 0 || value.every((e) => e && typeof e === 'object' && typeof e.message === 'string')) {
      return value;
    }
    for (const v of value) {
      const found = findLogEntries(v, depth + 1);
      if (found.length) {
        return found;
      }
    }
    return [];
  }
  for (const key of ['data', 'result', 'logs', 'entries']) {
    if (key in value) {
      const found = findLogEntries(value[key], depth + 1);
      if (found.length) {
        return found;
      }
    }
  }
  for (const v of Object.values(value)) {
    const found = findLogEntries(v, depth + 1);
    if (found.length) {
      return found;
    }
  }
  return [];
}

/** Payloads of `[reachfit:<kind>]` lines, oldest first. */
export function bridgePayloads(entries, kind) {
  const tag = `[reachfit:${kind}] `;
  const out = [];
  for (const entry of entries) {
    const message = String(entry.message ?? '');
    const at = message.indexOf(tag);
    if (at < 0) {
      continue;
    }
    try {
      out.push(JSON.parse(message.slice(at + tag.length)));
    } catch {
      // A truncated line is skipped; a later one replaces it.
    }
  }
  return out;
}

/**
 * The newest payload: from the newest page load (`page`, the page's time
 * origin; a reload starts seq again from 1), then the highest `seq`. Lines
 * without these fields count as older, and among equals the last one wins.
 */
export function latestPayload(payloads) {
  let best = null;
  for (const p of payloads) {
    if (!best) {
      best = p;
      continue;
    }
    const page = typeof p.page === 'number' ? p.page : -1;
    const bestPage = typeof best.page === 'number' ? best.page : -1;
    if (page !== bestPage) {
      if (page > bestPage) {
        best = p;
      }
    } else if (typeof p.seq === 'number' && typeof best.seq === 'number') {
      if (p.seq >= best.seq) {
        best = p;
      }
    } else {
      best = p;
    }
  }
  return best;
}

/** Page ids seen in bridge payloads, oldest first. */
export function pagesOf(payloads) {
  return [...new Set(payloads.map((p) => p?.page).filter((p) => typeof p === 'number'))].sort((a, b) => a - b);
}

/**
 * Joins `[reachfit:log]` parts into one log. Takes the highest dump whose
 * parts 1..of are all there, from one page load: `page` when given,
 * otherwise the newest page in the lines. Returns
 * { page, dump, events, frameSummaries } or null.
 */
export function mergeLog(lines, page) {
  const pages = pagesOf(lines.filter(Boolean));
  const want = page !== undefined ? page : pages.length ? pages[pages.length - 1] : undefined;
  const dumps = new Map();
  for (const line of lines) {
    if (!line || typeof line.dump !== 'number' || typeof line.part !== 'number') {
      continue;
    }
    if (want !== undefined && line.page !== want) {
      continue;
    }
    if (!dumps.has(line.dump)) {
      dumps.set(line.dump, new Map());
    }
    dumps.get(line.dump).set(line.part, line);
  }
  const ids = [...dumps.keys()].sort((a, b) => b - a);
  for (const id of ids) {
    const parts = dumps.get(id);
    const of = [...parts.values()][0].of;
    if (parts.size !== of) {
      continue;
    }
    const events = [];
    const frameSummaries = [];
    for (let i = 1; i <= of; i++) {
      const p = parts.get(i);
      if (!p) {
        break;
      }
      if (Array.isArray(p.events)) {
        events.push(...p.events);
      }
      if (Array.isArray(p.frameSummaries)) {
        frameSummaries.push(...p.frameSummaries);
      }
    }
    return { page: want, dump: id, events, frameSummaries };
  }
  return null;
}

/**
 * Per-level numbers from the app log: one row per level-end, with the
 * mis-grabs and input kinds counted since that level's last level-start.
 */
export function levelRows(events) {
  const rows = [];
  let window = [];
  for (const e of events) {
    if (e.type === 'level-start') {
      window = [];
      continue;
    }
    window.push(e);
    if (e.type === 'level-end') {
      const inputs = {};
      let misGrabs = 0;
      for (const w of window) {
        if (w.type === 'rotate') {
          inputs[w.input] = (inputs[w.input] ?? 0) + 1;
        } else if (w.type === 'mis-grab') {
          misGrabs++;
        }
      }
      rows.push({
        levelId: e.levelId,
        solved: true,
        rotations: e.rotations,
        minRotations: e.minRotations,
        ms: Math.round(e.ms),
        misGrabs,
        inputs,
      });
      window = [];
    }
  }
  return rows;
}

/** Number of console error entries, counting repeats the CLI folded together. */
export function countErrors(entries) {
  let n = 0;
  for (const e of entries) {
    n += typeof e.repeatCount === 'number' ? e.repeatCount : 1;
  }
  return n;
}

/**
 * Look-at points for the gaze reach calibration: the left and right edges as
 * angles from `head.yawDeg`, the head yaw when the layer asked for the left
 * edge. src/xr/calibrate.ts measures both turns from that same yaw, so the
 * right edge must not be taken from the head after it turned left.
 * Yaw convention as src/xr/arc.ts: 0 looks down -Z, positive turns left.
 */
export function gazeEdgeTargets(head, cal) {
  return [
    ['gaze-left', cal.leftDeg],
    ['gaze-right', cal.rightDeg],
  ].map(([phase, deg]) => {
    const a = ((head.yawDeg + deg) * Math.PI) / 180;
    return {
      phase,
      target: {
        x: head.x - Math.sin(a) * cal.distance,
        y: cal.tableY,
        z: head.z - Math.cos(a) * cal.distance,
      },
    };
  });
}
