// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { apply_fight_receipt_to_roster } from '../src/fight_receipt_roster.js'

describe('ResultOpened receipt roster convergence', () => {
  test('patches XP, derived level/points, and exact final HP without mutating the prior roster', () => {
    const roster = [{ id: 'char-1', experience: 109, level: 1, available_points: 2, current_hp: 70 }]
    const next = apply_fight_receipt_to_roster(roster, {
      character_id: 'char-1',
      xp_share: 1,
      final_hp: 35,
      previsional_ms: 1234,
    })
    expect(next).not.toBe(roster)
    expect(roster[0]).toEqual({ id: 'char-1', experience: 109, level: 1, available_points: 2, current_hp: 70 })
    // #1643: the local base rides on `hp_previsional_ms`; `hp_updated_ms` is the CHAIN's field and is untouched.
    expect(next[0]).toEqual({
      id: 'char-1',
      experience: 110,
      level: 2,
      available_points: 7,
      current_hp: 35,
      hp_previsional_ms: 1234,
    })
  })

  test('zero HP is receipt truth and an unknown character is an identity no-op', () => {
    const roster = [{ id: 'char-1', experience: 50, current_hp: 10, hp_updated_ms: 900 }]
    expect(
      apply_fight_receipt_to_roster(roster, { character_id: 'char-1', xp_share: 0, final_hp: 0, previsional_ms: 4 })[0]
    ).toMatchObject({ experience: 50, current_hp: 0, hp_previsional_ms: 4, hp_updated_ms: 900 })
    expect(apply_fight_receipt_to_roster(roster, { character_id: 'missing', xp_share: 20 })).toBe(roster)
  })
})
