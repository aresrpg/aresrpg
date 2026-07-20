import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

// EN is the ONLY statically bundled locale — it is the init fallback the runtime needs synchronously
// (fallbackLng: 'en'). Every other language's translation bundle + item-description catalog is fetched
// on demand for the ACTIVE language only (lazy_locale.ts), so the tab no longer parses/retains all six
// locales (~2.7 MB) at boot.
import en from './locales/en.json'
import { load_locale } from './lazy_locale'

export const LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'fr', native: 'Français' },
  { code: 'es', native: 'Español' },
  { code: 'de', native: 'Deutsch' },
  { code: 'uk', native: 'Українська' },
  { code: 'ja', native: '日本語' },
] as const

export type Language = (typeof LANGUAGES)[number]['code']

// Attach the lazy-locale loader BEFORE init so the initial `languageChanged` that init emits when it
// resolves the detected/persisted language is caught (attaching after init misses it — the boot language
// would silently never get its bundle). Fires again on every user language switch.
i18n.use(LanguageDetector).use(initReactI18next)
i18n.on('languageChanged', load_locale)

i18n.init({
  // Only EN is inline (sync fallback); the active non-EN bundle is added lazily via load_locale below.
  resources: {
    en: { translation: en },
  },
  fallbackLng: 'en',
  supportedLngs: ['en', 'fr', 'es', 'de', 'uk', 'ja'],
  interpolation: { escapeValue: false },
  // Re-render components when a lazy item-description catalog bundle lands (addResourceBundle emits
  // the store `added` event); default is only `languageChanged`, which fires before the async chunk.
  react: { bindI18nStore: 'added' },
  detection: {
    order: ['localStorage', 'navigator'],
    caches: ['localStorage'],
    lookupLocalStorage: 'ares_language',
  },
})

// Belt-and-suspenders: if the language was already resolved synchronously (init emitted languageChanged
// before this module finished evaluating in some environments), load it directly. Idempotent.
load_locale()

export default i18n
