// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { character_fixture_plan, validate_character_fixture } from './actor_fixture.mjs'

describe('multi-character gold fixture', () => {
  test('four wallets include two wallets with multiple selectable characters', () => {
    const plan = character_fixture_plan(4)
    expect(plan.map((row) => row.count)).toEqual([2, 2, 1, 1])
    expect(plan.reduce((sum, row) => sum + row.count, 0)).toBe(6)
  })

  test('every character records the kiosk state needed when that character acts', () => {
    const rows = [
      {
        wallet_index: 0,
        slot: 0,
        character_id: 'c0',
        kiosk_id: 'k0',
        personal_kiosk_cap_id: 'p0',
      },
      {
        wallet_index: 0,
        slot: 1,
        character_id: 'c1',
        kiosk_id: 'k1',
        personal_kiosk_cap_id: 'p1',
      },
    ]
    expect(validate_character_fixture(rows)).toEqual(rows)
  })
})
