// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../rpc/client'

import * as chain_sdk from './sdk'

const encyclopedia_calls = []
// #1488 lever: arm ONE read failure. Set by the never-cache-absence test below and consumed on the next call,
// so the shared spy stays a single process-global mock instead of a second, order-fragile one.
let encyclopedia_failure = null
const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia').mockImplementation(async (...args) => {
  encyclopedia_calls.push(args)
  if (encyclopedia_failure) {
    const failure = encyclopedia_failure
    encyclopedia_failure = null
    throw failure
  }
  return {
    items: [
      {
        template_id: '0xbox',
        item_type: 'pet_lootbox',
        name: 'Pet Lootbox',
        description: 'A box with one pet inside.',
        level: 1,
        category: 'consumable',
        supply: 3,
        last_sale_mist: '1000000000',
      },
      {
        template_id: '0xgear',
        item_type: 'windbreak_chestplate',
        name: 'Windbreak',
        level: 40,
        category: 'chestplate',
        supply: 12,
        last_sale_mist: null,
        // Issue #219: /v1 serves the authored StatsMin/MaxKey ranges BIASED (+32768). 32768 == neutral (0),
        // 32800 == +32, 33000 == +232, 32778 == +10, 32788 == +20. The neutral `strength` half must DROP;
        // `range` present on only one half exercises the null-half path.
        stats: {
          vitality: [32800, 33000],
          strength: [32768, 32768],
          raw_damage: [32778, 32788],
          range: [32773, null],
        },
      },
      {
        // #619 leg 3 — a WEAPON row: `damages` is the item_damages::DamagesKey projection, the shape
        // captured off a live template in item_damages_v1.test.js.
        template_id: '0xweapon',
        item_type: 'practice_longsword',
        name: 'Practice Longsword',
        level: 1,
        category: 'longsword',
        supply: 1,
        last_sale_mist: null,
        damages: [{ from: 16, to: 29, damage_type: 'weapon', element: 'water' }],
      },
    ],
    mobs: [],
    worlds: [],
    recipes: [],
  }
})
const get_sdk = spyOn(chain_sdk, 'get_sdk').mockImplementation(async () => {
  throw new Error('chain-direct template reads are forbidden')
})

afterAll(() => {
  get_encyclopedia.mockRestore()
  get_sdk.mockRestore()
})

const { get_template_by_item_type_map, get_template_map, reset_template_cache_for_test } =
  await import('./read_findables.js')

test('template maps resolve exact lootbox identity from the /v1 encyclopedia projection', async () => {
  const by_id = await get_template_map()
  const by_type = await get_template_by_item_type_map()

  expect(get_sdk).not.toHaveBeenCalled()
  expect(encyclopedia_calls).toEqual([['items']])
  expect(by_id.get('0xbox')).toEqual({
    id: '0xbox',
    item_type: 'pet_lootbox',
    name: 'Pet Lootbox',
    category: 'CONSUMABLE',
    level: 1,
    statsJson: '{}',
    damages: [],
    display: null,
  })
  expect(by_type.get('pet_lootbox')?.id).toBe('0xbox')
})

// #619 leg 3 — every owned/template surface resolves its template through THIS map, so a row that drops
// `damages` starves the weapon damage lines on all of them at once (a longsword with no damage block).
test('get_template_map carries the /v1 weapon damage lines onto the template row (#619)', async () => {
  const by_id = await get_template_map()
  const by_type = await get_template_by_item_type_map()

  expect(by_id.get('0xweapon').damages).toEqual([{ from: 16, to: 29, damage_type: 'weapon', element: 'WATER' }])
  // the slug-keyed twin (the inventory bag's join key) carries the same lines
  expect(by_type.get('practice_longsword').damages).toEqual([
    { from: 16, to: 29, damage_type: 'weapon', element: 'WATER' },
  ])
  // a non-weapon template has no DamagesKey field at all → honest empty, never a fabricated line
  expect(by_id.get('0xgear').damages).toEqual([])
})

test('get_template_map decodes the /v1 stat projection into real-valued characteristics (issue #219)', async () => {
  const by_id = await get_template_map()
  const gear = by_id.get('0xgear')

  // RED before the projection was consumed: statsJson was hardcoded '{}', so every card was characteristic-empty.
  const stats = JSON.parse(gear.statsJson)
  expect(stats).toEqual({
    vitality: [32, 232], // 32800/33000 un-biased
    rawDamage: [10, 20], // 32778/32788 un-biased + snake→camel rename
    // one-half-present: min 32773 → +5, absent max half defaults to neutral 0 — item_stats.move's
    // roll_field treats hi <= lo as DEGENERATE (always rolls the fixed lo), so the decoded pair mirrors
    // that same collapse: [5, 5], NEVER the inverted [5, 0] (live-reported "+3 to 0 Vitality" bug, #437).
    range: [5, 5],
  })
  // strength [32768,32768] is the neutral sentinel → DROPPED, never a +0 row
  expect(stats.strength).toBeUndefined()
  // A statless template (the consumable lootbox) stays honest-empty → the card hides its characteristics block
  expect(by_id.get('0xbox').statsJson).toBe('{}')
})

// --- never-cache-absence: a failed catalog read must not poison the session (#1488) --------------------------
// This memo is the ONE catalog every template join reads, including the fight-loot receipt fold
// (loot_inventory.js resolves each ItemMinted row's category through it). A single flaky /v1 round-trip used
// to resolve the memo to an empty Map FOREVER, so every later receipt row came back `item_category: ''` and a
// resource won from a fight filed into the equipment bag — invisible in the resources tab until a page reload
// re-read the catalog. RED before the cure: the second call returns the same poisoned empty map.
test('a failed /v1 encyclopedia read degrades ONCE and the next call re-reads (#1488)', async () => {
  reset_template_cache_for_test()
  encyclopedia_failure = new Error('/v1 encyclopedia unreachable')

  const degraded = await get_template_map()
  expect(degraded.size).toBe(0) // honest: the failing caller gets an empty map, never fabricated templates

  const retried = await get_template_map()
  expect(retried.size).toBeGreaterThan(0) // the absence was NOT memoized — this call re-read the projection
  expect(retried.get('0xbox')?.category).toBe('CONSUMABLE')
})
