/**
 * UI strings in ten languages.
 *
 * Language files are found with import.meta.glob('./*.json'), so adding
 * ko.json and the others (MV05) needs no code change. A missing language or a
 * missing key falls back to en.json. Start order: saved choice, then
 * navigator.languages, then en.
 */
import en from './en.json';
import {
  DEFAULT_LOCALE,
  isLocale,
  matchLocale,
  type Locale,
  type MessageKey,
} from './locales.ts';

type Messages = Partial<Record<MessageKey, string>>;

const files = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<
  string,
  Messages
>;

const table: Partial<Record<Locale, Messages>> = { en: en as Messages };
for (const [path, messages] of Object.entries(files)) {
  const code = path.replace(/^\.\//, '').replace(/\.json$/, '');
  if (isLocale(code)) {
    table[code] = messages;
  }
}

const STORAGE_KEY = 'reachfit.locale.v1';

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<(locale: Locale) => void>();

export type MessageParams = Record<string, string | number>;

/** The string for key in the current language, with {name} placeholders filled. */
export function t(key: MessageKey, params?: MessageParams): string {
  const text = table[current]?.[key] ?? (en as Messages)[key] ?? key;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function getLocale(): Locale {
  return current;
}

/** Languages that have a file (en always). Others still work through the en fallback. */
export function localesWithFiles(): Locale[] {
  return Object.keys(table).filter(isLocale);
}

/** Saved choice, or null when nothing is saved or storage is unavailable. */
export function savedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function saveLocale(locale: Locale): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/** Switches language. False for an unknown code. Listeners run on every switch. */
export function setLocale(code: string, persist = true): boolean {
  if (!isLocale(code)) {
    return false;
  }
  current = code;
  if (persist) {
    saveLocale(code);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
  }
  for (const listener of listeners) {
    try {
      listener(code);
    } catch (error) {
      console.error('[i18n] locale listener failed', error);
    }
  }
  return true;
}

/** Calls fn after every language switch. Returns an unsubscribe function. */
export function onLocaleChange(fn: (locale: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Picks the start language and applies it without saving. */
export function initLocale(): Locale {
  const saved = savedLocale();
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator.languages?.length ? navigator.languages : [navigator.language])
      : [];
  const locale = saved ?? matchLocale(nav.filter(Boolean));
  setLocale(locale, false);
  return locale;
}
