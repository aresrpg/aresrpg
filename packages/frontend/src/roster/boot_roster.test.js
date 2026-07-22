// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { get_total_stat } from '@aresrpg/sdk/stats'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { character_max_hp } from '../chain/read_character.js'

reset_auth_mock()

const { rpc_to_card } = await import('./boot_roster.js')

describe('rpc_to_card equipment projection', () => {
  test('preserves nested equipment and worn for the Equipment tab', () => {
    const equipment = [{ item_id: '0xcloak', template: '0xtpl', category: 'cloak', amount: 1 }]
    const worn = { cloak: { item_id: '0xcloak', template_id: '0xtpl', category: 'cloak' } }
    const card = rpc_to_card({
      id: '0xcharacter',
      name: 'Tomodo',
      class: 'tomoda',
      experience: 0,
      equipment,
      worn,
    })

    expect(card.equipment).toBe(equipment)
    expect(card.worn).toBe(worn)
    expect(card.cloak).toBe(worn.cloak)
  })

  test('maps /v1 base and equipped stats into the shared effective-stat derivation', () => {
    const card = rpc_to_card({
      id: '0xcharacter',
      name: 'Senshi',
      class: 'senshi',
      experience: 0,
      vitality: 0,
      current_hp: 70,
      hp_updated_ms: 123,
      gear_vitality: 3,
      equipment_stats: { vitality: 3, strength: -2, action: 1 },
      equipment: [{ item_id: '0xhat', template: '0xtpl', category: 'hat', amount: 1 }],
    })

    expect(character_max_hp(card)).toBe(73)
    expect(get_total_stat(card, 'ap')).toBe(7)
    expect(card).toMatchObject({
      current_hp: 70,
      hp_updated_ms: 123,
      gear_vitality: 3,
      equipment_stats: { vitality: 3, strength: -2, action: 1 },
    })
  })

  test('carries only an authoritatively equipped pet without synthesizing world mount behavior', () => {
    const pet = { item_id: '0xpet', template_id: '0xtemplate', slug: 'pet_bouloute' }
    const equipped = rpc_to_card({
      id: '0xcharacter',
      name: 'Tomodo',
      class: 'tomoda',
      experience: 0,
      pet,
      pet_equipped: true,
    })
    expect(equipped.pet).toBe(pet)
    expect(equipped.pet_equipped).toBe(true)
    expect('mount' in equipped).toBe(false)

    const stale = rpc_to_card({
      id: '0xcharacter',
      name: 'Tomodo',
      class: 'tomoda',
      experience: 0,
      pet,
      pet_equipped: false,
    })
    expect(stale.pet).toBeNull()
    expect(stale.pet_equipped).toBe(false)
    expect('mount' in stale).toBe(false)

    const identity_lag = rpc_to_card({
      id: '0xcharacter',
      name: 'Tomodo',
      class: 'tomoda',
      experience: 0,
      pet: null,
      pet_equipped: true,
    })
    expect(identity_lag.pet).toBeNull()
    expect(identity_lag.pet_equipped).toBe(true)
    expect('mount' in identity_lag).toBe(false)
  })
})
