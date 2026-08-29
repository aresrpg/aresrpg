// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { item_categories } from '@aresrpg/immutable'

import {
  content_navigation_domains,
  content_row_level,
  content_row_level_label,
  filter_content_rows,
  find_selected_row,
  content_result_columns,
  item_category_rows,
  item_gatherable_job_rows,
  item_mob_family_rows,
  item_reference_filter_rows,
  item_recipe_job_rows,
  item_types_for_filter,
  mob_filter_rows,
  mob_types_for_protector_visibility,
  order_content_rows,
  reordered_spell_levels,
  row_address,
  spell_row_has_effects,
} from '../../src/editor/content_list.ts'
import { spell_editor_hash, spell_editor_route } from '../../src/editor/content_route_model.ts'
import { replace_json_value, type JsonValue, type SeedEntityRow } from '../../src/editor/seed_editor.ts'

const row = (id: string, name: string, category: string, level: number): SeedEntityRow =>
  Object.freeze({ id, label: name, path: Object.freeze([]), value: Object.freeze({ name, category, level }) })

test('recipes stay loaded data, and items order by level then name beside a category column', () => {
  expect(content_navigation_domains.map(({ id }) => id)).not.toContain('recipes')

  const rows = [row('late', 'Zulu', 'bow', 80), row('alpha', 'Alpha', 'sword', 10), row('beta', 'Beta', 'sword', 10)]
  expect(order_content_rows('items', rows).map(({ id }) => id)).toEqual(['alpha', 'beta', 'late'])
  const categories = item_category_rows(rows)
  expect(categories.map(({ category }) => category)).toEqual([...item_categories])
  expect(categories.find(({ category }) => category === 'bow')?.count).toBe(1)
  expect(categories.find(({ category }) => category === 'sword')?.count).toBe(2)
  expect(categories.find(({ category }) => category === 'hat')?.count).toBe(0)
  expect(categories.find(({ category }) => category === 'consumable')?.count).toBe(0)
})

test('item recipe facets follow effective jobs and item results use two columns', () => {
  const items = [row('flour', 'Flour', 'resource', 1), row('sword', 'Sword', 'sword', 10)]
  const recipes: SeedEntityRow[] = [
    Object.freeze({
      id: 'flour',
      label: 'flour',
      path: Object.freeze([0]),
      value: Object.freeze({ output_type: 'flour', job: 'FARMER', inputs: Object.freeze({ wheat: 2 }) }),
    }),
    Object.freeze({
      id: 'sword',
      label: 'sword',
      path: Object.freeze([1]),
      value: Object.freeze({ output_type: 'sword', inputs: Object.freeze({ ore: 2 }) }),
    }),
  ]

  expect(item_recipe_job_rows(items, recipes)).toEqual([
    { job: 'FARMER', count: 1, item_types: ['flour'] },
    { job: 'FORGER', count: 1, item_types: ['sword'] },
  ])
  expect(content_result_columns('items')).toBe(2)
  expect(content_result_columns('spells')).toBe(1)
  expect(filter_content_rows(items, '', null, null, new Set(['flour'])).map(({ id }) => id)).toEqual(['flour'])
  expect(filter_content_rows(items, 'FLOUR', null, null, new Set(['flour'])).map(({ id }) => id)).toEqual(['flour'])
})

test('item gatherable facets derive profession groups from world resources', () => {
  const items = [row('wheat', 'Wheat', 'resource', 1), row('aloe_vera', 'Aloe', 'resource', 10)]
  const worlds: SeedEntityRow[] = [
    Object.freeze({
      id: 'nauvis',
      label: 'Nauvis',
      path: Object.freeze([0]),
      value: Object.freeze({
        world: 'nauvis',
        resources: Object.freeze([{ item_type: 'wheat' }, { item_type: 'aloe_vera' }]),
      }),
    }),
  ]

  expect(item_gatherable_job_rows(items, worlds)).toEqual([
    { job: 'FARMER', count: 1, item_types: ['wheat'] },
    { job: 'HERBALIST', count: 1, item_types: ['aloe_vera'] },
  ])
})

