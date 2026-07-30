// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Receipt adoption is selection-only. World membership is already settled by the creation PTB, so this seam
// must have no callback capable of scheduling a second transaction.

import { describe, expect, test } from 'bun:test'

import { adopt_paid_mint_if_first, adopt_predicted_character, should_adopt_paid_mint } from './store_reducer'

const ACTIVE = `0x${'a'.repeat(64)}`
const NEW_CHAR = `0x${'b'.repeat(64)}`

describe('adopt_predicted_character', () => {
  test('selects the receipt-projected character exactly once', () => {
    const selected: string[] = []
    adopt_predicted_character(NEW_CHAR, { select_character: (id) => selected.push(id) })
    expect(selected).toEqual([NEW_CHAR])
  })
})

describe('adopt_paid_mint_if_first', () => {
  test('a wallet first mint becomes active', () => {
    const selected: string[] = []
    const adopted = adopt_paid_mint_if_first(
      NEW_CHAR,
      { characters: [null, { id: 'ghost:ReceiptHero', ghost: true }], selected_character_id: null },
      { select_character: (id) => selected.push(id) }
    )
    expect(adopted).toBe(true)
    expect(selected).toEqual([NEW_CHAR])
  })

  test('an additional paid mint preserves the active character', () => {
    const selected: string[] = []
    const prior = { characters: [{ id: ACTIVE }], selected_character_id: ACTIVE }
    expect(should_adopt_paid_mint(prior)).toBe(false)
    expect(
      adopt_paid_mint_if_first(NEW_CHAR, prior, { select_character: (id) => selected.push(id) })
    ).toBe(false)
    expect(selected).toEqual([])
  })
})
