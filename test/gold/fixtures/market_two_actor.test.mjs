// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { MARKET_ASK_MIST, build_market_two_actor_fixture, market_purchase_math } from './market_two_actor.mjs'

const root = fileURLToPath(new URL('../../..', import.meta.url))

describe('cross-actor marketplace fixture', () => {
  test('selects two unique items and legal stack lots 1/10/100', () => {
    const fixture = build_market_two_actor_fixture({
      characters: [
        { wallet_index: 0, character_id: 'seller', kiosk_id: 'ks', personal_kiosk_cap_id: 'cs' },
        { wallet_index: 1, character_id: 'buyer-a', kiosk_id: 'ka', personal_kiosk_cap_id: 'ca' },
        { wallet_index: 2, character_id: 'buyer-b', kiosk_id: 'kb', personal_kiosk_cap_id: 'cb' },
      ],
      unique_item_ids: ['unique-a', 'unique-b'],
      stack_item_ids: { 1: 'stack-1', 10: 'stack-10', 100: 'stack-100' },
      policy: { id: 'policy', balance: '0' },
    })
    expect(fixture.unique_item_ids).toEqual(['unique-a', 'unique-b'])
    expect(fixture.stack_lots.map((row) => row.amount)).toEqual([1, 10, 100])
    expect(fixture.actors.map((row) => row.character_id)).toEqual(['seller', 'buyer-a', 'buyer-b'])
  })

  test('uses exact 10% royalty accounting at the fixed 100M MIST ask', () => {
    expect(MARKET_ASK_MIST).toBe(100_000_000n)
    expect(market_purchase_math(MARKET_ASK_MIST, 1_000, 10_000_000n)).toEqual({
      ask_mist: 100_000_000n,
      royalty_mist: 10_000_000n,
      buyer_debit_before_gas_mist: 110_000_000n,
      seller_net_before_withdraw_gas_mist: 100_000_000n,
    })
  })

  test('buys into the selected character kiosk and asserts that exact placement', () => {
    const backend = fs.readFileSync(`${root}/test/gold/bot/backend_sdk.mjs`, 'utf8')
    const market_row = fs.readFileSync(`${root}/test/gold/specs_multiplayer/marketplace.spec.ts`, 'utf8')
    expect(backend).toContain('driver.marketplace_buy({ ...ctx.ids, ...a })')
    expect(market_row).toContain('expect(purchase.kiosk_id).toBe(buyer.selected_character.kiosk_id)')
  })
})
