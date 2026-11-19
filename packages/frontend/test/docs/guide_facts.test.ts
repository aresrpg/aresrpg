// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { content_catalog } from '../../src/content/catalog.ts'
import { character_price_sui, first_hour, market_terms } from '../../src/docs/guide_facts.ts'

test('the first-hour guide names a real starter city, its mobs and its dungeon key', () => {
  const { starter, key } = first_hour
  if (!starter || !key) throw new Error('the content no longer yields a starter city or key')
  const world = content_catalog.world(starter.world)!
  expect(world.entry_level).toBe(Math.min(...content_catalog.worlds.map(({ entry_level }) => entry_level)))
  expect(starter.mobs.length).toBeGreaterThan(0)
  for (const mob of starter.mobs)
    expect(world.mobs.find(({ mob_type }) => mob_type === mob.mob_type)?.cities).toContain(starter.city)
  expect(content_catalog.dungeon(starter.dungeon)?.key).toBe(key.item_type)
})

test('every part of the first tool comes from its recipe, with the best nearby drop source', () => {
  const { tool } = first_hour
  if (!tool) throw new Error('the content no longer yields a craftable farming tool')
  const recipe = content_catalog.item(tool.item.item_type)!.recipe!
  expect(tool.parts.map(({ item, quantity }) => [item.item_type, quantity])).toEqual(
    recipe.ingredients.map(({ item_type, quantity }) => [item_type, quantity])
  )
  const nearby = new Set(first_hour.starter?.mobs.map(({ mob_type }) => mob_type))
  for (const part of tool.parts) {
    const sources = content_catalog.item(part.item.item_type)!.dropped_by
    const local = sources.filter(({ mob }) => nearby.has(mob.mob_type))
    const chances = (local.length ? local : sources).map(({ drop }) => drop.chance_bp)
    expect(part.chance_bp).toBe(chances.length ? Math.max(...chances) : 0)
    expect(part.mob === null).toBe(chances.length === 0)
    // A part a starter mob drops is never sent to a far-away mob with better odds.
    if (local.length) expect(nearby.has(part.mob!.mob_type)).toBe(true)
  }
})

test('stated prices are positive plain numbers, never an empty or zero claim', () => {
  expect(character_price_sui).toBeGreaterThan(0)
  expect(market_terms.royalty_percent).toBeGreaterThan(0)
  expect(market_terms.royalty_floor_sui).toBeGreaterThan(0)
  expect(market_terms.lot_sizes.length).toBeGreaterThan(0)
})
