// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { save_locale, type Locale } from '../i18n/locale.ts'
import { load_app_copy, type AppCopy } from '../i18n/copy.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export type LocaleInput =
  | Readonly<{ type: 'locale/changed'; locale: Locale }>
  | Readonly<{ type: 'locale/loaded'; locale: Locale; copy: AppCopy }>

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'locale/changed' && state.locale !== input.locale)
    return Object.freeze({ ...state, locale: input.locale })
  if (input.type === 'locale/loaded' && state.locale === input.locale)
    return Object.freeze({ ...state, copy: input.copy })
  return state
}

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
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
    if (state.locale !== previous.locale) {
      save_locale(state.locale)
      load(state.locale)
    }
  })
}

export default Object.freeze({ name: 'locale', reduce, observe }) satisfies AppModule
