/**
 * Console bridge payloads for the autorun scripts (app/tools/autorun).
 *
 * The IWSDK CLI reads console lines (`browser logs`, at most 200 per call)
 * but cannot run page code, so the game prints its log as numbered parts.
 * Every part is one JSON object of at most BRIDGE_LINE_MAX characters:
 *   { dump, part, of, events: [...] }          non-frame log events, in order
 *   { dump, part, of, frameSummaries: [...] }  per-level frame summaries
 * `dump` grows by one per print, so a reader takes the highest complete dump.
 *
 * Pure: Node tests import it.
 */

/** Longest JSON object per console line, characters. Design value (MV08 spec). */
export const BRIDGE_LINE_MAX = 4000;

/** Placeholder used while sizing, as wide as any real part or count. */
const WIDE_NUMBER = 99999;

/**
 * Splits items into chunks so that JSON.stringify(wrap(part, of, chunk)) stays
 * within max characters for every chunk. An item that is too long on its own
 * goes alone in its chunk (that line is then longer than max).
 */
export function chunkForLines<T>(
  items: readonly T[],
  wrap: (part: number, of: number, chunk: T[]) => unknown,
  max = BRIDGE_LINE_MAX,
): T[][] {
  // wrap() puts the chunk into one array, so a line is the empty wrapper plus
  // the item texts and the commas between them.
  const overhead = JSON.stringify(wrap(WIDE_NUMBER, WIDE_NUMBER, [])).length;
  const chunks: T[][] = [];
  let current: T[] = [];
  let length = overhead;
  for (const item of items) {
    const size = JSON.stringify(item).length;
    const added = current.length === 0 ? size : size + 1;
    if (current.length > 0 && length + added > max) {
      chunks.push(current);
      current = [item];
      length = overhead + size;
    } else {
      current.push(item);
      length += added;
    }
  }
  if (current.length > 0 || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

export interface LogLine<E, S> {
  dump: number;
  part: number;
  of: number;
  events?: E[];
  frameSummaries?: S[];
}

/** One dump of the play log as console line payloads, numbered 1..of. */
export function logLines<E, S>(
  dump: number,
  events: readonly E[],
  frameSummaries: readonly S[],
  max = BRIDGE_LINE_MAX,
): LogLine<E, S>[] {
  const eventChunks = chunkForLines(events, (part, of, chunk) => ({ dump, part, of, events: chunk }), max);
  const frameChunks =
    frameSummaries.length > 0
      ? chunkForLines(frameSummaries, (part, of, chunk) => ({ dump, part, of, frameSummaries: chunk }), max)
      : [];
  const of = eventChunks.length + frameChunks.length;
  const lines: LogLine<E, S>[] = eventChunks.map((chunk, i) => ({ dump, part: i + 1, of, events: chunk }));
  frameChunks.forEach((chunk, i) => {
    lines.push({ dump, part: eventChunks.length + i + 1, of, frameSummaries: chunk });
  });
  return lines;
}
