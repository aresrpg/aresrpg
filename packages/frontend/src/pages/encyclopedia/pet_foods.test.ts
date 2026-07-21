// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET FOOD display join: the encyclopedia shows what food a
// pet is using, and the item detail card in the inventory (hover) does too.
//
// THE MECHANIC UNDER TEST IS PET-AGNOSTIC (uniform law): on-chain, pet::feed_pet checks ONLY global
// membership of the burned food's template in PetFeedConfig.foods (packages/move/aresrpg/sources/pet.move —
// EUnknownFood), never the pet's identity; every configured food = power 1. The per-pet petFeedItemsJson
// lists (seed/pets/feeding_world_pets.json overrides ?? seed/production/release_items.json) are OFFLINE
// AUTHORING INPUTS whose UNION mints the config (seed/generators/pet_feed_payload.mjs canonical_food_slugs).
// So the honest display truth for EVERY pet is the ONE global food set — these tests pin:
//   1. THE DERIVATION (live from seed, same transform the Vite virtual module embeds): union over the
//      mainnet pet corpus of (override ?? production) lists, overrides WIN (pet_modni_lyk eats
//      barley_flour, NOT its pre-fix "wheat"), restricted to slugs that exist as seed RESOURCE rows,
//      sorted + unique, and never containing a pet itself.
//   2. THE JOINS (pure, fixture-driven): encyclopedia rows filter+sort by the food set (honest empty on
//      no match, never a neighbor), hover icons resolve only MINTED slugs via the seed receipt.
//
// Run with: bun test packages/frontend/src/pages/encyclopedia/pet_foods.test.ts

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { pet_food_rows, minted_pet_food_slugs } from './pet_foods'

// MISSING-ARTIFACT (#117): scripts/lib/item_catalog_transform.mjs is content-pipeline tooling, absent by
// design in this public repo. Guarded dynamic import; pet_food_rows/minted_pet_food_slugs below are pure,
// fixture-driven joins with no dependency on the live derivation and keep running for real.
const TRANSFORM_PATH = fileURLToPath(new URL('../../../../../scripts/lib/item_catalog_transform.mjs', import.meta.url))
const PET_FOOD_TRANSFORM_AVAILABLE = existsSync(TRANSFORM_PATH)
const food_slugs = PET_FOOD_TRANSFORM_AVAILABLE
  ? (await import('../../../../../scripts/lib/item_catalog_transform.mjs')).build_pet_food_slugs()
  : []

describe.skipIf(!PET_FOOD_TRANSFORM_AVAILABLE)(
  'build_pet_food_slugs — the global feedable set, derived live from seed',
  () => {
    test('is a non-empty, sorted, unique slug list', () => {
      expect(food_slugs.length).toBeGreaterThan(0)
      expect(food_slugs).toEqual([...new Set(food_slugs)].sort())
      for (const slug of food_slugs) expect(typeof slug).toBe('string')
    })

    test('overrides WIN over the legacy production list (the feeding_world_pets v3 fix)', () => {
      // seed/pets/feeding_world_pets.json pet_modni_lyk: ["barley_flour","orchid_spore_blend"], before: wheat.
      expect(food_slugs).toContain('barley_flour')
      expect(food_slugs).toContain('orchid_spore_blend')
      // "wheat" was the pre-fix RAW gatherable the v3 pass explicitly removed for modni_lyk; it may only be
      // present if ANOTHER pet's list still carries it — pin the exact current truth: it is not.
      expect(food_slugs).not.toContain('wheat')
    })

    test('the D757 phantom foods authored 07-17 are resolvable members', () => {
      expect(food_slugs).toContain('arcane_pastry')
      expect(food_slugs).toContain('spore_cracker')
    })

    test('never contains a pet, only seed RESOURCE rows', () => {
      expect(food_slugs).not.toContain('pet_modni_lyk')
      expect(food_slugs.some((slug: string) => slug.startsWith('pet_'))).toBe(false)
    })
  }
)

describe('pet_food_rows — the encyclopedia join (living /v1 rows -> the food rows a pet page lists)', () => {
  const rows = [
    { id: '0xaaa', slug: 'barley_flour', name: 'Barley Flour', level: 1 },
    { id: '0xbbb', slug: 'tokek_paw', name: 'Tokek Paw', level: 17 },
    { id: '0xccc', slug: 'iron_sword', name: 'Iron Sword', level: 10 }, // not a food
    { id: '0xddd', slug: 'alchemical_base', name: 'Alchemical Base', level: 10 },
    { id: '0xeee', name: 'Slugless Row', level: 3 }, // no slug -> never a food row
  ]
  const foods = ['alchemical_base', 'barley_flour', 'tokek_paw', 'unminted_food']

  test('keeps exactly the rows whose slug is in the food set, level-then-name sorted', () => {
    expect(pet_food_rows(foods, rows).map((row) => row.slug)).toEqual(['barley_flour', 'alchemical_base', 'tokek_paw'])
  })

  test('a food slug with no live row is silently absent (honest gap, never fabricated)', () => {
    expect(pet_food_rows(foods, rows).some((row) => row.slug === 'unminted_food')).toBe(false)
  })

  test('honest empty on no matches', () => {
    expect(pet_food_rows(['nothing_real'], rows)).toEqual([])
    expect(pet_food_rows([], rows)).toEqual([])
  })
})

describe('minted_pet_food_slugs — the hover-row join (seed receipt -> only MINTED foods count)', () => {
  const manifest_items = {
    barley_flour: '0x' + 'a'.repeat(64),
    tokek_paw: '0x' + 'b'.repeat(64),
    failed_food: 'not-an-object-id',
  }

  test('keeps only slugs whose receipt id is a real object id', () => {
    expect(minted_pet_food_slugs(['barley_flour', 'tokek_paw', 'failed_food', 'never_seeded'], manifest_items)).toEqual(
      ['barley_flour', 'tokek_paw']
    )
  })

  test('honest empty when nothing minted', () => {
    expect(minted_pet_food_slugs(['x'], {})).toEqual([])
  })
})
