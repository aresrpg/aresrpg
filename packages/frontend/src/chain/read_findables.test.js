// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, expect, spyOn, test } from 'bun:test'

import * as rpc_client from '../rpc/client'

import * as chain_sdk from './sdk'
import { item_type_id } from './item_lineage'

const encyclopedia_calls = []
const get_encyclopedia = spyOn(rpc_client, 'get_encyclopedia').mockImplementation(async (...args) => {
  encyclopedia_calls.push(args)
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

const { get_template_by_item_type_map, get_template_map, get_owned_items_by_id } = await import('./read_findables.js')

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
    display: null,
  })
  expect(by_type.get('pet_lootbox')?.id).toBe('0xbox')
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

// --- get_owned_items_by_id — dead-lineage objects never enter the result (issue #524) ------------------------
// core.getObjects' default read mask always carries each object's normalised `type` (no extra RPC — see
// item_lineage.ts). A retired-universe id (a republish never deletes the old on-chain object) must be dropped
// here rather than surfacing as a fallback-glyph cube with no catalog row downstream.
test('get_owned_items_by_id drops a dead-lineage object; a current-lineage sibling survives', async () => {
  expect(item_type_id()).not.toBe('') // guards against a false-green on an empty (match-everything) filter

  const CURRENT_ID = '0xcurrent-item'
  const DEAD_ID = '0xghost-item'
  const DEAD_LINEAGE = '0xdead' // a retired package universe — any id distinct from the live deployment's
  const grpc_client = {
    core: {
      getObjects: async ({ objectIds }) => ({
        objects: objectIds.map((id) => {
          if (id === CURRENT_ID)
            return {
              objectId: id,
              type: item_type_id(),
              json: { name: 'Fresh Pet', item_type: 'pet_fox', level: 1, amount: 1 },
            }
          if (id === DEAD_ID)
            return {
              objectId: id,
              type: `${DEAD_LINEAGE}::item::Item`,
              json: { name: 'Ghost Pet', item_type: 'pet_ghost', level: 1, amount: 1 },
            }
          return new Error(`unexpected id: ${id}`)
        }),
      }),
    },
  }

  const rows = await get_owned_items_by_id(grpc_client, [CURRENT_ID, DEAD_ID])
  expect(rows.map((r) => r.id)).toEqual([CURRENT_ID])
  expect(rows.find((r) => r.id === DEAD_ID)).toBeUndefined()
})
