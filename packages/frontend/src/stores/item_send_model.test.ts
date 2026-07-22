// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { build_item_send_transfer_groups, project_inventory_send_item } from './item_send_model'

const source = (id: string, amount: number, kiosk_id = '0xkiosk') => ({
  id,
  kiosk_id,
  template_id: '0xtemplate',
  item_type: 'wood',
  item_category: 'resource',
  name: 'Wood',
  amount,
})

describe('item SEND source planning', () => {
  test('recovers raw objects hidden behind an aggregated bag stack', () => {
    const item = project_inventory_send_item({ ...source('0xa', 12), amount: 20 }, [
      source('0xa', 12),
      source('0xb', 8),
    ])

    expect(item.amount).toBe(20)
    expect(item.sources).toEqual([
      { id: '0xa', kiosk_id: '0xkiosk', amount: 12 },
      { id: '0xb', kiosk_id: '0xkiosk', amount: 8 },
    ])
  })

  test('plans a partial aggregate as full objects plus at most one split', () => {
    const item = project_inventory_send_item({ ...source('0xa', 12), amount: 20 }, [
      source('0xa', 12),
      source('0xb', 8),
    ])
    const plan = build_item_send_transfer_groups([item], 15n)

    expect(plan.receiver_items).toEqual([{ name: 'Wood', amount: 15n }])
    expect(plan.groups).toEqual([
      {
        kiosk_id: '0xkiosk',
        item_transfers: [
          { item_id: '0xa', amount: 12n, available_amount: 12n },
          { item_id: '0xb', amount: 3n, available_amount: 8n },
        ],
      },
    ])
  })

  test('keeps different personal kiosks in separate gift calls within the same PTB', () => {
    const item = project_inventory_send_item({ ...source('0xa', 12), amount: 20 }, [
      source('0xa', 12, '0xkiosk-a'),
      source('0xb', 8, '0xkiosk-b'),
    ])

    expect(build_item_send_transfer_groups([item], 20n).groups.map((group) => group.kiosk_id)).toEqual([
      '0xkiosk-a',
      '0xkiosk-b',
    ])
  })

  test('refuses a request larger than all recoverable source objects', () => {
    const item = project_inventory_send_item(source('0xa', 5), [source('0xa', 5)])
    expect(() => build_item_send_transfer_groups([item], 6n)).toThrow('AMOUNT_EXCEEDS_AVAILABLE')
  })
})

describe('item SEND icon slug (#491 — the gift strip missed the same template-icon leg the other marketplace surfaces did)', () => {
  test('a cosmetic resolves through the name map, never the generic slot-word item_type', () => {
    const item = project_inventory_send_item({
      id: '0xcloak',
      kiosk_id: '0xkiosk',
      item_type: 'cloak', // the generic slot word shared by every cloak-slot cosmetic (never a map key)
      item_category: 'cosmetic',
      name: 'Lorito Cloak (Sapphire)',
      amount: 1,
    })
    expect(item.slug).toBe('cape_lorito-chance')
  })

  test('an ordinary (non-cosmetic) item still falls back to its own item_type', () => {
    const item = project_inventory_send_item(source('0xa', 1))
    expect(item.slug).toBe('wood')
  })
})
