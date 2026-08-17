// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'

describe('local encyclopedia catalog', () => {
  test('has no remote or chain data boundary', async () => {
    const directories = [`${import.meta.dir}/../../src/content`, `${import.meta.dir}/../../src/encyclopedia`]
    const sources = await Promise.all(
      directories.flatMap((directory) =>
        [...new Bun.Glob('*.{ts,tsx}').scanSync(directory)].map((file) => Bun.file(`${directory}/${file}`).text())
      )
    )
    const module_source = sources.join('\n')
    expect(module_source).not.toContain('fetch(')
    expect(module_source).not.toContain('@mysten')
    const without_sdk_types = sources.map((source) =>
      source.replace(/import\s+type\s+\{[\s\S]*?\}\s+from\s+['"]@aresrpg\/sdk[^'"]*['"]/g, '')
    )
    expect(without_sdk_types.some((source) => source.includes('@aresrpg/sdk'))).toBeFalse()
    expect(module_source).not.toContain('/rpc')
    expect(module_source).not.toContain('deprecated/')
  })

  test('defines one shared content catalog rather than feature copies', async () => {
    const source_root = `${import.meta.dir}/../../src`
    const files = [...new Bun.Glob('**/*.{ts,tsx}').scanSync(source_root)]
    const definitions = (
      await Promise.all(files.map(async (file) => ({ file, source: await Bun.file(`${source_root}/${file}`).text() })))
    )
      .filter(({ source }) => /export (?:const encyclopedia_catalog|\{[^}]*\bas encyclopedia_catalog\b)/.test(source))
      .map(({ file }) => file)

    expect(definitions).toEqual(['content/catalog.ts'])
  })

  test('keeps authored content imports behind the encyclopedia and admin boundaries', async () => {
    const source_root = `${import.meta.dir}/../../src`
    const files = [...new Bun.Glob('**/*.{ts,tsx}').scanSync(source_root)]
    const imports = (
      await Promise.all(files.map(async (file) => ({ file, source: await Bun.file(`${source_root}/${file}`).text() })))
    )
      .flatMap(({ file, source }) =>
        [...source.matchAll(/seed\/content\/([^'"]+\.json)/g)].map(([, corpus]) => ({ corpus, file }))
      )
      .sort(({ corpus: left }, { corpus: right }) => left.localeCompare(right))

    expect(imports).toEqual([
      { corpus: 'airdrop.json', file: 'content/catalog.ts' },
      { corpus: 'airdrop.json', file: 'admin/seed_content.ts' },
      { corpus: 'items.json', file: 'content/catalog.ts' },
      { corpus: 'items.json', file: 'admin/seed_content.ts' },
      { corpus: 'mobs.json', file: 'content/catalog.ts' },
      { corpus: 'mobs.json', file: 'admin/seed_content.ts' },
      { corpus: 'recipes.json', file: 'content/catalog.ts' },
      { corpus: 'recipes.json', file: 'admin/seed_content.ts' },
      { corpus: 'shop.json', file: 'content/catalog.ts' },
      { corpus: 'shop.json', file: 'admin/seed_content.ts' },
      { corpus: 'spells.json', file: 'content/catalog.ts' },
      { corpus: 'spells.json', file: 'admin/seed_content.ts' },
      { corpus: 'worlds.json', file: 'content/worlds.ts' },
      { corpus: 'worlds.json', file: 'admin/seed_content.ts' },
    ])
  })

  test('projects every authored content corpus without a remote read model', () => {
    expect(encyclopedia_catalog.items).toHaveLength(1980)
    expect(encyclopedia_catalog.mobs).toHaveLength(383)
    expect(encyclopedia_catalog.spells).toHaveLength(240)
    expect(encyclopedia_catalog.recipes).toHaveLength(1477)
    expect(encyclopedia_catalog.worlds).toHaveLength(20)
  })

  test('derives item and mob cross-links from seed facts', () => {
    const aberrant_edge = encyclopedia_catalog.item('aberrant_edge')
    expect(aberrant_edge?.recipe?.job).toBe('SWORD_SMITH')
    expect(aberrant_edge?.recipe?.ingredients.length).toBeGreaterThan(0)

    const wooling = encyclopedia_catalog.mob('wooling')
    expect(wooling?.worlds.map(({ world }) => world)).toContain('01_first_shore')
    expect(wooling?.loot.every(({ item }) => item !== null)).toBe(true)
  })

  test("preserves authored consumable effects and each pet's resource diet", () => {
    expect(encyclopedia_catalog.item('arcane_bread')?.item.consumable).toEqual({ type: 'heal', amount: 1000 })
    expect(encyclopedia_catalog.item('bag_aloe_vera')?.item.consumable).toEqual({
      type: 'loot_box',
      rewards: [{ item_type: 'aloe_vera', weight: 1, amount: 50 }],
    })
    const resource_boxes = encyclopedia_catalog.items.filter(
      ({ consumable }) =>
        consumable?.type === 'loot_box' &&
        consumable.rewards.every(({ item_type }) => encyclopedia_catalog.item(item_type)?.item.category === 'resource')
    )
    expect(resource_boxes.length).toBeGreaterThan(0)
    expect(
      resource_boxes.every(
        ({ consumable }) =>
          consumable?.type === 'loot_box' &&
          consumable.rewards.length === 1 &&
          consumable.rewards[0].weight === 1 &&
          consumable.rewards[0].amount === 50
      )
    ).toBe(true)
    expect(encyclopedia_catalog.item('aetherwing')?.pet_foods.map(({ item_type }) => item_type)).toEqual([
      'wheat',
      'quartz',
    ])
    expect(encyclopedia_catalog.item('pet_aloe_gaia')?.pet_foods.map(({ item_type }) => item_type)).toEqual([
      'aloe_vera',
    ])
    expect(
      encyclopedia_catalog.items
        .filter(({ category }) => category === 'pet')
        .every(({ item_type }) => {
          const foods = encyclopedia_catalog.item(item_type)?.pet_foods ?? []
          return foods.length > 0 && foods.every(({ category }) => category === 'resource')
        })
    ).toBe(true)
  })

  test('derives class and job views from immutable identities', () => {
    expect(encyclopedia_catalog.classes).toHaveLength(12)
    expect(encyclopedia_catalog.classes.every(({ spells }) => spells.length > 0)).toBe(true)
    expect(encyclopedia_catalog.jobs).toHaveLength(15)
    expect(encyclopedia_catalog.job('MINER')?.resources).toHaveLength(11)
    expect(encyclopedia_catalog.job('FARMER')?.recipes).toHaveLength(11)
    expect(encyclopedia_catalog.job('HERBALIST')?.recipes).toHaveLength(17)
    expect(encyclopedia_catalog.job('MINER')?.recipes).toHaveLength(11)
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
      const asset_class = classe === 'yogan' ? 'yogen' : classe
      const key = `${asset_class}_${slug(name)}`.replaceAll('_', '')
      return icons.has(key) ? [] : [name]
    })

    expect(missing).toEqual([])
  })
})
