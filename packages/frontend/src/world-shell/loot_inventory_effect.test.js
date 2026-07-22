// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Production settle edge coverage: the resolved mint receipt itself must dispatch exactly one typed inventory
// INPUT, while an account switch during the await must dispatch nothing into the new owner's reducer.

import { afterEach, describe, expect, it } from 'bun:test'

import { context } from '../game/core/game.js'

import { mint_and_reduce_inventory } from './loot_inventory_effect.js'

const loot_id = '0xissue265loot'
const template_id = '0xissue265template'
const settlement = {
  receipt: {
    events: [
      {
        type: '0xares::item::ItemMinted',
        parsedJson: { item: loot_id, template: template_id, item_type: 'razkin_hide', amount: '1' },
      },
    ],
  },
  kiosk_id: '0xissue265kiosk',
  kiosk_cap_id: '0xissue265cap',
}
const templates = new Map([
  [template_id, { name: 'Razkin Hide', item_type: 'razkin_hide', category: 'RESOURCE', level: 10 }],
])
const settle_engine = () => new Promise((resolve) => setTimeout(resolve, 0))
const dispatch_and_wait = (type, payload) =>
  new Promise((resolve) => {
    context.events.once(type, resolve)
    context.dispatch(type, payload)
  })

afterEach(async () => {
  await dispatch_and_wait('action/sui_logout')
})

describe('production settle → inventory effect edge', () => {
  it('dispatches the successful async outcome exactly once as a reducer INPUT', async () => {
    await dispatch_and_wait('action/sui_login', { address: '0xowner-a' })
    const inputs = []
    const on_input = (input) => inputs.push(input)
    context.events.on('action/sui_data', on_input)

    try {
      const outcome = await mint_and_reduce_inventory('0xresult', [template_id], {
        mint_and_burn: async () => settlement,
        load_templates: async () => templates,
        reducer_door: context,
      })
      await settle_engine()

      expect(outcome).toBe(settlement)
      expect(inputs).toHaveLength(1)
      expect(inputs[0]).toMatchObject({ kind: 'receipt_patch', op: 'settled_loot' })
      expect(inputs[0].rows).toEqual([
        expect.objectContaining({ id: loot_id, template_id, amount: 1, item_category: 'resource' }),
      ])
      expect(context.get_state().sui.items.some((item) => item.id === loot_id)).toBe(true)
    } finally {
      context.events.off('action/sui_data', on_input)
    }
  })

  it('drops a late wallet-A outcome after the active account switches to wallet B', async () => {
    await dispatch_and_wait('action/sui_login', { address: '0xowner-a' })
    const inputs = []
    const on_input = (input) => inputs.push(input)
    context.events.on('action/sui_data', on_input)
    const pending_settlement = Promise.withResolvers()

    try {
      const edge = mint_and_reduce_inventory('0xresult', [template_id], {
        mint_and_burn: async () => pending_settlement.promise,
        load_templates: async () => templates,
        reducer_door: context,
      })
      await dispatch_and_wait('action/sui_login', { address: '0xowner-b' })
      pending_settlement.resolve(settlement)
      await edge
      await settle_engine()

      expect(inputs).toEqual([])
      expect(context.get_state().sui.items.some((item) => item.id === loot_id)).toBe(false)
    } finally {
      context.events.off('action/sui_data', on_input)
    }
  })

  it('dispatches no inventory input when the mint effect rejects', async () => {
    await dispatch_and_wait('action/sui_login', { address: '0xowner-a' })
    const inputs = []
    const on_input = (input) => inputs.push(input)
    context.events.on('action/sui_data', on_input)

    try {
      await expect(
        mint_and_reduce_inventory('0xresult', [template_id], {
          mint_and_burn: async () => {
            throw new Error('preflight failed')
          },
          load_templates: async () => templates,
          reducer_door: context,
        })
      ).rejects.toThrow('preflight failed')
      await settle_engine()

      expect(inputs).toEqual([])
      expect(context.get_state().sui.items.some((item) => item.id === loot_id)).toBe(false)
    } finally {
      context.events.off('action/sui_data', on_input)
    }
  })
})
