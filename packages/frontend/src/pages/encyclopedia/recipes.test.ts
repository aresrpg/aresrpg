// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-function tests for the encyclopedia recipe mapping (recipes.ts) — the house laws made executable,
// mirroring loot.test.ts:
//   1. EXACT VALUES — quantities / required job+level / craft xp pass through VERBATIM from the /v1 rows
//      (which mirror the on-chain crafting::Recipe field-for-field) — never derived, never rounded.
//   2. NO FABRICATION / EXISTENCE — pure projections of the /v1 rows: a recipe present only in a static seed
//      catalog (never minted on-chain → absent from the projection) can NEVER render, so "if it's in the
//      encyclopedia, players are 100% sure it's in game".
// No React, no RPC — exercised against the real mapping, not a mock.
//
// Run with: bun test packages/frontend/src/pages/encyclopedia/recipes.test.ts

import { describe, test, expect } from 'bun:test'

import type { RpcEncyclopediaItem, RpcRecipe } from '../../rpc/views'

import { craftable_items_for_job, recipe_for_output, recipes_consuming, short_id } from './recipes'

// The live-localnet jeweler recipe (snapshot_tests.rs REAL_RECIPE_BCS_HEX → the /v1 row shape): two
// 1-quantity ingredients → 1 output, job 11 (jeweler), knowledge level 1, 23 craft xp.
const JEWELER_RECIPE: RpcRecipe = {
  recipe_id: '0x7c10238c25a07efec27bf5b21087faa7282514dee2baabf6ff9fc6f357e4b98c',
  output_template_id: '0x0e4bac0a9ab4e645466fb2e009cabff1668ce4c576b79897d48e6bfe09d80e7f',
  output_quantity: 1,
  required_job: 11,
  required_level: 1,
  craft_xp: 23,
  inputs: [
    { template_id: '0x79623d667a08a16a29e09295872b36e5fa035403bc11ca32798179c54b410148', quantity: 1 },
    { template_id: '0xb04ef0ae8602d22b8f0b67fb4f75b5e54c5f0ab47997d6487fc12d164304461d', quantity: 1 },
  ],
}

const BAKER_RECIPE: RpcRecipe = {
  recipe_id: '0xrecipe_bread',
  output_template_id: '0xtpl_bread',
  output_quantity: 5,
  required_job: 13,
  required_level: 25,
  craft_xp: 480,
  inputs: [{ template_id: '0x79623d667a08a16a29e09295872b36e5fa035403bc11ca32798179c54b410148', quantity: 3 }],
}

const PROJECTION = [JEWELER_RECIPE, BAKER_RECIPE]

describe('recipe_for_output — exact chain values (never derived)', () => {
  test('resolves the recipe by on-chain output template id, values verbatim', () => {
    const r = recipe_for_output(PROJECTION, JEWELER_RECIPE.output_template_id)
    expect(r).not.toBeNull()
    expect(r!.required_job).toBe(11)
    expect(r!.required_level).toBe(1)
    expect(r!.craft_xp).toBe(23)
    expect(r!.output_quantity).toBe(1)
    expect(r!.inputs.map((i) => i.quantity)).toEqual([1, 1])
  })

  test('multi-quantity ingredients + output pass through untouched', () => {
    const r = recipe_for_output(PROJECTION, '0xtpl_bread')
    expect(r!.inputs[0].quantity).toBe(3)
    expect(r!.output_quantity).toBe(5)
    expect(r!.craft_xp).toBe(480)
  })
})

describe('recipe_for_output — existence guarantee (no fabrication)', () => {
  test('a recipe present ONLY in a seed catalog (absent from the /v1 projection) never renders', () => {
    // The seed authoring corpus knows a "legendary_blade" recipe — but it never minted on-chain, so
    // the projection has no row for it. The encyclopedia MUST resolve null (honest "no recipe"),
    // never fall back to the seed data.
    const seed_only_output_template = '0xtpl_legendary_blade_never_minted'
    expect(recipe_for_output(PROJECTION, seed_only_output_template)).toBeNull()
  })

  test('an empty projection renders NOTHING (no static fallback)', () => {
    expect(recipe_for_output([], JEWELER_RECIPE.output_template_id)).toBeNull()
    expect(recipes_consuming([], JEWELER_RECIPE.inputs[0].template_id)).toEqual([])
  })

  test('undefined (still loading) is honest-empty, never throws', () => {
    expect(recipe_for_output(undefined, '0xanything')).toBeNull()
    expect(recipes_consuming(undefined, '0xanything')).toEqual([])
    expect(recipe_for_output(PROJECTION, '')).toBeNull()
    expect(recipes_consuming(PROJECTION, '')).toEqual([])
  })
})

