// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { ACCOUNT_APP_MODULES, DAPP_APP_MODULES, DEMO_APP_MODULES, PLAYER_APP_MODULES } from '../../src/store.ts'

describe('app runtime boundaries', () => {
  test('the player arms gameplay and wallet effects without content editing or simulation', () => {
    expect(PLAYER_APP_MODULES).not.toContain('editor')
    expect(PLAYER_APP_MODULES).not.toContain('simulator')
    for (const name of ['session', 'external_wallet', 'chat', 'duel', 'fight_chain', 'claims', 'world'])
      expect(PLAYER_APP_MODULES).toContain(name)
  })

  test('the web dapp arms the account, market and hosted-bot effects, never the world or another wallet', () => {
    expect(DAPP_APP_MODULES).toEqual([
      'session',
      'suins',
      'chain_clock',
      'analytics',
      'settings',
      'audio',
      'locale',
      'fight',
      'marketplace',
      'dapp',
    ])
    expect(PLAYER_APP_MODULES).not.toContain('dapp')
  })

  test('a light account page arms the account with its bot and external wallet, never gameplay or the dapp', () => {
    expect(ACCOUNT_APP_MODULES).toEqual([
      'session',
      'hosted_agent',
      'suins',
      'chain_clock',
      'external_wallet',
      'analytics',
      'settings',
      'audio',
      'locale',
      'fight',
      'marketplace',
    ])
  })

  test('the demo arms only local settings, combat, simulation, and editing', () => {
    expect(DEMO_APP_MODULES).toEqual(['settings', 'audio', 'locale', 'simulator', 'fight', 'editor'])
  })
})
