// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The characters page's pure cores: equipment staging (the client twin of equipment.move's
// guards) and the own-transaction receipt folds (the server never re-sends what a receipt
// proved, so these transitions ARE the client's truth until the next load snapshot).

import { describe, expect, test } from 'bun:test'
import { item_stat_center } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow, ServerPacket } from '@aresrpg/protocol'

import {
  equip_refusal,
  equipment_change_set,
  equipment_map_of,
  natural_slot_for,
  stage_equip,
  stage_unequip,
} from '../../src/characters/equipment_stage.ts'
import { character_max_hp, fold_equipment_stats, projected_hp } from '../../src/game/character_stats.ts'
import { initial_app_state, reduce_app_state, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

const SHIFT = item_stat_center

const character = (overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id: '0xchar',
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 10,
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 10,
  wisdom: 0,
  strength: 5,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 12,
  spells: {},
  available_spell_points: 9,
  jobs: {},
  kiosk: '0xkiosk',
  equipment: [],
  ...overrides,
})

const item = (overrides: Partial<ItemRow> = {}): ItemRow => ({
  id: '0xitem',
  name: 'Veteran Title',
  item_type: 'title_veteran',
  category: 'title',
  level: 5,
  amount: 1,
  kiosk: '0xkiosk',
  ...overrides,
})

const seeded_state = (rows: readonly CharacterRow[], items: readonly ItemRow[]): AppState => {
  const base = initial_app_state(settings)
  const with_characters = reduce_app_state(base, {
    type: 'server/packet',
    packet: { type: 'packet/characters', characters: [...rows] } as ServerPacket,
  })
  return reduce_app_state(with_characters, {
    type: 'server/packet',
    packet: { type: 'packet/inventory', items: [...items] } as ServerPacket,
  })
}

describe('equipment staging', () => {
  test('natural slot picks the first free multi-slot, then falls back to a replace', () => {
    const ring = item({ id: '0xring', category: 'ring', item_type: 'gold_ring' })
    expect(natural_slot_for(ring, {})).toBe('left_ring')
    const worn = stage_equip({}, item({ id: '0xother', category: 'ring' }), 'left_ring')
    expect(natural_slot_for(ring, worn)).toBe('right_ring')
  })

  test('equipment.move guards are predicted: level, category, relic duplicates, listings', () => {
    const guard = (input: ItemRow, slot: Parameters<typeof equip_refusal>[0]['slot'], listed: string[] = []) =>
      equip_refusal({ item: input, slot, character_level: 10, equipment: {}, listed_ids: new Set(listed) })
    expect(guard(item({ level: 50 }), 'title')).toBe('level_too_low')
    expect(guard(item(), 'boots')).toBe('wrong_slot')
    expect(guard(item(), 'title', ['0xitem'])).toBe('item_listed')
    const relic = item({ id: '0xrelic2', category: 'relic', item_type: 'skull_relic' })
    const wearing = stage_equip({}, item({ id: '0xrelic1', category: 'relic', item_type: 'skull_relic' }), 'relic_1')
    expect(
      equip_refusal({ item: relic, slot: 'relic_2', character_level: 10, equipment: wearing, listed_ids: new Set() })
    ).toBe('relic_duplicate')
    expect(guard(item(), 'title')).toBeNull()
  })

  test('the change-set is the staged−real diff; a replace unequips and equips the same slot', () => {
    const real = equipment_map_of(
      character({ equipment: [{ slot: 'title', ...item({ id: '0xold' }), kiosk: undefined } as never] })
    )
    const staged = stage_equip(real, item({ id: '0xnew' }), 'title')
    expect(equipment_change_set(staged, real)).toEqual({
      to_equip: [{ slot: 'title', item_id: '0xnew' }],
      to_unequip: [{ slot: 'title', item_id: '0xold' }],
    })
    expect(equipment_change_set(stage_unequip(real, 'title'), real)).toEqual({
      to_equip: [],
      to_unequip: [{ slot: 'title', item_id: '0xold' }],
    })
  })
})

