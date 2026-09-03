// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { craft_job_of, gatherable_catalog } from '@aresrpg/immutable'

import airdrop from '../../../../seed/content/airdrop.json'
import fight_boards from '../../../../seed/content/fight_boards.json'
import dungeons from '../../../../seed/content/dungeons.json'
import items from '../../../../seed/content/items.json'
import mastery from '../../../../seed/content/mastery.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import spells from '../../../../seed/content/spells.json'
import structure_packs from '../../../../seed/content/structure_packs.json'
import worlds from '../../../../seed/content/worlds.json'
import { item_power_budget, item_power_summary } from '../../src/editor/item_power.ts'
import {
  editor_autosave_delay_ms,
  editor_domain_autosave_ready,
  editor_domain_saveable,
} from '../../src/modules/editor.ts'
import {
  seed_content_domains,
  editable_json_paths,
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  replace_json_value,
  type JsonValue,
} from '../../src/editor/seed_editor.ts'

const corpus = Object.freeze({
  airdrop,
  dungeons,
  fight_boards,
  items,
  mastery,
  mobs,
  recipes,
  spells,
  structure_packs,
  worlds,
})
const leaf_paths = (value: unknown, path: readonly (string | number)[] = []): readonly string[] => {
  if (value === null || typeof value !== 'object') return [path.join('.')]
  return Object.entries(value).flatMap(([key, child]) =>
    leaf_paths(child, [...path, Array.isArray(value) ? Number(key) : key])
  )
}

