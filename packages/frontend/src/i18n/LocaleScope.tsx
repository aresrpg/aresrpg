// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createContext, useContext, type ReactNode } from 'react'

import type { Locale } from './locale.ts'

// A presentation input supplied by the owning game/finance reducer, never independent state.
const locale_context = createContext<Locale>('en')
export const LocaleScope = ({ locale, children }: Readonly<{ locale: Locale; children: ReactNode }>) => (
  <locale_context.Provider value={locale}>{children}</locale_context.Provider>
)
export const useLocale = (): Locale => useContext(locale_context)
