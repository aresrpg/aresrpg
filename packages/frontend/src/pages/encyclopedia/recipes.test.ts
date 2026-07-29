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

import {
  craft_affordability_of,
  craft_recipes_for_job,
  recipe_for_output,
  recipes_consuming,
  short_id,
} from './recipes'

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
// every other crafting surface (RecipeSections) already reads. craft_recipes_for_job is the fix: the
// JOBS tab's item list now comes from the live chain projection, which carries NO level field at all on
// the recipe side — so there is no cutoff to reintroduce, ever.
describe('craft_recipes_for_job — the JOBS tab recipe source (chain truth, no level cutoff)', () => {
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
    const rows = craft_recipes_for_job([JEWELER_RECIPE, HIGH_LEVEL_RECIPE], [LOW_LEVEL_ITEM, HIGH_LEVEL_ITEM], 11)
    expect(rows.map((r) => r.id)).toEqual([LOW_LEVEL_ITEM.template_id, HIGH_LEVEL_ITEM.template_id])
    expect(rows[1].level).toBe(120)
    expect(rows[1].name).toBe('Void-Forged Relic')
  })

  test('a different required_job is excluded', () => {
    const rows = craft_recipes_for_job([HIGH_LEVEL_RECIPE], [HIGH_LEVEL_ITEM], 13 /* baker */)
    expect(rows).toEqual([])
  })

  test('a recipe whose output has no live item row yet is skipped, never fabricated', () => {
    const rows = craft_recipes_for_job([HIGH_LEVEL_RECIPE], [], 11)
    expect(rows).toEqual([])
  })

  test('undefined recipes/items or a negative job index is honest-empty, never throws', () => {
    expect(craft_recipes_for_job(undefined, [HIGH_LEVEL_ITEM], 11)).toEqual([])
    expect(craft_recipes_for_job([HIGH_LEVEL_RECIPE], undefined, 11)).toEqual([])
    expect(craft_recipes_for_job([HIGH_LEVEL_RECIPE], [HIGH_LEVEL_ITEM], -1)).toEqual([])
  })

  // DATA-PLUMBING (icon-slug canon): the JOBS tab paints each craftable row's icon through
  // encyclopedia_item_asset, whose key is the row's `item_type`. This projection used to drop that field
  // on the floor (id/name/level/category only), leaving the jobs tab nothing but the display name to
  // guess from — the same starvation the encyclopedia detail showed on "Bag of Quartz".
  test('the projected row carries item_type — the key the icon resolver needs (specimen: bag_quartz)', () => {
    // Mock id in the same shape the fixtures above use — the live template id is not the fact under
    // test (a hardcoded one would drift on republish and trip the chain-id gate); `item_type` is.
    const BAG_OF_QUARTZ: RpcEncyclopediaItem = {
      template_id: '0xtpl_bag_quartz',
      item_type: 'bag_quartz',
      name: 'Bag of Quartz',
      description: null,
      level: 1,
      category: 'consumable',
      supply: 0,
      last_sale_mist: null,
    }
    const bag_recipe: RpcRecipe = { ...JEWELER_RECIPE, output_template_id: BAG_OF_QUARTZ.template_id }
    const [row] = craft_recipes_for_job([bag_recipe], [BAG_OF_QUARTZ], 11)
    expect(row.item_type).toBe('bag_quartz')
  })
})

