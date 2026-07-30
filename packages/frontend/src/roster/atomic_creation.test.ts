// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1714 — membership is already in the settled creation PTB. Receipt adoption may select the new character,
// but it must never schedule another join transaction.

import { describe, expect, test } from 'bun:test'

import { adopt_paid_mint_if_first, adopt_predicted_character } from './store_reducer'

describe('atomic character creation — no post-receipt world transaction', () => {
  test('free receipt adoption selects only; it never calls the retired join scheduler', () => {
    const selected: string[] = []
    const scheduled: string[] = []

    const legacy_deps = {
      select_character: (id: string) => selected.push(id),
      begin_join: (id: string) => scheduled.push(id),
    }
    adopt_predicted_character('0xcharacter', legacy_deps)

    expect(selected).toEqual(['0xcharacter'])
    expect(scheduled).toEqual([])
  })

  test('paid first-mint adoption also schedules no second transaction', () => {
    const selected: string[] = []
    const scheduled: string[] = []
    const legacy_deps = {
      select_character: (id: string) => selected.push(id),
      begin_join: (id: string) => scheduled.push(id),
    }

    adopt_paid_mint_if_first('0xcharacter', { characters: [], selected_character_id: null }, legacy_deps)

    expect(selected).toEqual(['0xcharacter'])
    expect(scheduled).toEqual([])
  })
})
