// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { equip_projection_confirms, normalize_equip_items, reconcile_equip_state } from './equip_state_refresh.js'

const character_view = (equipment) => ({ characters: [{ id: '0xcharacter', equipment }] })
const item_view = (template_id) => ({
  items: [
    {
      id: '0xitem',
      item_category: 'resource',
      template_id,
      listed: false,
    },
  ],
})

describe('reconcile_equip_state', () => {
  test('waits for the signed stat snapshot after equipment identity has caught up', () => {
    const expected_change = { equipped_ids: ['0xitem'], unequipped_ids: [] }
    const items = []
    expect(
      equip_projection_confirms({ equipment: [{ item_id: '0xitem' }], equipment_stats: null }, items, expected_change)
    ).toBe(false)
    expect(
      equip_projection_confirms(
        { equipment: [{ item_id: '0xitem' }], equipment_stats: { vitality: 3 } },
        items,
        expected_change
      )
    ).toBe(true)
  })

  test('drains older reads, applies the second cache-bypassed projection, then reports success', async () => {
    const calls = []
    const responses = [character_view(['old']), item_view('0xold'), character_view(['fresh']), item_view('0xfresh')]
    let written = null
    const refreshed = await reconcile_equip_state(
      { address: '0xowner', character_id: '0xcharacter' },
      {
        read: async (...args) => {
          calls.push(args)
          return responses.shift()
        },
        get_state: () => ({ sui: { characters: [{ id: '0xcharacter', vitality: 9 }] } }),
        write: (payload) => {
          written = payload
        },
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
      }
    )

    expect(refreshed).toBe(true)
    expect(calls).toHaveLength(4)
    expect(calls.every(([, , , fresh]) => fresh === true)).toBe(true)
    expect(written.characters[0]).toEqual({ id: '0xcharacter', vitality: 9, equipment: ['fresh'] })
    expect(written.items[0]).toMatchObject({ template_id: '0xfresh', stackable: true })
  })

  test('an incomplete authoritative wave rejects without writing', async () => {
    let writes = 0
    const responses = [character_view([]), item_view('0xold'), { characters: [] }, item_view('0xfresh')]
    await expect(
      reconcile_equip_state(
        { address: '0xowner', character_id: '0xcharacter' },
        {
          read: async () => responses.shift(),
          write: () => {
            writes += 1
          },
        }
      )
    ).rejects.toThrow('did not return the selected character')
    expect(writes).toBe(0)
  })

  test('an owner change before the atomic store write leaves state untouched', async () => {
    let checks = 0
    let writes = 0
    const responses = [character_view([]), item_view('0xold'), character_view(['fresh']), item_view('0xfresh')]
    await expect(
      reconcile_equip_state(
        { address: '0xowner', character_id: '0xcharacter' },
        {
          read: async () => responses.shift(),
          get_state: () => ({ sui: { characters: [] } }),
          write: () => {
            writes += 1
          },
          map_character: (row) => row,
          is_current: () => (checks += 1) === 1,
        }
      )
    ).rejects.toThrow('owner changed before store write')
    expect(writes).toBe(0)
  })

  test('normalization preserves exact template provenance and excludes listed rows', () => {
    const rows = [item_view('0xexact').items[0], { ...item_view('0xlisted').items[0], listed: true }]
    expect(normalize_equip_items(rows)).toEqual([expect.objectContaining({ template_id: '0xexact', stackable: true })])
  })

  test('waits past a stale post-tx projection, then replaces only the confirmed character row', async () => {
    const cloak = {
      id: '0xcloak',
      template_id: '0xtemplate',
      item_type: 'cloak',
      item_category: 'cloak',
      listed: false,
    }
    const projected = { item_id: cloak.id, template: cloak.template_id, category: 'cloak' }
    const characters = (equipment, other_name) => ({
      characters: [
        { id: '0xcharacter', equipment, equipment_stats: {} },
        { id: '0xother', equipment: [], name: other_name },
      ],
    })
    const responses = [
      characters([], 'old drain'),
      { items: [cloak] },
      characters([], 'stale wave'),
      { items: [cloak] },
      characters([projected], 'stale unrelated row'),
      { items: [] },
    ]
    const current_other = { id: '0xother', equipment: [{ item_id: '0xkeep' }], name: 'Keep me' }
    const writes = []
    const calls = []

    await reconcile_equip_state(
      {
        address: '0xowner',
        character_id: '0xcharacter',
        expected_change: { equipped_ids: [cloak.id], unequipped_ids: [] },
      },
      {
        read: async (...args) => {
          calls.push(args)
          return responses.shift()
        },
        get_state: () => ({
          sui: { characters: [{ id: '0xcharacter', equipment: [], vitality: 9 }, current_other] },
        }),
        write: (payload) => writes.push(payload),
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
        wait: async () => {},
      }
    )

    expect(calls).toHaveLength(6)
    expect(calls.every(([, , , fresh]) => fresh === true)).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0].characters).toEqual([
      { id: '0xcharacter', equipment: [projected], equipment_stats: {}, vitality: 9 },
      current_other,
    ])
    expect(writes[0].items).toEqual([])
  })

  // #526 field report ("equipped my Cryofin pet, didn't see it before refreshing") / #679 sibling finding:
  // a pet's identity never rides character.equipment (views.js's character_pet_projection is a DEDICATED
  // sibling snapshot — pet/pet_equipped), so the pre-fix equipped_ids_of could never find a pet's expected
  // id "confirmed" no matter how many attempts ran.
  test('a pet equip confirms through the SAME projection door as gear (#526/#679-sibling)', async () => {
    const equipped_character = {
      id: '0xcharacter',
      equipment: [],
      equipment_stats: { vitality: 3 },
      pet_equipped: true,
      pet: { item_id: '0xcryofin', template_id: '0xcryofintpl', slug: 'cryofin' },
    }
    // Enough pairs to cover a full drain + 4-attempt exhaustion (pre-fix reality) — the fixed code
    // confirms on attempt 0 and simply never consumes the rest.
    const responses = Array(5)
      .fill([{ characters: [equipped_character] }, { items: [] }])
      .flat()
    const writes = []
    const refreshed = await reconcile_equip_state(
      {
        address: '0xowner',
        character_id: '0xcharacter',
        expected_change: { equipped_ids: ['0xcryofin'], unequipped_ids: [] },
      },
      {
        read: async () => responses.shift(),
        get_state: () => ({ sui: { characters: [{ id: '0xcharacter' }], selected_address: null } }),
        write: (payload) => writes.push(payload),
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
        wait: async () => {},
      }
    )
    expect(refreshed).toBe(true)
    expect(writes).toHaveLength(1)
    // This is what feeds embed_voxel_player.js's per-frame `resolve_pet_companion(live)` (game/
    // pet_companion_resolver.js) once the store's sui.characters row lands — the companion rig spawns off
    // exactly these two fields, no reload required.
    expect(writes[0].characters[0]).toMatchObject({
      pet_equipped: true,
      pet: { item_id: '0xcryofin', slug: 'cryofin' },
    })
  })

  // The unequip half of the same blindness is a DIFFERENT failure shape, not a throw: equipped_ids_of never
  // added the pet id in the first place, so the "must be ABSENT from equipment" half of the confirm check
  // was already vacuously true regardless of whether pet_equipped had actually caught up. Pre-fix this lets
  // reconcile_equip_state confirm — and write — a STALE pet_equipped:true row the instant the bag alone
  // catches up, racing ahead of the character doc's own object-snapshot convergence.
  test('a pet unequip never confirms a stale pet_equipped:true off the bag alone (#526/#679-sibling)', async () => {
    const stale_still_equipped = {
      id: '0xcharacter',
      equipment: [],
      equipment_stats: { vitality: 3 },
      pet_equipped: true, // the object-snapshot side hasn't caught up to the chain-confirmed unequip yet
      pet: { item_id: '0xcryofin', template_id: '0xcryofintpl', slug: 'cryofin' },
    }
    const converged_unequipped = {
      id: '0xcharacter',
      equipment: [],
      equipment_stats: { vitality: 3 },
      pet_equipped: false,
      pet: null,
    }
    const loose_pet_row = { id: '0xcryofin', item_category: 'pet', template_id: '0xcryofintpl', listed: false }
    const responses = [
      { characters: [stale_still_equipped] },
      { items: [loose_pet_row] }, // drain
      { characters: [stale_still_equipped] },
      { items: [loose_pet_row] }, // attempt 0 — bag already caught up, pet_equipped hasn't
      { characters: [converged_unequipped] },
      { items: [loose_pet_row] }, // attempt 1 — both sides converged
    ]
    const writes = []
    const refreshed = await reconcile_equip_state(
      {
        address: '0xowner',
        character_id: '0xcharacter',
        expected_change: { equipped_ids: [], unequipped_ids: ['0xcryofin'] },
      },
      {
        read: async () => responses.shift(),
        get_state: () => ({ sui: { characters: [{ id: '0xcharacter' }], selected_address: null } }),
        write: (payload) => writes.push(payload),
        map_character: (row) => row,
        mask_items: (rows) => rows,
        merge_items: (rows) => rows,
        wait: async () => {},
      }
    )
    expect(refreshed).toBe(true)
    expect(writes).toHaveLength(1)
    // Must carry the CONVERGED pet state (attempt 1), never the attempt-0 stale snapshot — a premature
    // confirm here is a silent wrong write, not a thrown error, so the companion would wrongly persist.
    expect(writes[0].characters[0]).toMatchObject({ pet_equipped: false, pet: null })
  })
})
