// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { DEMO_APP_MODULES, PLAYER_APP_MODULES } from '../../src/store.ts'

describe('app runtime boundaries', () => {
  test('the player arms gameplay and wallet effects without content editing or simulation', () => {
    expect(PLAYER_APP_MODULES).not.toContain('editor')
    expect(PLAYER_APP_MODULES).not.toContain('simulator')
    for (const name of ['session', 'external_wallet', 'chat', 'duel', 'fight_chain', 'claims', 'world'])
      expect(PLAYER_APP_MODULES).toContain(name)
  })

  test('the demo arms only local settings, combat, simulation, and editing', () => {
    expect(DEMO_APP_MODULES).toEqual(['settings', 'simulator', 'fight', 'editor'])
  })
})
