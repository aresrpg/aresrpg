// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { gatherable_catalog } from '@aresrpg/immutable'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import spells from '../../../../seed/content/spells.json'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'

describe('local encyclopedia catalog', () => {
  test('projects every authored content corpus without a remote read model', () => {
    expect(encyclopedia_catalog.items).toHaveLength(items.length)
    expect(encyclopedia_catalog.mobs).toHaveLength(mobs.length)
    expect(encyclopedia_catalog.spells).toHaveLength(spells.length)
    expect(encyclopedia_catalog.recipes.map(({ output_type }) => output_type)).toEqual(
      recipes.map(({ output_type }) => output_type)
    )
    expect(encyclopedia_catalog.worlds.map(({ world }) => world)).toEqual(['nauvis', 'yakutia'])
  })

  test('derives item and mob cross-links from seed facts', () => {
    const recipe = recipes.find(({ output_type }) => output_type === 'wheat_flour')
    if (!recipe) throw new Error('wheat_flour has no authored recipe')
    const flour = encyclopedia_catalog.item('wheat_flour')
    expect(flour?.recipe?.job).toBe('FARMER')
    expect(flour?.recipe?.ingredients.map(({ item_type, quantity }) => [item_type, quantity])).toEqual(
      Object.entries(recipe.inputs)
    )

    expect(encyclopedia_catalog.item('wheat')?.worlds.map(({ world }) => world)).toEqual(['nauvis'])
    const source = mobs.find(({ mob_type }) => mob_type === 'fuwa__white')
    if (!source) throw new Error('fuwa__white has no authored mob')
    expect(encyclopedia_catalog.mob(source.mob_type)?.loot.map(({ drop }) => drop)).toEqual(source.loot)
    source.loot.forEach((drop) =>
      expect(
        encyclopedia_catalog
          .item(drop.item_type)
          ?.dropped_by.some(({ mob, drop: reverse }) => mob.mob_type === source.mob_type && reverse === drop)
      ).toBeTrue()
    )
  })

  test('keeps pets absent and restores only the deterministic protector resource bags', () => {
    expect(encyclopedia_catalog.items.filter(({ category }) => category === 'pet')).toEqual([])
    const bags = encyclopedia_catalog.items.flatMap((item) =>
      item.consumable?.type === 'loot_box' ? [{ ...item, consumable: item.consumable }] : []
    )
    expect(bags).toHaveLength(33)
    for (const gatherable of gatherable_catalog) {
      const bag = bags.find(({ consumable }) => consumable?.rewards[0]?.item_type === gatherable.item_type)
      if (!bag) throw new Error(`${gatherable.item_type} has no resource bag`)
      expect(bag?.consumable).toEqual({
        type: 'loot_box',
        rewards: [{ item_type: gatherable.item_type, weight: 1, amount: 50 }],
      })
      expect(
        encyclopedia_catalog.mob(gatherable.protector)?.loot.map(({ drop }) => ({
          item_type: drop.item_type,
          chance_bp: drop.chance_bp,
          min_qty: drop.min_qty,
          max_qty: drop.max_qty,
        }))
      ).toEqual([{ item_type: bag.item_type, chance_bp: 10_000, min_qty: 1, max_qty: 1 }])
    }
    expect(encyclopedia_catalog.shop.sales).toEqual([])
  })

  test('derives class and job views from immutable identities', () => {
    expect(encyclopedia_catalog.classes).toHaveLength(12)
    expect(encyclopedia_catalog.classes.every(({ spells }) => spells.length > 0)).toBe(true)
    expect(encyclopedia_catalog.jobs).toHaveLength(11)
    expect(encyclopedia_catalog.job('FARMER')?.resources).toHaveLength(6)
    expect(encyclopedia_catalog.job('HERBALIST')?.resources).toHaveLength(6)
    expect(encyclopedia_catalog.job('MINER')?.resources).toHaveLength(6)
    expect(encyclopedia_catalog.job('FARMER')?.recipes).toHaveLength(11)
    expect(encyclopedia_catalog.job('HERBALIST')?.recipes).toHaveLength(11)
    expect(encyclopedia_catalog.job('MINER')?.recipes).toHaveLength(11)
    expect(encyclopedia_catalog.job('FORGER')?.recipes).toHaveLength(0)
  })

  test('has one filename-addressable icon for every authored spell', () => {
    const slug = (value: string): string =>
      value
        .toLowerCase()
        .replaceAll(/[\u2019']/g, '')
        .replaceAll(/[^a-z0-9]+/g, '_')
        .replaceAll(/^_|_$/g, '')
    const icons = new Set(
      [...new Bun.Glob('*.webp').scanSync(`${import.meta.dir}/../../../../seed/icons/spells`)].map((file) =>
        file.replace(/\.webp$/, '').replaceAll('_', '')
      )
    )
    const missing = encyclopedia_catalog.spells.flatMap(({ classe, name }) => {
      const key = `${classe}_${slug(name)}`.replaceAll('_', '')
      return icons.has(key) ? [] : [name]
    })

    expect(missing).toEqual([])
  })
})
