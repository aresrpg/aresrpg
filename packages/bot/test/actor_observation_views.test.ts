// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The detail views of the bot's read path. Regression (owner report 2026-11-22): one observation of
// one hero was 700 KB; the bag held 369 stacks of four items and was returned three times.
import { expect, test } from 'bun:test'

import { actor_observation } from '../src/actor_observation.ts'
import {
  current_zones,
  inventory_view,
  stacks_view,
  STACKS_DEFAULT,
  without_nulls,
  zones_view,
} from '../src/actor_observation_views.ts'

import { character, item, other_input, profession_context, resource } from './helpers/profession_fixture.ts'

/** A bag as the report had it: hundreds of stacks of one item. */
const crowded = () => {
  const context = profession_context()
  const items = Array.from({ length: 300 }, (_, index) => item(other_input, index + 1, 1_000 + index))
  return { ...context.snapshot, inventory: { ...context.snapshot.inventory!, items } }
}

test('the bag is one line per item and kiosk, however many stacks it holds', () => {
  const view = inventory_view(crowded(), {})
  expect(view.items).toEqual([
    {
      item_type: other_input,
      name: other_input,
      category: 'resource',
      level: 1,
      kiosk: character.kiosk,
      amount: (300 * 301) / 2,
      available: (300 * 301) / 2,
      stacks: 300,
    },
  ])
  expect(JSON.stringify(view).length).toBeLessThan(1_000)
  expect(inventory_view(crowded(), { category: 'hat' }).items).toEqual([])
})

test('the stacks of one item are bounded, largest first, and still counted in full', () => {
  const view = stacks_view(crowded(), { item_type: other_input })
  expect(view).toMatchObject({ item_type: other_input, total_stacks: 300, total_amount: (300 * 301) / 2 })
  expect(view.stacks).toHaveLength(STACKS_DEFAULT)
  expect(view.stacks[0]).toEqual({ id: expect.any(String), kiosk: character.kiosk, amount: 300 })
  expect(stacks_view(crowded(), { item_type: other_input, limit: 3 }).stacks.map(({ amount }) => amount)).toEqual([
    300, 299, 298,
  ])
})

test('a zone says what it holds in counts; its monsters and resources come only when asked', () => {
  const { snapshot } = profession_context()
  const key = 'fixture:97:97'
  expect(current_zones(snapshot.characters)).toEqual({ [character.id]: key })
  const [zone] = zones_view(snapshot, {}).zones
  expect(zone).toMatchObject({ key, zone_x: 97, zone_z: 97, heroes: [character.id], mob_groups: 0, resource_packs: 1 })
  expect(zone).not.toHaveProperty('mobs')
  expect(zone).not.toHaveProperty('resources')
  const [detailed] = zones_view(snapshot, { resources: true, mobs: true }).zones
  expect(detailed).toMatchObject({ mobs: [], resources: [{ item_type: resource.item_type }] })
  // A hero the wallet does not hold stands nowhere.
  expect(zones_view(snapshot, { character_id: '0xother' }).zones).toEqual([])
})

test('the status stays small beside a crowded bag and writes no null', () => {
  const context = profession_context()
  const status = actor_observation({ ...context, snapshot: crowded() })
  expect(status).toMatchObject({ inventory: { loaded: true, stacks: 300, item_types: 1 } })
  expect(status).not.toHaveProperty('zones')
  const wire = JSON.stringify(status)
  expect(wire).not.toContain('null')
  expect(wire.length).toBeLessThan(20_000)
  expect(without_nulls({ a: null, b: [{ c: null, d: 0 }], e: false })).toEqual({ b: [{ d: 0 }], e: false })
})
