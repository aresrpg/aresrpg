// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { apply_document_locale } from '../i18n/document.ts'
import { load_locale, save_locale, type Locale } from '../i18n/locale.ts'
import { load_app_copy, type AppCopy } from '../i18n/copy.ts'
import type { SiteModule } from '../store.ts'

export type LocaleInput =
  | Readonly<{ type: 'locale/changed'; locale: Locale }>
  | Readonly<{ type: 'locale/loaded'; locale: Locale; copy: AppCopy }>

const reduce: NonNullable<SiteModule['reduce']> = (state, input) => {
  if (input.type === 'locale/changed' && state.locale !== input.locale)
    return Object.freeze({ ...state, locale: input.locale })
  if (input.type === 'locale/loaded' && state.locale === input.locale)
    return Object.freeze({ ...state, copy: input.copy })
  return state
}

const observe: NonNullable<SiteModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  let generation = 0
  const load = (locale: Locale): void => {
    const own_generation = ++generation
    void load_app_copy(locale)
      .then((copy) => {
        if (!signal.aborted && own_generation === generation) dispatch({ type: 'locale/loaded', locale, copy })
      })
      .catch((error) => console.error(`Locale ${locale} failed to load.`, error))
  }
  load(get_state().locale)
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.copy && state.copy !== previous.copy) apply_document_locale(state.copy, state.locale)
    if (state.locale !== previous.locale) {
      save_locale(state.locale)
      load(state.locale)
    }
  })
}

/** The saved or the browser's language from the first state; the copy loads once the store starts. */
export default Object.freeze({
  name: 'locale',
  initial: () => ({ locale: load_locale(), copy: null }),
  reduce,
  observe,
}) satisfies SiteModule
