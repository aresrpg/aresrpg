// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer, type ReactNode } from 'react'

import logo from '../../public/logo.png'
import { load_app_copy, type AppCopy } from '../i18n/copy.ts'
import { load_locale, save_locale, type Locale } from '../i18n/locale.ts'

type LocaleState = Readonly<{ locale: Locale; copy: AppCopy | null; error: string | null }>
type LocaleInput =
  | Readonly<{ type: 'select'; locale: Locale }>
  | Readonly<{ type: 'loaded'; locale: Locale; copy: AppCopy }>
  | Readonly<{ type: 'failed'; locale: Locale; error: string }>
const reduce = (state: LocaleState, input: LocaleInput): LocaleState => {
  if (input.type === 'select') return { ...state, locale: input.locale, error: null }
  if (input.locale !== state.locale) return state
  return input.type === 'loaded' ? { ...state, copy: input.copy, error: null } : { ...state, error: input.error }
}
export const FinanceLocale = ({
  render,
}: Readonly<{ render: (copy: AppCopy, locale: Locale, change_locale: (locale: Locale) => void) => ReactNode }>) => {
  const [state, dispatch] = useReducer(reduce, undefined, (): LocaleState => ({
    locale: load_locale(),
    copy: null,
    error: null,
  }))
  useEffect(() => {
    let cancelled = false
    save_locale(state.locale)
    document.documentElement.lang = state.locale
    void load_app_copy(state.locale)
      .then((copy) => {
        if (!cancelled) dispatch({ type: 'loaded', locale: state.locale, copy })
      })
      .catch((error: unknown) => {
        console.error('Launch language could not load.', error)
        if (!cancelled)
          dispatch({
            type: 'failed',
            locale: state.locale,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      cancelled = true
    }
  }, [state.locale])
  if (state.error)
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-8 text-text" role="alert">
        {state.error}
      </main>
    )
  return state.copy ? (
    render(state.copy, state.locale, (locale) => dispatch({ type: 'select', locale }))
  ) : (
    <main aria-busy="true" className="grid min-h-dvh place-items-center bg-bg">
      <img alt="AresRPG" className="size-12 animate-pulse" src={logo} />
    </main>
  )
}