describe('recipes_consuming — the reverse index (INGREDIENT OF)', () => {
  test('finds every recipe consuming a template, with the exact per-recipe quantity', () => {
    // The ore template is input to BOTH recipes: ×1 in the jeweler craft, ×3 in the baker one.
    const rows = recipes_consuming(PROJECTION, JEWELER_RECIPE.inputs[0].template_id)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.quantity).sort()).toEqual([1, 3])
    expect(rows.map((r) => r.recipe.recipe_id)).toContain(BAKER_RECIPE.recipe_id)
  })

  test('a template no on-chain recipe consumes yields [] — honest-empty', () => {
    expect(recipes_consuming(PROJECTION, '0xtpl_bread')).toEqual([])
  })
})

describe('short_id — the honest not-yet-snapshotted fallback', () => {
  test('renders a short id, never a fabricated name', () => {
    const id = '0x' + 'ab'.repeat(32)
    expect(short_id(id)).toBe(`${id.slice(0, 6)}…${id.slice(-4)}`)
  })
})

// Bug report (2026-07-19): the encyclopedia's jobs tab didn't display any recipes for items above
// level 110. Root cause was the JOBS tab reading a STALE bundled seed snapshot (packages/sdk/src
// items.json + recipes.json, legacy-ported, capped at level 110) instead of this SAME /v1 projection
// every other crafting surface (RecipeSections) already reads. craftable_items_for_job is the fix: the
// JOBS tab's item list now comes from the live chain projection, which carries NO level field at all on
// the recipe side — so there is no cutoff to reintroduce, ever.
describe('craftable_items_for_job — the JOBS tab item source (chain truth, no level cutoff)', () => {
  const HIGH_LEVEL_ITEM: RpcEncyclopediaItem = {
    template_id: '0xtpl_void_relic_l120',
    item_type: 'relic',
    name: 'Void-Forged Relic',
    description: null,
    level: 120,
    category: 'relic',
    supply: 3,
    last_sale_mist: null,
  }
  const HIGH_LEVEL_RECIPE: RpcRecipe = {
    recipe_id: '0xrecipe_void_relic_l120',
    output_template_id: HIGH_LEVEL_ITEM.template_id,
    output_quantity: 1,
    required_job: 11, // jeweler (matches JEWELER_RECIPE above)
    required_level: 95,
    craft_xp: 4200,
    inputs: [{ template_id: '0xtpl_ore', quantity: 4 }],
  }
  const LOW_LEVEL_ITEM: RpcEncyclopediaItem = {
    template_id: JEWELER_RECIPE.output_template_id,
    item_type: 'ring',
    name: 'Copper Band',
    description: null,
    level: 5,
    category: 'ring',
    supply: 40,
    last_sale_mist: null,
  }

  test('a level-120 recipe output is included — same job, sorted after the low-level one', () => {
    const rows = craftable_items_for_job([JEWELER_RECIPE, HIGH_LEVEL_RECIPE], [LOW_LEVEL_ITEM, HIGH_LEVEL_ITEM], 11)
    expect(rows.map((r) => r.id)).toEqual([LOW_LEVEL_ITEM.template_id, HIGH_LEVEL_ITEM.template_id])
    expect(rows[1].level).toBe(120)
    expect(rows[1].name).toBe('Void-Forged Relic')
  })

  test('a different required_job is excluded', () => {
    const rows = craftable_items_for_job([HIGH_LEVEL_RECIPE], [HIGH_LEVEL_ITEM], 13 /* baker */)
    expect(rows).toEqual([])
  })

  test('a recipe whose output has no live item row yet is skipped, never fabricated', () => {
    const rows = craftable_items_for_job([HIGH_LEVEL_RECIPE], [], 11)
    expect(rows).toEqual([])
  })

  test('undefined recipes/items or a negative job index is honest-empty, never throws', () => {
    expect(craftable_items_for_job(undefined, [HIGH_LEVEL_ITEM], 11)).toEqual([])
    expect(craftable_items_for_job([HIGH_LEVEL_RECIPE], undefined, 11)).toEqual([])
    expect(craftable_items_for_job([HIGH_LEVEL_RECIPE], [HIGH_LEVEL_ITEM], -1)).toEqual([])
  })
})
