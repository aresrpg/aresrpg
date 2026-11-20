// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'

import { return_home } from '../../src/components/app_layout.ts'
import * as store from '../../src/store.ts'

// Regression (production, 2026-11-20): "Return to home" signed the player out and left them on a bare
// "Sign in to play" card. Leaving the world is not signing out: it opens the home page, session kept.
test('Return to home opens the home page and signs nobody out', () => {
  const dispatched = spyOn(store, 'dispatch_app')
  const opened: string[] = []
  try {
    return_home((url) => void opened.push(url))
    expect(opened).toEqual(['/'])
    expect(dispatched).not.toHaveBeenCalled()
  } finally {
    dispatched.mockRestore()
  }
})
