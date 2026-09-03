// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { gatherable_catalog } from '@aresrpg/immutable'

import airdrop from '../../../../seed/content/airdrop.json'
import items from '../../../../seed/content/items.json'
import mastery from '../../../../seed/content/mastery.json'
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

  test('keeps Siluri feedable and exposes the airdrop pets', () => {
    const pets = encyclopedia_catalog.items.filter(({ category }) => category === 'pet')
    expect(pets.map(({ item_type }) => item_type)).toEqual([
      'siluri',
      'oeuftermath',
      'suicune',
      'suifren_bullshark',
      'suifren_capy',
      'vaporeon',
      'corbac',
      'primemachin',
      'krinan',
      'mosho',
      'beru',
      'talokan',
      'yago',
      'zot',
    ])
    expect(pets[0]).toEqual(expect.objectContaining({ item_type: 'siluri', pet_foods: ['gilded_pet_food'] }))

    const bags = encyclopedia_catalog.items.flatMap((item) =>
      item.item_type.startsWith('bag_') && item.consumable?.type === 'loot_box'
        ? [{ ...item, consumable: item.consumable }]
        : []
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
    expect(encyclopedia_catalog.mastery.offers.map(({ item: _item, ...offer }) => offer)).toEqual(mastery.offers)
  })

  test('authors the holder airdrop and one hundred individual Sui Crate giftcards', () => {
    expect(encyclopedia_catalog.airdrop.showcase.map(({ id }) => id)).toEqual([
      'oeuftermath',
      'suicune',
      'suifren_bullshark',
      'suifren_capy',
      'primemachin',
    ])
    const [vaporeon] = encyclopedia_catalog.airdrop.drops
    expect(vaporeon).toMatchObject({
      id: 'vaporeon_holders_318251937',
      item_type: 'vaporeon',
      amount_each: 1,
    })
    expect(vaporeon?.whitelist).toHaveLength(22)
    expect(new Set(vaporeon?.whitelist).size).toBe(22)
    expect(encyclopedia_catalog.airdrop.giftcards).toEqual(airdrop.giftcards)
    expect(airdrop.giftcards).toHaveLength(100)
    expect(new Set(airdrop.giftcards.map(({ id }) => id)).size).toBe(100)
    expect(airdrop.giftcards.every(({ item_type, amount }) => item_type === 'sui_crate' && amount === 1)).toBeTrue()
    expect(airdrop.giftcards.reduce((total, { amount }) => total + amount, 0)).toBe(100)
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
    expect(
      Object.fromEntries(
        ['FORGER', 'CARVER', 'TAILOR', 'TANNER', 'JEWELER', 'HANDYMAN', 'ALCHEMIST'].map((job) => [
          job,
          encyclopedia_catalog.job(job)?.recipes.length,
        ])
      )
    ).toEqual({ FORGER: 24, CARVER: 20, TAILOR: 42, TANNER: 33, JEWELER: 32, HANDYMAN: 20, ALCHEMIST: 5 })
  })

  test('reset scrolls are direct Mastery rewards, never Sui Crate contents', () => {
    const scrolls = ['scroll_of_oblivion', 'scroll_of_rebirth']
    expect(
      mastery.offers.filter(({ item_type }) => scrolls.includes(item_type)).map(({ item_type }) => item_type)
    ).toEqual(scrolls)
    const crate = items.find(({ item_type }) => item_type === 'sui_crate')
    const rewards = crate?.consumable && 'rewards' in crate.consumable ? crate.consumable.rewards : null
    if (!rewards) throw new Error('sui_crate is not a loot box')
    expect(rewards.some(({ item_type }) => scrolls.includes(item_type))).toBeFalse()
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
