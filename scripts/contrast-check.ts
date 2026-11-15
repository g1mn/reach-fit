/**
 * Prints the WCAG contrast ratio of every pair in CONTRAST_PAIRS for each
 * contrast mode (standard, max, dim), then the lowest pair of each mode.
 * Exits 1 if any pair in any mode is below MIN_CONTRAST (7.0, AAA).
 *
 *   node app/scripts/contrast-check.ts
 *
 * The last line is the standard mode's lowest pair (what the trailer quotes).
 */
import {
  CONTRAST_MODES,
  CONTRAST_PAIRS,
  MIN_CONTRAST,
  PULSE_BY_MODE,
  lowestPair,
  pairLabel,
  pairRatio,
} from '../src/theme/palette.ts';

let failures = 0;
const lows: string[] = [];

for (const mode of CONTRAST_MODES) {
  console.log(`[${mode}]`);
  for (const pair of CONTRAST_PAIRS) {
    const ratio = pairRatio(pair, mode);
    const shown = pair.pulse && !PULSE_BY_MODE[mode] ? { ...pair, fgGain: undefined } : pair;
    const ok = ratio >= MIN_CONTRAST;
    if (!ok) {
      failures += 1;
    }
    console.log(`${mode} ${pairLabel(shown)} ${ratio.toFixed(2)} ${ok ? 'ok' : 'FAIL'}`);
  }
  const low = lowestPair(mode);
  lows.push(`min ${mode} ${low.ratio.toFixed(2)} ${low.label}`);
}

console.log(`${CONTRAST_MODES.length} modes x ${CONTRAST_PAIRS.length} pairs, failures ${failures}`);
// Standard last, so `tail -1` keeps giving the default look's lowest pair.
for (const line of [...lows.slice(1), lows[0]]) {
  console.log(line);
}

if (failures > 0) {
  process.exitCode = 1;
}