describe('seed editor model', () => {
  test('debounces board strokes separately from text fields', () => {
    const [first_board] = fight_boards.boards
    if (!first_board) throw new TypeError('fight board fixture is empty')
    expect(editor_autosave_delay_ms('fight_boards')).toBe(500)
    expect(editor_autosave_delay_ms('items')).toBe(800)
    expect(editor_autosave_delay_ms('spells')).toBe(5_000)
    expect(editor_domain_autosave_ready('spells', 'spells')).toBeFalse()
    expect(editor_domain_autosave_ready('spells', null)).toBeTrue()
    expect(editor_domain_autosave_ready('items', 'spells')).toBeTrue()
    expect(
      editor_domain_saveable('mobs', [
        { mob_type: 'draft', spells: [{ name: 'New spell', levels: [{ effects: [], crit_effects: [] }] }] },
      ])
    ).toBeFalse()
    expect(
      editor_domain_saveable('mobs', [
        {
          mob_type: 'draft',
          spells: [{ name: 'New spell', levels: [{ effects: [{ kind: 0 }], crit_effects: [] }] }],
        },
      ])
    ).toBeTrue()
    expect(editor_domain_saveable('fight_boards', fight_boards)).toBeTrue()
    expect(
      editor_domain_saveable('fight_boards', {
        ...fight_boards,
        boards: [{ ...first_board, start_cells_a: [] }],
      })
    ).toBeFalse()
  })

  test('covers every authored seed file and every JSON leaf', () => {
    expect(seed_content_domains.map(({ id }) => String(id))).toEqual(Object.keys(corpus))
    for (const domain of seed_content_domains) {
      const value = corpus[domain.id]
      expect(editable_json_paths(value)).toEqual(leaf_paths(value))
    }
  })

  test('projects stable entity rows for every domain', () => {
    for (const domain of seed_content_domains) {
      const rows = entity_rows(domain.id, corpus[domain.id])
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length)
    }
    expect(entity_rows('items', items)[0]?.label).toBe(items[0].name)
  })

  test('keeps the boss and archimobs outside the ordinary Nauvis roster', () => {
    const protectors = new Set(gatherable_catalog.map(({ protector }) => protector))
    const curated_mobs = mobs.filter(({ mob_type }) => !protectors.has(mob_type))
    const nauvis = worlds.find(({ world }) => world === 'nauvis')
    const by_type = new Map(curated_mobs.map((mob) => [mob.mob_type, mob]))

    expect(nauvis?.mobs.every(({ mob_type }) => by_type.get(mob_type)?.role === 'normal')).toBeTrue()
    expect(
      curated_mobs
        .filter(({ role }) => role !== 'normal')
        .every(({ mob_type }) => !nauvis?.mobs.some((row) => row.mob_type === mob_type))
    ).toBeTrue()
  })

  test('each city, dungeon, key, and potion uses one matching identity', () => {
    const identities = [
      ['thebes', 'gilded_lorito', 8],
      ['the_ruins', 'tangled_aftermath', 19],
      ['fuwage', 'ivory_rampart', 30],
    ] as const
    const nauvis = worlds.find(({ world }) => world === 'nauvis')

    identities.forEach(([city, dungeon, key_level]) => {
      expect(nauvis?.cities.find(({ city: slug }) => slug === city)?.dungeon).toBe(dungeon)
      expect(dungeons.find(({ dungeon: slug }) => slug === dungeon)?.key).toBe(`key_of_${dungeon}`)
      expect(items.find(({ item_type }) => item_type === `key_of_${dungeon}`)).toMatchObject({
        category: 'key',
        level: key_level,
      })
      expect(items.find(({ item_type }) => item_type === `potion_of_${city}`)?.consumable).toEqual({
        type: 'city',
        city,
      })
    })
  })

  test('recipes author ingredients, never derived XP or output quantity', () => {
    expect(
      recipes.every((recipe) => !Object.hasOwn(recipe, 'craft_xp') && !Object.hasOwn(recipe, 'output_quantity'))
    ).toBe(true)
    const categories = new Map(items.map(({ item_type, category }) => [item_type, category]))
    expect(
      recipes.every((recipe) =>
        craft_job_of(categories.get(recipe.output_type) ?? '')
          ? !Object.hasOwn(recipe, 'job')
          : Object.hasOwn(recipe, 'job')
      )
    ).toBe(true)
  })

  test('player spells keep six levels while mob spells author exactly one', () => {
    expect(spells.every((spell) => spell.levels.length === 6)).toBeTrue()
    expect(mobs.flatMap((mob) => mob.spells).every((spell) => spell.levels.length === 1)).toBeTrue()
  })

  test('updates deeply without mutating or dropping unknown siblings', () => {
    const source = Object.freeze({ known: Object.freeze([{ value: 1, future: 'preserve' }]), sibling: true })
    const changed = replace_json_value(source, ['known', 0, 'value'], 2)
    expect(changed).toEqual({ known: [{ value: 2, future: 'preserve' }], sibling: true })
    expect(source.known[0].value).toBe(1)
  })

  test('adds an optional object leaf while keeping unknown parent paths invalid', () => {
    const source = Object.freeze({ landscape: Object.freeze([{ x: 0, y: 84 }]) })

    expect(replace_json_value(source, ['landscape', 0, 'land'], { surface: 'grass' })).toEqual({
      landscape: [{ x: 0, y: 84, land: { surface: 'grass' } }],
    })
    expect(() => replace_json_value(source, ['missing', 'land'], { surface: 'grass' })).toThrow(
      'Unknown JSON path missing.land'
    )
  })

  test('locks item identity and category, not item references in other content', () => {
    expect(is_readonly_seed_path('items', ['item_type'])).toBe(true)
    expect(is_readonly_seed_path('items', ['category'])).toBe(true)
    expect(is_readonly_seed_path('items', ['loot', 0, 'item_type'])).toBe(false)
    expect(is_readonly_seed_path('mobs', ['loot', 0, 'item_type'])).toBe(false)
    expect(is_readonly_seed_path('mobs', ['mob_type'])).toBe(true)
  })

  test('derives the relevant icon identity for authored entities', () => {
    expect(entity_asset_reference('items', items[0] as unknown as JsonValue)).toEqual({
      kind: 'item',
      id: items[0].item_type,
    })
    expect(entity_asset_reference('mobs', mobs[0])).toEqual({ kind: 'mob', id: mobs[0].mob_type })
    expect(entity_asset_reference('recipes', recipes[0] as unknown as JsonValue)).toEqual({
      kind: 'item',
      id: recipes[0].output_type,
    })
    expect(entity_asset_reference('spells', spells[0])).toEqual({
      kind: 'spell',
      classe: spells[0].classe,
      name: spells[0].name,
    })
  })

  test('uses exact Retro rune power and nearby real-item cohorts', () => {
    expect(item_power_budget(1)).toBe(3.75)
    expect(item_power_budget(60)).toBe(120)
    const retained_tool = items.find(({ item_type }) => item_type === 'old_hoe')!
    const tool = {
      ...retained_tool,
      level: 60,
      stats: {
        min: retained_tool.stats!.min,
        max: { ...retained_tool.stats!.max, wisdom: 60 },
      },
    }
    const power = item_power_summary(tool as unknown as JsonValue)
    expect(power).toMatchObject({
      median: 120,
      p10: 32.5,
      p90: 230,
      corpus_max: 400,
      stat_power: 180,
      sample_count: 141,
    })
    expect(power?.percentile).toBeGreaterThan(0)
    const basic = items.find(({ item_type }) => item_type === 'basic_pickaxe')!
    expect(item_power_summary(basic as unknown as JsonValue)?.comparison).toBe('all gear')
    const resource = items.find(({ category }) => category === 'resource')!
    expect(item_power_summary(resource as unknown as JsonValue)).toBeNull()

    const weapon = item_power_summary({
      level: 50,
      category: 'sword',
      damages: [{ damage_type: 'weapon', element: 'earth', from: 10, to: 20 }],
    })
    expect(weapon).toMatchObject({
      stat_power: 0,
      weapon: { average_per_ap: 3, maximum_per_ap: 4 },
    })

    const bashers_shape = item_power_summary({
      level: 29,
      category: 'daggers',
      damages: [{ damage_type: 'weapon', element: 'earth', from: 10, to: 14 }],
    })
    expect(bashers_shape?.weapon).toMatchObject({ average_per_ap: 4, maximum_per_ap: 4.67 })
    expect(bashers_shape?.weapon?.status).not.toBe('beyond')

    const spindle_shape = item_power_summary({
      level: 30,
      category: 'spear',
      damages: [
        { damage_type: 'weapon', element: 'fire', from: 8, to: 14 },
        { damage_type: 'weapon', element: 'earth', from: 8, to: 14 },
      ],
    })
    expect(spindle_shape?.weapon).toMatchObject({
      donor_family: 'staff',
      average_per_ap: 5.5,
      maximum_per_ap: 7,
      average_p90: 4.5,
      average_max: 5.75,
      maximum_max: 7.5,
      status: 'high',
    })
  })
})
