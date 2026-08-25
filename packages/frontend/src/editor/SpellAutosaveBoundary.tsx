// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ReactNode } from 'react'

import { dispatch_app } from '../store.ts'

export const SpellAutosaveBoundary = ({ children }: Readonly<{ children: ReactNode }>) => (
  <div
    data-spell-autosave-boundary=""
    onBlurCapture={(event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
      dispatch_app({ type: 'editor/focus_changed', domain: 'spells', focused: false })
    }}
    onFocusCapture={() => dispatch_app({ type: 'editor/focus_changed', domain: 'spells', focused: true })}
  >
    {children}
  </div>
)
