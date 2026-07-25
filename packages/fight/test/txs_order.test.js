// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { compose_staged_turn, staged_turn_paths } from '../src/txs.js'

const store_with = (staged) => ({ getState: () => ({ staged }) })

describe('#398 ordered staged-turn composition', () => {
  test('the tx seam retains the reducer-owned move → cast → move order', () => {
    const staged = [
      { kind: 0, target: 5 },
      { kind: 1, target: 7, spell_key: 'fire_bolt', spell_template_id: '0xabc' },
      { kind: 0, target: 9 },
    ]
    const draft = staged_turn_paths(store_with(staged))

    expect(draft.draft_actions).toEqual(staged)
    expect(
      compose_staged_turn(draft.draft_actions, [
        { kind: 1, target: 8, spell_key: 'fire_bolt', spell_template_id: '0xabc' },
      ])
    ).toEqual([
      { kind: 0, target: 5 },
      { kind: 1, target: 8, spell_key: 'fire_bolt', spell_template_id: '0xabc' },
      { kind: 0, target: 9 },
    ])
  })

  test('a dropped cast consumes its own slot without moving a later cast ahead of a move', () => {
    const staged = [
      { kind: 1, target: 3 },
      { kind: 0, target: 4 },
      { kind: 2, target: 5 },
    ]

    expect(compose_staged_turn(staged, [null, { kind: 2, target: 6, spell_key: 'weapon' }])).toEqual([
      { kind: 0, target: 4 },
      { kind: 2, target: 6, spell_key: 'weapon' },
    ])
  })
})
