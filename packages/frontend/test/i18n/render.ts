// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { spyOn } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import en from '../../src/i18n/locales/en.yaml'
import type { AppCopy } from '../../src/i18n/copy.ts'

/** SSR normally reads Zustand's empty initial snapshot; these UI probes render the current reducer state. */
export const render_current_state = (node: ReactNode, copy?: AppCopy): string => {
  const read_current = ((store: { getState: () => unknown }, selector?: (state: unknown) => unknown) => {
    const state = copy ? { ...(store.getState() as object), copy } : store.getState()
    return selector ? selector(state) : state
  }) as typeof zustand.useStore
  const current = spyOn(zustand, 'useStore').mockImplementation(read_current)
  try {
    return renderToStaticMarkup(node)
  } finally {
    current.mockRestore()
  }
}

export const render_english = (node: ReactNode): string => render_current_state(node, en as AppCopy)