// ── the IN-GAME Jobs drawer source (issue #765) ────────────────────────────────────────────────
// Issue #765 reported "recipes never seeded — every profession shows the empty state". The premise
// moved under it: the corpus IS live (1434 `rpc:idx:recipes` rows) and /v1/encyclopedia has served it
// since the encyclopedia JOBS tab moved onto this projection. The IN-GAME drawer (JobsDrawer.jsx) was
// the one surface still reading the bundled seed snapshot — packages/sdk/src/{items,recipes}.json,
// which are `{}` in this repo BY CONSTRUCTION (the content boundary: content reaches the game only as
// published chain state). So it rendered `jobs.recipes.empty_seed` for every profession, forever.
// The drawer needs this projection's ingredient rows and live `recipe_id` to fire a craft tx.
//
// CAPTURED PROVENANCE: every VALUE below is the verbatim live projection read from rpc-redis on
// 2026-07-25 (`JSON.GET rpc:recipe:0x5fe1…c3c` plus its five `rpc:template:*` docs) — a real armorsmith
// (job 8) recipe minted 07-23, and identical to what `/v1/encyclopedia?kind=recipes` serves today. Its
// output sits at level 151, ABOVE the bundled catalog's 110 cap: it could never have rendered from the
// seed snapshot, on any code path. Only the object IDS are placeholders (the BAKER_RECIPE convention
// above) — the chain-id gate ratchets on new hardcoded 32-byte ids, and nothing here asserts a
// specific id, only that ids JOIN correctly. The real bytes are pinned once, where the decode actually
// happens: indexer snapshot_tests.rs REAL_RECIPE_BCS_HEX.
const LIVE_ARMORSMITH_RECIPE: RpcRecipe = {
  recipe_id: '0xrecipe_feathergilt_visor_crown',
  output_template_id: '0xtpl_feathergilt_visor_crown',
  output_quantity: 1,
  required_job: 8, // armorsmith (SDK JOBS index)
  required_level: 26,
  craft_xp: 3448,
  inputs: [
    { template_id: '0xtpl_diadem_lattice_crown', quantity: 3 },
    { template_id: '0xtpl_gilded_extract', quantity: 3 },
    { template_id: '0xtpl_throneless_extract', quantity: 3 },
    { template_id: '0xtpl_coronet_resin', quantity: 3 },
  ],
}

/** The five captured `rpc:template:*` docs, in the /v1 items row shape. */
const live_item = (template_id: string, item_type: string, name: string, level: number, category: string) =>
  ({ template_id, item_type, name, description: null, level, category, supply: 0, last_sale_mist: null }) as const

const LIVE_ITEMS: RpcEncyclopediaItem[] = [
  live_item(
    LIVE_ARMORSMITH_RECIPE.output_template_id,
    'feathergilt_visor_of_silent_court_crown',
    'Feathergilt Visor Crown',
    151,
    'helmet'
  ),
  live_item(
    LIVE_ARMORSMITH_RECIPE.inputs[0].template_id,
    'diadem_lattice_crown',
    'Diadem Lattice Crown',
    173,
    'resource'
  ),
  live_item(LIVE_ARMORSMITH_RECIPE.inputs[1].template_id, 'gilded_extract', 'Gilded Extract', 166, 'resource'),
  live_item(LIVE_ARMORSMITH_RECIPE.inputs[2].template_id, 'throneless_extract', 'Throneless Extract', 146, 'resource'),
  live_item(LIVE_ARMORSMITH_RECIPE.inputs[3].template_id, 'coronet_resin', 'Coronet Resin', 167, 'resource'),
]

