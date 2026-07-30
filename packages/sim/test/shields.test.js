// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  apply_shields,
  apply_resistance,
  calculate_final_damage,
} from '../src/spell_calculator.js'
import { consume_shields } from '../src/fight_actions.js'

// Kind 40 owns pool depletion; kind 24 is a per-hit flat and must never be spent. These tests lock the
// low-level reservoir mutation while pool_shield_parity.test.js pins the four cross-twin decisions.

const target_with_shield = (id, value, element) => ({
  team0: [
    {
      id,
      effects: [
        {
          id: 1,
          type: 'POOL_SHIELD',
          value,
          element,
          turns_remaining: 3,
        },
      ],
    },
  ],
  team1: [],
})

describe('elementless damage does NOT crash (flying_soul steal — the cast->server-crash P0)', () => {
  const stats = {
    vitality: 0,
    wisdom: 0,
    strength: 0,
    intelligence: 0,
    chance: 0,
    agility: 0,
    critical_hit: 0,
    range: 0,
    raw_damage: 0,
    water_resistance: 0,
    fire_resistance: 0,
    earth_resistance: 0,
    air_resistance: 0,
  }

  test('apply_resistance with a missing element returns damage unchanged (no throw)', () => {
    expect(() => apply_resistance(10, undefined, stats)).not.toThrow()
    expect(apply_resistance(10, undefined, stats)).toBe(10)
  })

  test('calculate_final_damage on an elementless effect (steal) does not throw', () => {
    // flying_soul's STEAL effect carries no `element` — pre-fix this threw undefined.toLowerCase() inside
    // reduce() -> unhandledRejection -> the whole server crashed mid-cast.
    const effect = { min: 1, max: 4, type: 'DAMAGE' } // no element
    expect(() =>
      calculate_final_damage(effect, stats, stats, 0, []),
    ).not.toThrow()
  })
})

describe('consume_shields (spend POOL_SHIELD effects by absorbed amount)', () => {
  test('decrements a partially-used shield, keeps it', () => {
    const state = target_with_shield('t', 10)
    const next = consume_shields(state, 't', [{ id: 1, absorbed: 4 }])
    const shield = next.team0[0].effects.find(e => e.type === 'POOL_SHIELD')
    expect(shield.value).toBe(6)
  })

  test('drops a fully-consumed shield', () => {
    const state = target_with_shield('t', 4)
    const next = consume_shields(state, 't', [{ id: 1, absorbed: 4 }])
    expect(next.team0[0].effects.some(e => e.type === 'POOL_SHIELD')).toBe(
      false,
    )
  })

  test('no-op when nothing was absorbed', () => {
    const state = target_with_shield('t', 10)
    expect(consume_shields(state, 't', [])).toBe(state)
  })
})

describe('pool shield depletes across hits (apply_shields + consume_shields)', () => {
  test('a pool spends its reservoir and leaks the exhausting hit', () => {
    // shield 6; element matches (neutral absorbs everything)
    let shields = [
      {
        id: 1,
        type: 'POOL_SHIELD',
        value: 6,
        turns_remaining: 3,
      },
    ]

    // hit 1: 4 dmg -> shield absorbs 4 (0 through), shield now 2
    const h1 = apply_shields(4, 'fire', shields)
    expect(h1.damage).toBe(0)
    expect(h1.shields_consumed).toEqual([{ id: 1, absorbed: 4 }])
    const s1 = consume_shields(
      { team0: [{ id: 't', effects: shields }], team1: [] },
      't',
      h1.shields_consumed,
    )
    shields = s1.team0[0].effects.filter(e => e.type === 'POOL_SHIELD')
    expect(shields[0].value).toBe(2)

    // hit 2: 5 dmg -> shield absorbs only its remaining 2, 3 dmg gets THROUGH (pre-fix it would absorb 4 again)
    const h2 = apply_shields(5, 'fire', shields)
    expect(h2.damage).toBe(3)
    const s2 = consume_shields(
      { team0: [{ id: 't', effects: shields }], team1: [] },
      't',
      h2.shields_consumed,
    )
    // shield fully spent -> removed
    expect(s2.team0[0].effects.some(e => e.type === 'POOL_SHIELD')).toBe(false)
  })
})
