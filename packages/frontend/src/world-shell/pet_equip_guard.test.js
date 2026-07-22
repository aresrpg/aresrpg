// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { ITEMS_NS } from '@aresrpg/sdk/sui'

import { legacy_pet_equip_guard } from './pet_equip_guard.js'

const package_id = '0xares'

const guard_with = (value, calls = []) =>
  legacy_pet_equip_guard([{ item_id: '0xpet', item_type: 'pet', slot: 'pet' }], {
    package_id,
    sdk: {
      read_namespaced_field: async (request) => {
        calls.push(request)
        return value
      },
    },
  })

describe('legacy_pet_equip_guard', () => {
  test('refuses a pet whose direct PetPowerKey exceeds the current 60-feed scale', async () => {
    const calls = []

    expect(await guard_with('61', calls)).toEqual({ item_id: '0xpet', item_type: 'pet', slot: 'pet' })
    expect(calls).toEqual([
      {
        object_id: '0xpet',
        namespace: ITEMS_NS.ITEM,
        key_type: `${package_id}::character_link::PetPowerKey`,
      },
    ])
  })

  test('lets absent and in-range pet counters proceed', async () => {
    for (const value of [null, '0', '60']) expect(await guard_with(value)).toBeNull()
  })

  test('does not read or block non-pet equipment', async () => {
    let reads = 0
    const blocked = await legacy_pet_equip_guard([{ item_id: '0xsword', item_type: 'weapon', slot: 'weapon' }], {
      package_id,
      sdk: {
        read_namespaced_field: async () => {
          reads += 1
          return '9000'
        },
      },
    })

    expect(blocked).toBeNull()
    expect(reads).toBe(0)
  })
})
