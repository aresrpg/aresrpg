// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, spyOn, test } from 'bun:test'
import { get_total_stat } from '@aresrpg/sdk/stats'

import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import { character_max_hp } from '../chain/read_character.js'

reset_auth_mock()

const rpc_client = await import('../rpc/client')
const read_character = await import('../chain/read_character.js')
const read_staking = await import('../chain/read_staking.js')
const auto_merge = await import('../world-shell/auto_merge_stacks.js')
const { invalidate } = await import('../chain/kiosk_cap_cache.js')
const { context } = await import('../game/core/game.js')
const { boot_roster, rpc_to_card } = await import('./boot_roster.js')

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

test('#2245 pre-warms the engage kiosk-cap read once, only after the first roster settles', async () => {
  const address = '0x2245-prewarm'
  const roster = [{ id: '0xcharacter', name: 'Senshi', class: 'senshi', experience: 0 }]
  let release_roster
  let settled = false
  const client_read_settle_states = []
  const get_owned_kiosks = async () => {
    client_read_settle_states.push(settled)
    return { kioskOwnerCaps: [] }
  }
  const sdk = {
    kiosk_client: { getOwnedKiosks: get_owned_kiosks },
    grpc_client: {},
    get_creation_state: async () => null,
  }
  const ambient = { dispatch: context.dispatch, get_state: context.get_state }
  const state = { sui: { loaded: false }, selected_character_id: null }
  context.dispatch = (type) => {
    if (type === 'action/sui_data') {
      settled = true
      state.sui.loaded = true
    }
  }
  context.get_state = () => state
  reset_auth_mock({ address })
  set_expedition_sdk_mock(async () => sdk)
  const reads = spyOn(rpc_client, 'get_characters').mockImplementation(
    () =>
      new Promise((resolve) => {
        release_roster = () => resolve(roster)
      })
  )
  const character = spyOn(read_character, 'read_character').mockResolvedValue(null)
  const items = spyOn(read_staking, 'get_owned_items').mockResolvedValue([])
  const custody = spyOn(read_staking, 'get_owned_items_from_kiosks').mockResolvedValue([])
  const sweep = spyOn(auto_merge, 'sweep_duplicate_stacks').mockResolvedValue(undefined)

  try {
    const first_settle = boot_roster()
    await Promise.resolve()
    expect(client_read_settle_states).toEqual([])

    release_roster()
    await first_settle
    await Promise.resolve()
    expect(client_read_settle_states).toEqual([true])

    reads.mockResolvedValue(roster)
    settled = false
    await boot_roster()
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(client_read_settle_states).toEqual([true])
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0))
    sweep.mockRestore()
    custody.mockRestore()
    items.mockRestore()
    character.mockRestore()
    reads.mockRestore()
    invalidate(address)
    reset_expedition_sdk_mock()
    reset_auth_mock()
    context.dispatch = ambient.dispatch
    context.get_state = ambient.get_state
  }
})
