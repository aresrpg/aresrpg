// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { decode_fight_action, encode_fight_action } from '../src/index.ts'

describe('fight action wire', () => {
  test('round-trips every live player action without losing bigint precision', () => {
    const actions = [
      { type: 'place', fighter: 1n, cell: 9n },
      { type: 'ready', fighter: 1n },
      { type: 'move_to', fighter: 1n, path: [9n, 10n, 11n] },
      { type: 'cast_spell', fighter: 1n, spell: 'Pressure Point', target_cell: 20n },
      { type: 'weapon_strike', fighter: 1n, target_cell: 20n },
      { type: 'end_turn', fighter: 1n, observed_ms: 9_007_199_254_740_993n },
      { type: 'forfeit', fighter: 1n },
    ] as const

    for (const action of actions) expect(decode_fight_action(encode_fight_action(action))).toEqual(action)
  })

  test('refuses lifecycle commands and malformed decimal fields', () => {
    expect(() => encode_fight_action({ type: 'start' })).toThrow(/not streamable/)
    expect(() => decode_fight_action({ type: 'move_to', fighter: '1', path: ['nope'] })).toThrow(/decimal/)
    expect(() => decode_fight_action({ type: 'cast_spell', fighter: '1', spell: '', target_cell: '2' })).toThrow(
      /spell/
    )
  })
})