describe('character receipt folds', () => {
  test('equip fold moves the item into equipment, refolds gear stats, frees the slot back', () => {
    const title = item({ stats: { vitality: SHIFT + 20 } })
    const state = seeded_state([character()], [title])
    const equipped = reduce_app_state(state, {
      type: 'character/equip_folded',
      character_id: '0xchar',
      equipped: [{ slot: 'title', item_id: '0xitem' }],
      unequipped: [],
    })
    const row = equipped.session.characters[0]!
    expect(row.equipment.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: '0xitem', slot: 'title' }])
    expect(row.folded_stats?.vitality).toBe(SHIFT + 20)
    expect(equipped.session.inventory).toHaveLength(0)

    const unequipped = reduce_app_state(equipped, {
      type: 'character/equip_folded',
      character_id: '0xchar',
      equipped: [],
      unequipped: [{ slot: 'title', item_id: '0xitem' }],
    })
    expect(unequipped.session.characters[0]!.equipment).toHaveLength(0)
    expect(unequipped.session.characters[0]!.folded_stats?.vitality).toBe(SHIFT)
    expect(unequipped.session.inventory.map(({ id, kiosk }) => ({ id, kiosk }))).toEqual([
      { id: '0xitem', kiosk: '0xkiosk' },
    ])
  })

  test('stat fold raises the six characteristics and spends the pool', () => {
    const state = seeded_state([character()], [])
    const next = reduce_app_state(state, {
      type: 'character/stats_raised',
      character_id: '0xchar',
      allocation: { vitality: 3, strength: 2 },
    })
    const row = next.session.characters[0]!
    expect(row.vitality).toBe(13)
    expect(row.strength).toBe(7)
    expect(row.available_points).toBe(7)
  })

  test('spell fold costs the CURRENT level (n → n+1 costs n, progression.move law)', () => {
    const state = seeded_state([character({ spells: { fracture: 3 } })], [])
    const next = reduce_app_state(state, {
      type: 'character/spell_raised',
      character_id: '0xchar',
      spell: 'fracture',
    })
    const row = next.session.characters[0]!
    expect(row.spells.fracture).toBe(4)
    expect(row.available_spell_points).toBe(6)
    const fresh = reduce_app_state(next, { type: 'character/spell_raised', character_id: '0xchar', spell: 'ember' })
    expect(fresh.session.characters[0]!.spells.ember).toBe(2)
    expect(fresh.session.characters[0]!.available_spell_points).toBe(5)
  })

  test('consume fold heals against the projected regen and spends one unit off the stack', () => {
    const potion = item({ id: '0xpotion', category: 'consumable', item_type: 'small_potion', amount: 2 })
    const hurt = character({ hp: '10', hp_ms: Date.now() })
    const state = seeded_state([hurt], [potion])
    const next = reduce_app_state(state, {
      type: 'character/consumed',
      character_id: '0xchar',
      item_id: '0xpotion',
      effect: 'heal',
      heal: 25,
    })
    const row = next.session.characters[0]!
    expect(Number(row.hp)).toBeGreaterThanOrEqual(35)
    expect(Number(row.hp)).toBeLessThanOrEqual(character_max_hp(row))
    expect(next.session.inventory[0]!.amount).toBe(1)
    const drained = reduce_app_state(next, {
      type: 'character/consumed',
      character_id: '0xchar',
      item_id: '0xpotion',
      effect: 'heal',
      heal: 25,
    })
    expect(drained.session.inventory).toHaveLength(0)
  })

  test('reset folds mirror character.move/progression.move exactly', () => {
    const state = seeded_state([character({ spells: { fracture: 4 } })], [item({ id: '0xreset', amount: 1 })])
    const stats_reset = reduce_app_state(state, {
      type: 'character/consumed',
      character_id: '0xchar',
      item_id: '0xreset',
      effect: 'reset_stats',
      heal: 0,
    })
    const after_stats = stats_reset.session.characters[0]!
    expect(after_stats.vitality).toBe(0)
    expect(after_stats.available_points).toBe(12 + 15)
    const spells_reset = reduce_app_state(state, {
      type: 'character/consumed',
      character_id: '0xchar',
      item_id: '0xreset',
      effect: 'reset_spells',
      heal: 0,
    })
    const after_spells = spells_reset.session.characters[0]!
    expect(after_spells.spells).toEqual({})
    expect(after_spells.available_spell_points).toBe(9)
  })

  test('scribe fold burns ONLY the rune — the capped block arrives via the item stream', () => {
    const gear = item({ id: '0xgear', stats: { vitality: SHIFT + 10 } })
    const rune = item({ id: '0xrune', category: 'rune', item_type: 'rune_vitality_ba', amount: 1 })
    const state = seeded_state([character()], [gear, rune])
    const next = reduce_app_state(state, {
      type: 'character/rune_scribed',
      gear_id: '0xgear',
      rune_item_id: '0xrune',
    })
    expect(next.session.inventory.find(({ id }) => id === '0xgear')!.stats).toEqual(gear.stats)
    expect(next.session.inventory.find(({ id }) => id === '0xrune')).toBeUndefined()
    // the server's item stream then replaces the row with the chain's CAPPED truth
    const streamed = reduce_app_state(next, {
      type: 'server/packet',
      packet: {
        type: 'packet/item_updated',
        item: item({ id: '0xgear', stats: { vitality: SHIFT + 13 } }),
      } as ServerPacket,
    })
    expect(streamed.session.inventory.find(({ id }) => id === '0xgear')!.stats).toEqual({ vitality: SHIFT + 13 })
  })

  test('a replace change-set folds through: same slot unequipped and equipped in one receipt', () => {
    const old_title = item({ id: '0xold', stats: { vitality: SHIFT + 5 } })
    const new_title = item({ id: '0xnew', stats: { vitality: SHIFT + 9 } })
    const worn = character({ equipment: [{ slot: 'title', ...old_title, kiosk: undefined } as never] })
    const state = seeded_state([worn], [new_title])
    const next = reduce_app_state(state, {
      type: 'character/equip_folded',
      character_id: '0xchar',
      equipped: [{ slot: 'title', item_id: '0xnew' }],
      unequipped: [{ slot: 'title', item_id: '0xold' }],
    })
    const row = next.session.characters[0]!
    expect(row.equipment.map(({ id }) => id)).toEqual(['0xnew'])
    expect(row.folded_stats?.vitality).toBe(SHIFT + 9)
    expect(next.session.inventory.map(({ id }) => id)).toEqual(['0xold'])
  })
})