test('item mob-resource facets derive family ownership from authored loot', () => {
  const items = [
    row('fuwa_wool', 'Fuwa Wool', 'resource', 9),
    row('nifuwa_wool', 'Nifuwa Wool', 'resource', 9),
    row('fuwa_hide', 'Fuwa Hide', 'resource', 9),
    row('nifuwa_hide', 'Nifuwa Hide', 'resource', 9),
    row('fukuo_tidal_horn', "Fukuo's Tidal Horn", 'resource', 16),
  ]
  const mobs: SeedEntityRow[] = [
    Object.freeze({
      id: 'fuwa__white',
      label: 'Fuwa',
      path: Object.freeze([0]),
      value: Object.freeze({
        family: 'fuwa',
        loot: Object.freeze([{ item_type: 'fuwa_wool' }, { item_type: 'fuwa_hide' }]),
      }),
    }),
    Object.freeze({
      id: 'fuwa__black',
      label: 'Nifuwa',
      path: Object.freeze([1]),
      value: Object.freeze({
        family: 'fuwa',
        loot: Object.freeze([{ item_type: 'nifuwa_wool' }, { item_type: 'nifuwa_hide' }]),
      }),
    }),
    Object.freeze({
      id: 'fuwa__fukuo',
      label: 'Fukuo the Ka',
      path: Object.freeze([2]),
      value: Object.freeze({
        family: 'fuwa',
        loot: Object.freeze([{ item_type: 'fukuo_tidal_horn' }]),
      }),
    }),
  ]

  const families = item_mob_family_rows(items, mobs)
  expect(families).toEqual([
    {
      family: 'fuwa',
      count: 5,
      item_types: ['fuwa_wool', 'fuwa_hide', 'nifuwa_wool', 'nifuwa_hide', 'fukuo_tidal_horn'],
    },
  ])
  expect([...item_types_for_filter('mob-family:fuwa', [], [], families)!]).toEqual([
    'fuwa_wool',
    'fuwa_hide',
    'nifuwa_wool',
    'nifuwa_hide',
    'fukuo_tidal_horn',
  ])
})

test('recipe item filters derive resource availability by world and mob family', () => {
  const items = [
    row('wheat', 'Wheat', 'resource', 1),
    row('golden_wheat', 'Golden Wheat', 'resource', 1),
    row('ant_chitin', 'Ant Chitin', 'resource', 4),
    row('boss_eye', 'Boss Eye', 'resource', 20),
    row('foreign_ore', 'Foreign Ore', 'resource', 30),
    row('sword', 'Sword', 'sword', 10),
  ]
  const mobs: SeedEntityRow[] = [
    Object.freeze({
      id: 'ant',
      label: 'Ant',
      path: Object.freeze([0]),
      value: Object.freeze({ family: 'ant', loot: Object.freeze([{ item_type: 'ant_chitin' }]) }),
    }),
    Object.freeze({
      id: 'boss',
      label: 'Boss',
      path: Object.freeze([1]),
      value: Object.freeze({ family: 'boss', loot: Object.freeze([{ item_type: 'boss_eye' }]) }),
    }),
  ]
  const worlds: SeedEntityRow[] = [
    Object.freeze({
      id: 'nauvis',
      label: 'Nauvis',
      path: Object.freeze([0]),
      value: Object.freeze({
        world: 'nauvis',
        mobs: Object.freeze([{ mob_type: 'ant' }]),
        resources: Object.freeze([{ item_type: 'wheat' }]),
        dungeon: Object.freeze({ rooms: Object.freeze([[{ mob_type: 'boss' }]]) }),
      }),
    }),
  ]

  expect(item_reference_filter_rows(items, mobs, worlds)).toEqual([
    { kind: 'category', id: 'sword', count: 1, item_types: ['sword'] },
    {
      kind: 'category',
      id: 'resource',
      count: 5,
      item_types: ['wheat', 'golden_wheat', 'ant_chitin', 'boss_eye', 'foreign_ore'],
    },
    { kind: 'world', id: 'nauvis', count: 4, item_types: ['wheat', 'golden_wheat', 'ant_chitin', 'boss_eye'] },
    { kind: 'family', id: 'ant', count: 1, item_types: ['ant_chitin'] },
    { kind: 'family', id: 'boss', count: 1, item_types: ['boss_eye'] },
  ])
})

