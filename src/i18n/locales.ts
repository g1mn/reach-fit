import type en from './en.json';

/** The ten UI languages. Each has src/i18n/<code>.json with the keys of en.json. */
export const LOCALES = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
  'es',
  'fr',
  'de',
  'pt',
  'vi',
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Language names in their own language, for the language button. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  vi: 'Tiếng Việt',
};

/** Keys of the English source file. Other locales must have the same keys. */
export type MessageKey = keyof typeof en;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** The locale after `current`, wrapping around. Used by the in-XR button. */
export function nextLocale(current: Locale): Locale {
  const index = LOCALES.indexOf(current);
  return LOCALES[(index + 1) % LOCALES.length];
}

/** Best match for browser language tags such as navigator.languages. */
export function matchLocale(tags: readonly string[]): Locale {
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) {
      return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-Hant' : 'zh-Hans';
    }
    const base = tag.split('-')[0];
    if (isLocale(base)) {
      return base;
    }
  }
  return DEFAULT_LOCALE;
}
