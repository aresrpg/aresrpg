// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

import { shape_market_snapshot } from '../../src/reads/get_market_slice.ts'

test('marketplace snapshots retain indexed rolls and weapon damage without extra reads', () => {
  const damages = [{ element: 'fire', from: 3, to: 7, damage_type: 'damage' }]
  const stats = ITEM_STAT_FIELDS.map((stat) => (stat === 'strength' ? 32_795 : 32_768))
  const { listings } = shape_market_snapshot([
    {
      asset: {
        properties: {
          id: 'item',
          name: 'Weapon',
          item_type: 'weapon',
          category: 'weapon',
          level: 1,
          amount: 1,
          stats,
          damages: JSON.stringify(damages),
        },
      },
      kinds: ['Item'],
      price_mist: '10',
      at_ms: 1,
      kiosk: 'kiosk',
      seller: 'owner',
      version: '42',
    },
    {
      asset: { properties: { id: 'character', name: 'Character', classe: 'iop', level: 30 } },
      kinds: ['Character'],
      price_mist: '20',
      at_ms: 1,
      kiosk: 'kiosk',
      seller: 'owner',
      version: '43',
    },
  ])
  expect(listings[0]).toMatchObject({ version: '42', stats: { strength: 32_795, vitality: 32_768 }, damages })
  expect(listings[1]).not.toHaveProperty('stats')
  expect(listings[1]).not.toHaveProperty('damages')
})
