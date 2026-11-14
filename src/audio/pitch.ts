/**
 * A different note for every cell of the board. Pure: no WebAudio.
 *
 * Columns set the note, left to right rising, on a pentatonic scale so any
 * two notes sound fine together. Rows set the octave: the far row is the
 * highest. Rows also set the waveform (tileWave), so neighbouring rows differ
 * in tone color as well as pitch.
 *
 * With up to five columns a row uses the major pentatonic, with six or seven
 * the major scale, with eight to ten ten pitch classes (the pentatonic plus
 * the one a tritone above). A row stays inside one octave, so no two cells
 * on the board share a pitch.
 */

export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];

export const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/** Major pentatonic plus the pentatonic six semitones up. */
export const DOUBLE_PENTATONIC: readonly number[] = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10];

/** Design value: note of the nearest row, leftmost column (G3). */
export const PITCH_BASE_HZ = 196;

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';

/** Design value: tone color per row, from the nearest row outward. */
export const ROW_WAVES: readonly Wave[] = ['triangle', 'sine', 'square'];

function count(n: number): number {
  return Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
}

function index(i: number, n: number): number {
  const v = Math.floor(Number.isFinite(i) ? i : 0);
  return Math.min(n - 1, Math.max(0, v));
}

/** Semitones above PITCH_BASE_HZ for cell (r, c). Row 0 is the far row. */
export function tileSemitone(r: number, c: number, rows: number, cols: number): number {
  const nr = count(rows);
  const nc = count(cols);
  const row = index(r, nr);
  const col = index(c, nc);
  const scale =
    nc <= PENTATONIC.length ? PENTATONIC : nc <= MAJOR.length ? MAJOR : DOUBLE_PENTATONIC;
  // Octaves one row of columns spans. 1 unless a row is wider than ten cells.
  const rowOctaves = Math.ceil(nc / scale.length);
  const fromNear = nr - 1 - row;
  return (
    12 * rowOctaves * fromNear +
    12 * Math.floor(col / scale.length) +
    scale[col % scale.length]
  );
}

/** Frequency in Hz for cell (r, c). */
export function tilePitch(r: number, c: number, rows: number, cols: number): number {
  return PITCH_BASE_HZ * Math.pow(2, tileSemitone(r, c, rows, cols) / 12);
}

/** Waveform for row r. */
export function tileWave(r: number, rows: number): Wave {
  const nr = count(rows);
  const fromNear = nr - 1 - index(r, nr);
  return ROW_WAVES[fromNear % ROW_WAVES.length];
}