describe('craft_recipes_for_job — the in-game drawer source (issue #765)', () => {
  test('projects a real live recipe into a craftable row with its bill of materials', () => {
    const [row] = craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS, 8)
    expect(row.id).toBe(LIVE_ARMORSMITH_RECIPE.output_template_id)
    expect(row.recipe_id).toBe(LIVE_ARMORSMITH_RECIPE.recipe_id)
    expect(row.item_type).toBe('feathergilt_visor_of_silent_court_crown')
    expect(row.name).toBe('Feathergilt Visor Crown')
    expect(row.level).toBe(151) // the OUTPUT item's level — display only
    expect(row.required_level).toBe(26) // the on-chain KNOWLEDGE gate (crafting.move EUnderLevel)
    expect(row.craft_xp).toBe(3448)
    expect(row.output_quantity).toBe(1)
    // Ingredients resolve to the SLUG the on-chain bag is keyed by (item::Item.item_type), with the
    // exact chain quantity — never a derived or rounded value.
    expect(row.ingredients).toEqual([
      {
        id: 'diadem_lattice_crown',
        template_id: LIVE_ARMORSMITH_RECIPE.inputs[0].template_id,
        qty: 3,
        name: 'Diadem Lattice Crown',
        level: 173,
      },
      {
        id: 'gilded_extract',
        template_id: LIVE_ARMORSMITH_RECIPE.inputs[1].template_id,
        qty: 3,
        name: 'Gilded Extract',
        level: 166,
      },
      {
        id: 'throneless_extract',
        template_id: LIVE_ARMORSMITH_RECIPE.inputs[2].template_id,
        qty: 3,
        name: 'Throneless Extract',
        level: 146,
      },
      {
        id: 'coronet_resin',
        template_id: LIVE_ARMORSMITH_RECIPE.inputs[3].template_id,
        qty: 3,
        name: 'Coronet Resin',
        level: 167,
      },
    ])
  })

  test('the level-151 output the bundled seed snapshot could never carry is present', () => {
    // The regression this closes: a 110-capped static catalog structurally cannot hold this row.
    expect(craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS, 8).map((r) => r.level)).toEqual([151])
  })

  test('a different job, an unsnapshotted output, or a nullish projection is honest-empty', () => {
    expect(craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS, 11)).toEqual([])
    expect(craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], [], 8)).toEqual([])
    expect(craft_recipes_for_job(undefined, LIVE_ITEMS, 8)).toEqual([])
    expect(craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], undefined, 8)).toEqual([])
    expect(craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS, -1)).toEqual([])
  })

  test('an ingredient whose template has not snapshotted keeps the ROW but carries no slug', () => {
    // Dropping it would understate the bill of materials and let Craft enable on an incomplete tally —
    // the tx would then abort EMissingIngredient on chain. It stays, unresolved and honestly uncountable.
    const rows = craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS.slice(0, 2), 8)
    expect(rows[0].ingredients).toHaveLength(4)
    expect(rows[0].ingredients[0].id).toBe('diadem_lattice_crown')
    expect(rows[0].ingredients[1].id).toBeNull()
    expect(rows[0].ingredients[1].name).toBe(short_id(LIVE_ARMORSMITH_RECIPE.inputs[1].template_id))
  })
})

describe('craft_affordability_of — the client gate mirrors what the craft tx can burn', () => {
  const [ROW] = craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS, 8)

  test('affordable when every ingredient slug is owned in at least the chain quantity', () => {
    const owned = { diadem_lattice_crown: 3, gilded_extract: 9, throneless_extract: 3, coronet_resin: 4 }
    const afford = craft_affordability_of(ROW.ingredients, owned, 1)
    expect(afford.affordable).toBe(true)
    expect(afford.rows.map((r) => r.need)).toEqual([3, 3, 3, 3])
    expect(afford.rows[1].have).toBe(9)
  })

  test('a shortfall is not affordable and names the short row', () => {
    const owned = { diadem_lattice_crown: 3, gilded_extract: 3, throneless_extract: 3, coronet_resin: 2 }
    const afford = craft_affordability_of(ROW.ingredients, owned, 1)
    expect(afford.affordable).toBe(false)
    expect(afford.rows.filter((r) => !r.enough).map((r) => r.id)).toEqual(['coronet_resin'])
  })

  test('count scales every requirement (need = qty × count)', () => {
    const owned = { diadem_lattice_crown: 6, gilded_extract: 6, throneless_extract: 6, coronet_resin: 6 }
    expect(craft_affordability_of(ROW.ingredients, owned, 2).affordable).toBe(true)
    expect(craft_affordability_of(ROW.ingredients, owned, 3).affordable).toBe(false)
  })

  test('an UNRESOLVED ingredient can never count as owned — the gate stays closed', () => {
    const [partial] = craft_recipes_for_job([LIVE_ARMORSMITH_RECIPE], LIVE_ITEMS.slice(0, 2), 8)
    // Even with a bag that covers every KNOWN slug generously, the unresolvable rows keep it closed.
    const owned = { diadem_lattice_crown: 99, gilded_extract: 99, throneless_extract: 99, coronet_resin: 99 }
    const afford = craft_affordability_of(partial.ingredients, owned, 1)
    expect(afford.affordable).toBe(false)
    expect(afford.rows.filter((r) => !r.enough)).toHaveLength(3)
  })

  test('an empty bill of materials is never affordable (nothing to craft)', () => {
    expect(craft_affordability_of([], {}, 1)).toEqual({ rows: [], affordable: false })
  })
})