test('mob facets derive world biomes, families, elements, and protector professions', () => {
  const mobs: SeedEntityRow[] = [
    Object.freeze({
      id: 'ant',
      label: 'Ant',
      path: Object.freeze([0]),
      value: Object.freeze({ mob_type: 'ant', family: 'ant', element: 'fire' }),
    }),
    Object.freeze({
      id: 'protector_wheat_bricheton',
      label: 'Wheat Protector',
      path: Object.freeze([1]),
      value: Object.freeze({
        mob_type: 'protector_wheat_bricheton',
        family: 'protector',
        element: 'earth',
        role: 'protector',
      }),
    }),
    Object.freeze({
      id: 'ant__samurai',
      label: 'Samurai Ant',
      path: Object.freeze([2]),
      value: Object.freeze({ mob_type: 'ant__samurai', family: 'ant', element: 'fire', role: 'archi' }),
    }),
    Object.freeze({
      id: 'protector_obsidianite',
      label: 'Obsidine',
      path: Object.freeze([3]),
      value: Object.freeze({
        mob_type: 'protector_obsidianite',
        family: 'protector',
        element: 'earth',
        role: 'protector',
      }),
    }),
  ]
  const worlds: SeedEntityRow[] = [
    Object.freeze({
      id: 'nauvis',
      label: 'Nauvis',
      path: Object.freeze([0]),
      value: Object.freeze({
        world: 'nauvis',
        terrain: Object.freeze({ biomes: Object.freeze([{ name: 'plains' }, { name: 'forest' }]) }),
        mobs: Object.freeze([{ mob_type: 'ant', biomes: Object.freeze(['plains']) }]),
        resources: Object.freeze([{ item_type: 'wheat', biomes: Object.freeze(['plains', 'forest']) }]),
      }),
    }),
  ]

  expect(mob_filter_rows(mobs, worlds)).toEqual([
    { kind: 'world', id: 'nauvis', count: 3, mob_types: ['ant', 'ant__samurai', 'protector_wheat_bricheton'] },
    {
      kind: 'biome',
      id: 'nauvis:plains',
      parent: 'nauvis',
      count: 3,
      mob_types: ['ant', 'ant__samurai', 'protector_wheat_bricheton'],
    },
    { kind: 'biome', id: 'nauvis:forest', parent: 'nauvis', count: 1, mob_types: ['protector_wheat_bricheton'] },
    { kind: 'family', id: 'ant', count: 2, mob_types: ['ant', 'ant__samurai'] },
    {
      kind: 'family',
      id: 'protector',
      count: 2,
      mob_types: ['protector_wheat_bricheton', 'protector_obsidianite'],
    },
    {
      kind: 'element',
      id: 'earth',
      count: 2,
      mob_types: ['protector_wheat_bricheton', 'protector_obsidianite'],
    },
    { kind: 'element', id: 'fire', count: 2, mob_types: ['ant', 'ant__samurai'] },
    { kind: 'protector', id: 'FARMER', count: 1, mob_types: ['protector_wheat_bricheton'] },
    { kind: 'protector', id: 'MINER', count: 1, mob_types: ['protector_obsidianite'] },
  ])

  expect(mob_types_for_protector_visibility(mobs, null, true)).toEqual(new Set(['ant', 'ant__samurai']))
  expect(mob_types_for_protector_visibility(mobs, new Set(['ant', 'protector_wheat_bricheton']), true)).toEqual(
    new Set(['ant'])
  )
  expect(mob_types_for_protector_visibility(mobs, new Set(['protector_wheat_bricheton']), false)).toEqual(
    new Set(['protector_wheat_bricheton'])
  )
})

test('mobs order by level-band midpoint then name', () => {
  const mob = (index: number, id: string, name: string, level_min: number, level_max: number): SeedEntityRow =>
    Object.freeze({
      id,
      label: name,
      path: Object.freeze([index]),
      value: Object.freeze({ name, level_min, level_max }),
    })
  const rows = [mob(0, 'high', 'Alpha', 30, 50), mob(1, 'same_z', 'Zulu', 10, 20), mob(2, 'same_a', 'Able', 5, 25)]

  expect(order_content_rows('mobs', rows).map(({ id }) => id)).toEqual(['same_a', 'same_z', 'high'])
  expect(content_row_level('mobs', rows[0]!)).toBe(40)
  expect(content_row_level_label('mobs', rows[0]!)).toBe('Lv. 30–50')

  const edited = Object.freeze({
    ...rows[2]!,
    value: Object.freeze({ name: 'Able', level_min: 90, level_max: 100 }),
  })
  const reordered = order_content_rows('mobs', [rows[0]!, rows[1]!, edited])
  expect(find_selected_row(reordered, row_address(rows[2]!))).toBe(edited)
})

