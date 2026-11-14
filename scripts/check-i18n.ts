/**
 * Checks every UI language file against en.json.
 *
 *   node app/scripts/check-i18n.ts
 *
 * For each code in LOCALES (src/i18n/locales.ts): the file exists, it has the
 * same keys as en.json (none missing, none extra), each value keeps the same
 * {placeholders}, no value is empty, no value equals the English one unless it
 * is in SAME_AS_EN, no em dash, and button labels are at most twice as long as
 * the English label (code points). Prints one line per locale, then a total
 * line that starts with "<n> locales". Exits 1 on any problem.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LOCALES } from '../src/i18n/locales.ts';

type Messages = Record<string, string>;

const DIR = new URL('../src/i18n/', import.meta.url);

/** Values that may stay English. Key alone applies to every locale. */
const SAME_AS_EN: Readonly<Record<string, string>> = {
  'app.title': 'product name',
  'de:level.label': 'German games say "Level"',
};

/** Single-key buttons (xr/layer.ts, ui/page.ts, game/page-extras.ts). */
const BUTTON_KEYS = [
  'page.start',
  'page.startOver',
  'xr.exit',
  'reach.redo',
  'level.next',
  'level.restart',
  'settings.language',
] as const;

/** The sound button is built as `${sound}: ${on|off}` in xr/layer.ts. */
function soundLabels(m: Messages): string[] {
  return [
    `${m['settings.sound']}: ${m['settings.on']}`,
    `${m['settings.sound']}: ${m['settings.off']}`,
    `${m['settings.voice']}: ${m['settings.on']}`,
    `${m['settings.voice']}: ${m['settings.voiceNone']}`,
  ];
}

const EM_DASH = String.fromCharCode(0x2014);

function load(code: string): Messages | null {
  const file = new URL(`${code}.json`, DIR);
  if (!existsSync(file)) {
    return null;
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Messages;
}

function placeholders(text: string): string {
  return [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
}

function length(text: string): number {
  return [...text].length;
}

const en = load('en');
if (!en) {
  console.error('en.json missing');
  process.exit(1);
}
const enKeys = Object.keys(en);

const totals = { missingFile: 0, keyDiff: 0, placeholder: 0, empty: 0, sameAsEn: 0, allowed: 0, emDash: 0, longButton: 0 };

for (const code of LOCALES) {
  const m = load(code);
  if (!m) {
    totals.missingFile += 1;
    console.log(`${code} FAIL file missing`);
    continue;
  }
  const problems: string[] = [];
  const keys = Object.keys(m);
  const missing = enKeys.filter((k) => !(k in m));
  const extra = keys.filter((k) => !(k in en));
  if (missing.length || extra.length) {
    totals.keyDiff += missing.length + extra.length;
    if (missing.length) problems.push(`missing ${missing.join(' ')}`);
    if (extra.length) problems.push(`extra ${extra.join(' ')}`);
  }
  for (const key of enKeys) {
    const value = m[key];
    if (typeof value !== 'string') {
      continue;
    }
    if (value.trim() === '') {
      totals.empty += 1;
      problems.push(`empty ${key}`);
    }
    if (value.includes(EM_DASH)) {
      totals.emDash += 1;
      problems.push(`em dash ${key}`);
    }
    if (placeholders(value) !== placeholders(en[key])) {
      totals.placeholder += 1;
      problems.push(`placeholder ${key} {${placeholders(value)}} vs en {${placeholders(en[key])}}`);
    }
    if (code !== 'en' && value === en[key]) {
      if (SAME_AS_EN[key] || SAME_AS_EN[`${code}:${key}`]) {
        totals.allowed += 1;
      } else {
        totals.sameAsEn += 1;
        problems.push(`same as en ${key}`);
      }
    }
  }
  if (code !== 'en') {
    const pairs: Array<[string, string, string]> = BUTTON_KEYS.map((k) => [k, m[k] ?? '', en[k]]);
    const ours = soundLabels(m);
    const theirs = soundLabels(en);
    pairs.push(['sound on', ours[0], theirs[0]], ['sound off', ours[1], theirs[1]]);
    for (const [label, value, source] of pairs) {
      if (length(value) > 2 * length(source)) {
        totals.longButton += 1;
        problems.push(`long button ${label} ${length(value)} > 2x${length(source)}`);
      }
    }
  }
  console.log(`${code} ${keys.length} keys ${problems.length ? 'FAIL ' + problems.join('; ') : 'ok'}`);
}

const strays = readdirSync(DIR).filter(
  (f) => f.endsWith('.json') && !(LOCALES as readonly string[]).includes(f.slice(0, -5)),
);
if (strays.length) {
  console.log(`not in LOCALES (ignored by the app): ${strays.join(' ')}`);
}

const bad =
  totals.missingFile + totals.keyDiff + totals.placeholder + totals.empty + totals.sameAsEn + totals.emDash + totals.longButton;
console.log(
  `${LOCALES.length - totals.missingFile} locales, en ${enKeys.length} keys, key differences ${totals.keyDiff}, ` +
    `placeholder mismatches ${totals.placeholder}, empty ${totals.empty}, same as en ${totals.sameAsEn} ` +
    `(allowed ${totals.allowed}), em dash ${totals.emDash}, long buttons ${totals.longButton}`,
);
if (bad > 0) {
  process.exitCode = 1;
}