describe('inventory receipt folds', () => {
  test('box open spends one unit and lands a pending box claim', () => {
    const box = item({ id: '0xbox', category: 'consumable', item_type: 'mystery_box', amount: 2 })
    const state = seeded_state([character()], [box])
    const next = reduce_app_state(state, { type: 'inventory/box_opened', box_item_id: '0xbox', claim_id: '0xclaim' })
    expect(next.session.inventory[0]!.amount).toBe(1)
    expect(next.session.claims).toEqual([{ id: '0xclaim', kind: 'box' }])
  })

  test('a settled claim leaves the session; a fresh mint arrives via the item stream', () => {
    const base = seeded_state([character()], [])
    const with_claim = reduce_app_state(base, {
      type: 'inventory/box_opened',
      box_item_id: '0xmissing',
      claim_id: '0xclaim',
    })
    const settled = reduce_app_state(with_claim, { type: 'inventory/claim_settled', claim_id: '0xclaim' })
    expect(settled.session.claims).toEqual([])
    const minted = reduce_app_state(settled, {
      type: 'server/packet',
      packet: {
        type: 'packet/item_updated',
        item: item({ id: '0xminted', category: 'resource', item_type: 'aloe', amount: 8 }),
      } as ServerPacket,
    })
    expect(minted.session.inventory.find(({ id }) => id === '0xminted')!.amount).toBe(8)
  })

  test('crush removes the gear and lands a crush claim', () => {
    const gear = item({ id: '0xgear', stats: { vitality: SHIFT + 5 } })
    const state = seeded_state([character()], [gear])
    const next = reduce_app_state(state, {
      type: 'inventory/gear_crushed',
      gear_ids: ['0xgear'],
      claim_id: '0xcrush',
    })
    expect(next.session.inventory).toHaveLength(0)
    expect(next.session.claims).toEqual([{ id: '0xcrush', kind: 'crush' }])
  })

  test('pet feed burns one food unit and bumps power + the UTC day gate', () => {
    const pet = item({ id: '0xpet', category: 'pet', item_type: 'tofu', pet_power: 4 })
    const food = item({ id: '0xfood', category: 'resource', item_type: 'wheat', amount: 2 })
    const state = seeded_state([character()], [pet, food])
    const next = reduce_app_state(state, { type: 'inventory/pet_fed', pet_id: '0xpet', food_id: '0xfood' })
    const fed = next.session.inventory.find(({ id }) => id === '0xpet')!
    expect(fed.pet_power).toBe(5)
    expect(fed.pet_last_day).toBe(Math.floor(Date.now() / 86_400_000))
    expect(next.session.inventory.find(({ id }) => id === '0xfood')!.amount).toBe(1)
  })

  test('destroy removes exactly the burned amount', () => {
    const stack = item({ id: '0xjunk', category: 'resource', item_type: 'pebble', amount: 5 })
    const state = seeded_state([character()], [stack])
    const partial = reduce_app_state(state, { type: 'inventory/destroyed', item_id: '0xjunk', amount: 2 })
    expect(partial.session.inventory[0]!.amount).toBe(3)
    const gone = reduce_app_state(partial, { type: 'inventory/destroyed', item_id: '0xjunk', amount: 3 })
    expect(gone.session.inventory).toHaveLength(0)
  })
})

