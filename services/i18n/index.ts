/**
 * Translation, initialised once at import.
 *
 * The catalogue is bundled rather than fetched: a phone that cannot reach its
 * Pond still has to render its own UI, and a network round trip before first
 * paint would make the app's own text depend on the thing it is trying to
 * report on.
 *
 * `en` is the source language. A key with no translation falls back to it
 * rather than rendering the key, so an untranslated string reads as English
 * instead of as `home.devices`.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

export const SUPPORTED_LANGUAGES = ['en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * The device's language, or English.
 *
 * `expo-localization` is a native module, so a JS-only install resolves the
 * import and then throws on first call. Reading the locale is not worth
 * failing the app's first paint over, so a miss falls back rather than throws.
 */
function deviceLanguage(): Language {
  let tag = 'en';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    tag = require('expo-localization').getLocales()[0]?.languageCode ?? 'en';
  } catch {
    tag = 'en';
  }
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(tag) ? (tag as Language) : 'en';
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;

/**
 * Every key the catalogue holds, as a union.
 *
 * `t()` already checks a literal at the call site. This is for the places that
 * carry a key as data — `PROFILE_NAV`, say — where the check would otherwise be
 * lost to `string` and a typo would ship as a rendered key.
 */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<typeof en>;
