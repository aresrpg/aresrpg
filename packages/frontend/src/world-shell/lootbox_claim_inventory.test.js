// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #265, SECOND mint path: opening a PET LOOTBOX must land the minted pet in the bag without a page
// refresh, exactly like the fight-settle path (loot_inventory_effect.test.js covers the first). claim_pet
// itself cannot be imported here — lootbox_actions.js drags `../auth` → window at load, the same repo-wide
// constraint dungeon_settlement.test.js documents for its own module. This drives the REAL shared reducer
// door (reduce_minted_receipt) with a settlement shaped exactly as claim_pet builds it from its own tx result:
// { receipt: result, kiosk_id, kiosk_cap_id }, a pet's item::ItemMinted event among `result.events`.

import { afterEach, describe, expect, it } from 'bun:test'

import { context } from '../game/core/game.js'

import { reduce_minted_receipt } from './loot_inventory_effect.js'

const pet_id = '0xissue265pet'
const template_id = '0xissue265pettemplate'
// Exact shape claim_pet composes: receipt = its own run_tx result (normalize_receipt shape — events at the
// top), kiosk_id/kiosk_cap_id = the resolved destination kiosk handle.
const claim_settlement = {
  receipt: {
    events: [
      {
        type: '0xares::item::ItemMinted',
        parsedJson: { item: pet_id, template: template_id, item_type: 'ember_fox', amount: '1' },
      },
    ],
  },
  kiosk_id: '0xissue265kiosk',
  kiosk_cap_id: '0xissue265cap',
}
// PET is non-stackable (STACKABLE_CATEGORIES has no 'pet') — a genuinely different shape than the fight
// path's resource-row test, never exercised before this row.
const templates = new Map([[template_id, { name: 'Ember Fox', item_type: 'ember_fox', category: 'PET', level: 1 }]])
const settle_engine = () => new Promise((resolve) => setTimeout(resolve, 0))
const dispatch_and_wait = (type, payload) =>
  new Promise((resolve) => {
    context.events.once(type, resolve)
    context.dispatch(type, payload)
  })

afterEach(async () => {
  await dispatch_and_wait('action/sui_logout')
})

describe('lootbox claim → inventory reducer door (#265)', () => {
  it('folds a claim_pet receipt into the bag without a refresh', async () => {
    await dispatch_and_wait('action/sui_login', { address: '0xowner-a' })
    const inputs = []
    const on_input = (input) => inputs.push(input)
    context.events.on('action/sui_data', on_input)

    try {
      await reduce_minted_receipt(claim_settlement, '0xowner-a', {
        load_templates: async () => templates,
        reducer_door: context,
      })
      await settle_engine()

      expect(inputs).toHaveLength(1)
      expect(inputs[0]).toMatchObject({ kind: 'receipt_patch', op: 'settled_loot' })
      expect(inputs[0].rows).toEqual([
        expect.objectContaining({ id: pet_id, template_id, amount: 1, item_category: 'pet', stackable: false }),
      ])
      expect(context.get_state().sui.items.some((item) => item.id === pet_id)).toBe(true)
    } finally {
      context.events.off('action/sui_data', on_input)
    }
  })

  it('drops a late claim receipt after the active account switches wallets mid-flight', async () => {
    await dispatch_and_wait('action/sui_login', { address: '0xowner-a' })
    const inputs = []
    const on_input = (input) => inputs.push(input)
    context.events.on('action/sui_data', on_input)

    try {
      // The pre-tx snapshot — mirrors claim_pet reading context.get_state().sui.selected_address BEFORE run_tx.
      const pre_tx_owner = context.get_state().sui.selected_address
      await dispatch_and_wait('action/sui_login', { address: '0xowner-b' }) // wallet switches while the tx "runs"
      await reduce_minted_receipt(claim_settlement, pre_tx_owner, {
        load_templates: async () => templates,
        reducer_door: context,
      })
      await settle_engine()

      expect(inputs).toEqual([])
      expect(context.get_state().sui.items.some((item) => item.id === pet_id)).toBe(false)
    } finally {
      context.events.off('action/sui_data', on_input)
    }
  })
})