const spell = (index: number, name: string, unlock_level: number): SeedEntityRow =>
  Object.freeze({ id: name, label: name, path: Object.freeze([index]), value: Object.freeze({ name, unlock_level }) })

test('effectless spell rows derive their warning from both normal and critical books', () => {
  const spell_with = (effects: readonly JsonValue[], crit_effects: readonly JsonValue[]): SeedEntityRow =>
    Object.freeze({
      id: 'spell',
      label: 'Spell',
      path: Object.freeze([0]),
      value: Object.freeze({ levels: Object.freeze([{ effects, crit_effects }]) }),
    })

  expect(spell_row_has_effects(spell_with([], []))).toBeFalse()
  expect(spell_row_has_effects(spell_with([{ kind: 0 }], []))).toBeTrue()
  expect(spell_row_has_effects(spell_with([], [{ kind: 0 }]))).toBeTrue()
})

test('dragging a spell re-stamps the class ladder instead of storing an order', () => {
  // the ladder (1, 6, 21, 42) never changes — only which spell sits on each rung
  const rows = [spell(7, 'a', 1), spell(3, 'b', 6), spell(9, 'c', 21), spell(4, 'd', 42)]

  // last spell dragged to the front: it takes level 1, everyone else slides one rung up
  expect(reordered_spell_levels(rows, 3, 0)).toEqual({ 4: 1, 7: 6, 3: 21, 9: 42 })
  // a one-step swap touches only the two rows it moves
  expect(reordered_spell_levels(rows, 1, 2)).toEqual({ 9: 6, 3: 21 })
  // a move inside a tie group changes no level at all
  expect(reordered_spell_levels([spell(0, 'a', 1), spell(1, 'b', 1)], 0, 1)).toBeNull()
  expect(reordered_spell_levels(rows, 2, 2)).toBeNull()
  expect(reordered_spell_levels(rows, 0, 9)).toBeNull()
})

test('selection survives renaming the spell it points at', () => {
  const rows = [spell(0, 'fireball', 1), spell(1, 'heal', 6)]
  const address = row_address(rows[1]!)

  // editing the name re-derives every label id — the address must not move
  const renamed = Object.freeze({
    ...rows[1]!,
    id: 'greater_heal',
    label: 'greater_heal',
    value: replace_json_value(rows[1]!.value, ['name'], 'greater_heal'),
  })
  expect(find_selected_row([rows[0]!, renamed], address)).toBe(renamed)

  // the same label under two classes stays two distinct addresses
  const twin_a = Object.freeze({ ...rows[0]!, path: Object.freeze(['drops', 0]) })
  const twin_b = Object.freeze({ ...rows[0]!, path: Object.freeze(['giftcards', 0]) })
  expect(row_address(twin_a)).not.toBe(row_address(twin_b))
  expect(find_selected_row([twin_a, twin_b], row_address(twin_b))).toBe(twin_b)
  expect(find_selected_row(rows, null)).toBeUndefined()
})

test('class and query filters compose without fighting each other', () => {
  const senshi = Object.freeze({ ...spell(0, 'slash', 1), value: Object.freeze({ name: 'slash', classe: 'senshi' }) })
  const mystic = Object.freeze({ ...spell(1, 'slash', 6), value: Object.freeze({ name: 'slash', classe: 'mystic' }) })
  const other = Object.freeze({ ...spell(2, 'heal', 6), value: Object.freeze({ name: 'heal', classe: 'mystic' }) })

  expect(filter_content_rows([senshi, mystic, other], '', null, 'mystic').map(({ id }) => id)).toEqual([
    'slash',
    'heal',
  ])
  expect(filter_content_rows([senshi, mystic, other], 'HEAL', null, 'mystic').map(({ id }) => id)).toEqual(['heal'])
  expect(filter_content_rows([senshi, mystic, other], 'slash', null, 'senshi').map(({ id }) => id)).toEqual(['slash'])
})

test('spell editor routes survive reload with class and spell identity', () => {
  expect(spell_editor_hash('shugo', 'Truce')).toBe('#content/spells/shugo/Truce')
  expect(spell_editor_route('#content/spells/shugo/Truce')).toEqual({ classe: 'shugo', spell: 'Truce' })
  expect(spell_editor_route('#content/spells/shugo')).toEqual({ classe: 'shugo', spell: null })
  expect(spell_editor_route('#content/items')).toBeNull()
})
