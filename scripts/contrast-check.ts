/**
 * Prints the WCAG contrast ratio of every pair in CONTRAST_PAIRS, then the
 * lowest one. Exits 1 if any pair is below MIN_CONTRAST (7.0, AAA).
 *
 *   node app/scripts/contrast-check.ts
 */
import {
  CONTRAST_PAIRS,
  MIN_CONTRAST,
  pairLabel,
  pairRatio,
} from '../src/theme/palette.ts';

let min = Number.POSITIVE_INFINITY;
let minLabel = '';
let failures = 0;

for (const pair of CONTRAST_PAIRS) {
  const ratio = pairRatio(pair);
  const label = pairLabel(pair);
  const ok = ratio >= MIN_CONTRAST;
  if (!ok) {
    failures += 1;
  }
  if (ratio < min) {
    min = ratio;
    minLabel = label;
  }
  console.log(`${label} ${ratio.toFixed(2)} ${ok ? 'ok' : 'FAIL'}`);
}

console.log(`min ${min.toFixed(2)} ${minLabel}`);

if (failures > 0) {
  process.exitCode = 1;
}
