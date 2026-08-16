// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const LOCALES = [
  { code: 'en', native: 'English' },
  { code: 'fr', native: 'Français' },
  { code: 'es', native: 'Español' },
  { code: 'de', native: 'Deutsch' },
  { code: 'uk', native: 'Українська' },
  { code: 'ja', native: '日本語' },
] as const

export type Locale = (typeof LOCALES)[number]['code']

const STORAGE_KEY = 'ares_language'
const locale_codes: ReadonlySet<string> = new Set(LOCALES.map(({ code }) => code))

const is_locale = (value: unknown): value is Locale => typeof value === 'string' && locale_codes.has(value)

export const load_locale = (): Locale => {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (is_locale(stored)) return stored
  } catch (error) {
    console.warn('Saved language is unavailable.', error)
  }
  const detected = globalThis.navigator?.language.split('-')[0]
  return is_locale(detected) ? detected : 'en'
}

export const save_locale = (locale: Locale): void => {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale)
  } catch (error) {
    console.warn('Language preference could not be saved.', error)
  }
}
