// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { visible_equipment } from '@aresrpg/protocol'

import { equipment_updates } from '../src/equipment_updates.ts'
import type { EventEnvelope } from '../src/protocol.ts'

const event = (type: 'ItemEquipped' | 'ItemUnequipped', character = '0xc'): EventEnvelope =>
  ({ ckpt: 1, tx: 0, evt: 0, ts_ms: 0, type, data: { character, slot: 'cosmetic_hat', item: '0xi' } }) as EventEnvelope

test('a delayed equip read cannot resurrect a cosmetic after unequip', async () => {
  const first = Promise.withResolvers<{ slot: string; item_type: string }[]>()
  let reads = 0
  const delivered: unknown[] = []
  const { on_event: refresh } = equipment_updates(
    { read: async () => (++reads === 1 ? first.promise : [{ slot: 'hat', item_type: 'new_stat_hat' }]) } as never,
    (character, equipment) => delivered.push({ character, equipment })
  )
  const pending = refresh(event('ItemEquipped'))
  await refresh(event('ItemUnequipped'))
  first.resolve([{ slot: 'cosmetic_hat', item_type: 'stale_cosmetic' }])
  await pending
  expect(delivered).toEqual([
    { character: '0xc', equipment: visible_equipment([{ slot: 'hat', item_type: 'new_stat_hat' }]) },
  ])
})

test('equipment invalidations read current custody and keep each character independent', async () => {
  const queries: unknown[] = []
  const delivered: unknown[] = []
  const { on_event: refresh } = equipment_updates(
    {
      read: async (_query: string, params: unknown) => {
        queries.push(params)
        return [{ slot: 'cosmetic_cloak', item_type: 'cape' }]
      },
    } as never,
    (character, equipment) => delivered.push({ character, equipment })
  )
  await Promise.all([refresh(event('ItemEquipped', '0xa')), refresh(event('ItemUnequipped', '0xb'))])
  expect(queries).toEqual([{ character: '0xa' }, { character: '0xb' }])
  expect(delivered).toHaveLength(2)
  await refresh({ ...event('ItemEquipped', '0xa'), data: { character: '0xa', slot: 'weapon' } })
  await refresh({ type: 'CharacterHeld', data: {} } as EventEnvelope)
  expect(queries).toHaveLength(2)
})
