// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import items from '../../../../seed/content/items.json'
import mobs from '../../../../seed/content/mobs.json'
import recipes from '../../../../seed/content/recipes.json'
import spells from '../../../../seed/content/spells.json'
import worlds from '../../../../seed/content/worlds.json'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'

describe('local encyclopedia catalog', () => {
  test('projects every authored content corpus without a remote read model', () => {
    expect(encyclopedia_catalog.items).toHaveLength(items.length)
    expect(encyclopedia_catalog.mobs).toHaveLength(mobs.length)
    expect(encyclopedia_catalog.spells).toHaveLength(spells.length)
    expect(encyclopedia_catalog.recipes.map(({ output_type }) => output_type)).toEqual(
      recipes.map(({ output_type }) => output_type)
    )
    expect(encyclopedia_catalog.worlds.map(({ world }) => world)).toEqual(worlds.map(({ world }) => world))
  })

  test('derives recipe ingredients and mob loot cross-links from the current seed', () => {
    for (const recipe of recipes) {
      const detail = encyclopedia_catalog.item(recipe.output_type)
      expect(detail?.recipe?.ingredients.map(({ item_type, quantity }) => [item_type, quantity])).toEqual(
        Object.entries(recipe.inputs)
      )
    }
    for (const source of mobs) {
      expect(encyclopedia_catalog.mob(source.mob_type)?.loot.map(({ drop }) => drop)).toEqual(source.loot)
      for (const drop of source.loot)
        expect(
          encyclopedia_catalog
            .item(drop.item_type)
            ?.dropped_by.some(({ mob, drop: reverse }) => mob.mob_type === source.mob_type && reverse === drop)
        ).toBeTrue()
    }
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
