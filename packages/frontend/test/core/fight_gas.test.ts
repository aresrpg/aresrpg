// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import result_module from '../../src/modules/fight_result.ts'
import { initial_app_state } from '../../src/store.ts'

test('all seats show the final wallet total, including later settlement and negative cleanup rebates', () => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const state = {
    ...base,
    fight_result: {
      ...base.fight_result,
      current_by_character: {
        a: { fight: 'fight', gas_spent_mist: 100n },
        b: { fight: 'fight', gas_spent_mist: 200n },
        c: { fight: 'other', gas_spent_mist: 50n },
      },
    },
  }
  const updated = result_module.reduce!(state as never, {
    type: 'fight_result/gas_updated',
    fight: 'fight',
    gas_spent_mist: -20n,
  })
  expect(updated.fight_result.current_by_character.a?.gas_spent_mist).toBe(-20n)
  expect(updated.fight_result.current_by_character.b?.gas_spent_mist).toBe(-20n)
  expect(updated.fight_result.current_by_character.c?.gas_spent_mist).toBe(50n)
})
