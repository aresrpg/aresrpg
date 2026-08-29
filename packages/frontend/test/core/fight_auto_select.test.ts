// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { automatic_turn_character } from '../../src/modules/fight_observer.ts'

const fighter = (character: string) => ({
  kind: { type: 'player', character, owner: '0xme' },
  dead: false,
  settled: false,
})

const state = (selected: string, active: number, extra: Readonly<{ enabled?: boolean; fight?: string }> = {}) => ({
  settings: { auto_switch_fighter: extra.enabled },
  session: {
    selected_character_id: selected,
    wallet: { address: '0xme' },
    characters: [{ id: '0xa' }, { id: '0xb' }],
  },
  fight: {
    mode: 'remote',
    checkpoint: {
      contract: {
        id: extra.fight ?? '0xf',
        round: 1n,
        ended: false,
        turn_ptr: BigInt(active),
        queue: [0n, 1n],
        fighters: [fighter('0xa'), fighter('0xb')],
      },
    },
  },
})

test('a new owned turn selects its character when both tabs share the viewed fight', () => {
  expect(automatic_turn_character(state('0xa', 1) as never, state('0xa', 0) as never)).toBe('0xb')
})

test('auto-switch is optional and never fights a manual choice during the same turn', () => {
  expect(automatic_turn_character(state('0xa', 1, { enabled: false }) as never, state('0xa', 0) as never)).toBeNull()
  expect(automatic_turn_character(state('0xa', 1) as never, state('0xb', 1) as never)).toBeNull()
})

test('selection outside the viewed fight is never stolen', () => {
  expect(automatic_turn_character(state('0xoutside', 1) as never, state('0xoutside', 0) as never)).toBeNull()
})