describe('stat derivations', () => {
  test('fold twin matches item_stats.move: centered offsets sum around SHIFT, clamped low', () => {
    const folded = fold_equipment_stats([
      { slot: 'title', ...item({ stats: { vitality: SHIFT + 30, agility: SHIFT - 10 } }) } as never,
      { slot: 'boots', ...item({ id: '0xboots', stats: { vitality: SHIFT + 12 } }) } as never,
    ])
    expect(folded.vitality).toBe(SHIFT + 42)
    expect(folded.agility).toBe(SHIFT - 10)
    expect(folded.strength).toBe(SHIFT)
    // a malus deeper than the center clamps to 0, exactly like the Move fold
    const cursed = fold_equipment_stats([
      { slot: 'title', ...item({ stats: { vitality: SHIFT - 20_000 } }) } as never,
      { slot: 'boots', ...item({ id: '0xboots2', stats: { vitality: SHIFT - 20_000 } }) } as never,
    ])
    expect(cursed.vitality).toBe(0)
  })

  test('a PET folds its POWER-scaled block (api.move law), not its raw roll', () => {
    const pet = {
      slot: 'pet',
      ...item({ id: '0xpet', category: 'pet', stats: { vitality: SHIFT + 60 }, pet_power: 30 }),
    } as never
    expect(fold_equipment_stats([pet]).vitality).toBe(SHIFT + 30)
    const unfed = { slot: 'pet', ...item({ id: '0xpet2', category: 'pet', stats: { vitality: SHIFT + 60 } }) } as never
    expect(fold_equipment_stats([unfed]).vitality).toBe(SHIFT)
  })

  test('hp mirrors progression.move: 50 + 5×level + vitality + gear, lazy 1 hp/s regen, floor 1', () => {
    const row = character({ folded_stats: { vitality: SHIFT + 20 } })
    expect(character_max_hp(row)).toBe(50 + 50 + 10 + 20)
    const now = Date.now()
    expect(projected_hp(character({ hp: '40', hp_ms: now - 10_000 }), now)).toBe(50)
    const just_defeated = character({ hp: '1', hp_ms: now })
    expect(projected_hp(just_defeated, now)).toBe(1)
    expect(projected_hp(just_defeated, now + 999)).toBe(1)
    expect(projected_hp(just_defeated, now + 1_000)).toBe(2)
    // an uninitialized hp DF means full health — pinned as the explicit expected NUMBER
    expect(projected_hp(character(), now)).toBe(110)
    // a gear malus deeper than the base floors max hp at 1, never 0 or negative
    expect(character_max_hp(character({ level: 1, vitality: 0, folded_stats: { vitality: SHIFT - 60_000 } }))).toBe(1)
  })
})

describe('the star-gate join fold', () => {
  test('the receipt WorldJoined re-points world, checkpoint, and arrival coordinates', () => {
    const state = seeded_state([character({ world: 'nauvis', checkpoint_world: 'nauvis', x: 50200, z: 49800 })], [])
    const next = reduce_app_state(state, {
      type: 'character/world_joined',
      character_id: '0xchar',
      joined: { world: 'yakutia', x: 50000, z: 50000, first_join: false },
    })
    const row = next.session.characters[0]!
    expect(row.world).toBe('yakutia')
    expect(row.checkpoint_world).toBe('yakutia')
    expect(row.x).toBe(50000)
    expect(row.z).toBe(50000)
  })

  test('an unknown character id folds to no state change', () => {
    const state = seeded_state([character()], [])
    const next = reduce_app_state(state, {
      type: 'character/world_joined',
      character_id: '0xghost',
      joined: { world: 'yakutia', x: 50000, z: 50000, first_join: true },
    })
    expect(next).toBe(state)
  })
})
