// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { craft_job_of } from '@aresrpg/immutable'

import airdrop from '../../../../seed/content/airdrop.json'
import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import shop from '../../../../seed/content/shop.json'
import spells from '../../../../seed/content/spells.json'
import worlds from '../../../../seed/content/worlds.json'
import { item_power_summary, item_upu_budget } from '../../src/admin/item_power.ts'
import {
  admin_content_domains,
  editable_json_paths,
  entity_asset_reference,
  entity_rows,
  is_readonly_seed_path,
  replace_json_value,
  type JsonValue,
} from '../../src/admin/seed_editor.ts'

const corpus = Object.freeze({ airdrop, items, mobs, recipes, shop, spells, worlds })

const leaf_paths = (value: unknown, path: readonly (string | number)[] = []): readonly string[] => {
  if (value === null || typeof value !== 'object') return [path.join('.')]
  return Object.entries(value).flatMap(([key, child]) =>
    leaf_paths(child, [...path, Array.isArray(value) ? Number(key) : key])
  )
}

describe('seed editor model', () => {
  test('covers every authored seed file and every JSON leaf', () => {
    expect(admin_content_domains.map(({ id }) => String(id))).toEqual(Object.keys(corpus))
    for (const domain of admin_content_domains) {
      const value = corpus[domain.id]
      expect(editable_json_paths(value)).toEqual(leaf_paths(value))
    }
  })

  test('projects stable entity rows for every domain', () => {
    expect(entity_rows('items', items)).toHaveLength(1980)
    expect(entity_rows('mobs', mobs)).toHaveLength(383)
    expect(entity_rows('spells', spells)).toHaveLength(240)
    expect(entity_rows('recipes', recipes)).toHaveLength(1477)
    expect(entity_rows('worlds', worlds)).toHaveLength(20)
    expect(entity_rows('shop', shop)).toHaveLength(36)
    expect(entity_rows('airdrop', airdrop).length).toBeGreaterThan(0)
    expect(entity_rows('items', items)[0]?.label).toBe(items[0].name)
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

  test('updates deeply without mutating or dropping unknown siblings', () => {
    const source = Object.freeze({ known: Object.freeze([{ value: 1, future: 'preserve' }]), sibling: true })
    const changed = replace_json_value(source, ['known', 0, 'value'], 2)
    expect(changed).toEqual({ known: [{ value: 2, future: 'preserve' }], sibling: true })
    expect(source.known[0].value).toBe(1)
  })

  test('locks only an item identity, not item references in other content', () => {
    expect(is_readonly_seed_path('items', ['item_type'])).toBe(true)
    expect(is_readonly_seed_path('items', ['loot', 0, 'item_type'])).toBe(false)
    expect(is_readonly_seed_path('mobs', ['loot', 0, 'item_type'])).toBe(false)
  })

  test('derives the relevant icon identity for authored entities', () => {
    expect(entity_asset_reference('items', items[0] as unknown as JsonValue)).toEqual({
      kind: 'item',
      id: items[0].item_type,
    })
    expect(entity_asset_reference('mobs', mobs[0])).toEqual({ kind: 'mob', id: mobs[0].mob_type })
    expect(entity_asset_reference('recipes', recipes[0])).toEqual({ kind: 'item', id: recipes[0].output_type })
    expect(entity_asset_reference('spells', spells[0])).toEqual({
      kind: 'spell',
      classe: spells[0].classe,
      name: spells[0].name,
    })
  })

  test('uses the Dofus donor-fitted curve, weights, and variance bands', () => {
    expect(item_upu_budget(80)).toBe(663)
    expect(item_upu_budget(105)).toBe(945)
    expect(item_upu_budget(195)).toBe(2083)
    const power = item_power_summary(items[0] as unknown as JsonValue)
    expect(power).toMatchObject({
      budget: 663,
      p10: 412,
      p90: 1453,
      stat_weight: 201,
      damage_weight: 70,
      total_weight: 271,
    })
    expect(power?.score).toBe(41)
    expect(power?.status).toBe('weak')
    const resource = items.find(({ category }) => category === 'resource')!
    expect(item_power_summary(resource as unknown as JsonValue)).toBeNull()
  })
})
