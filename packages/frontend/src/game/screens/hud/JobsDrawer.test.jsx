// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The in-game Jobs drawer's recipe grid, rendered off the LIVE /v1 projection (issue #765).
//
// The bug this pins: every profession rendered `jobs.recipes.empty_seed` ("recipes … arrive with the
// crafting content seed") forever, because the grid read the bundled seed snapshot
// (packages/sdk/src/{items,recipes}.json) which is `{}` in this repo BY CONSTRUCTION — the content
// boundary means content reaches the game only as published chain state. Meanwhile 1434 `crafting::Recipe`
// objects were live and `/v1/encyclopedia` had been serving them all along.
//
// Rendered with renderToStaticMarkup (the house HUD-test pattern — see Stats.test.jsx): no DOM library,
// no RPC, no store. The grid is fed the same projection rows craft_recipes_for_job builds from /v1.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

// JobsDrawer reaches the craft tx seam, which pulls in the browser wallet — isolate this DOM-less unit
// surface from Enoki's module-load `window.location` access (the Stats.test.jsx guard). No test below
// executes a wallet action; the grid is pure render.
reset_auth_mock()

const { RecipeGrid } = await import('./JobsDrawer.jsx')

// CAPTURED PROVENANCE: the values are the verbatim live projection read from rpc-redis on 2026-07-25 —
// a real armorsmith (SDK JOBS index 8) recipe minted 07-23, knowledge gate 26, output at level 151.
// Object ids are placeholders (the chain-id gate ratchets on new hardcoded 32-byte ids); nothing here
// asserts a specific id, only that the ids JOIN.
const LIVE_RECIPE = {
  recipe_id: '0xrecipe_feathergilt_visor_crown',
  output_template_id: '0xtpl_feathergilt_visor_crown',
  output_quantity: 1,
  required_job: 8,
  required_level: 26,
  craft_xp: 3448,
  inputs: [{ template_id: '0xtpl_diadem_lattice_crown', quantity: 3 }],
}
const LIVE_ITEMS = [
  {
    template_id: LIVE_RECIPE.output_template_id,
    item_type: 'feathergilt_visor_of_silent_court_crown',
    name: 'Feathergilt Visor Crown',
    description: null,
    level: 151,
    category: 'helmet',
    supply: 0,
    last_sale_mist: null,
  },
  {
    template_id: LIVE_RECIPE.inputs[0].template_id,
    item_type: 'diadem_lattice_crown',
    name: 'Diadem Lattice Crown',
    description: null,
    level: 173,
    category: 'resource',
    supply: 0,
    last_sale_mist: null,
  },
]

const ARMORSMITH = 8
const rows = craft_recipes_for_job([LIVE_RECIPE], LIVE_ITEMS, ARMORSMITH)
const grid = (props) => renderToStaticMarkup(<RecipeGrid on_select={() => {}} {...props} />)

// The rendered EN copy (i18n resolves for real here) and the structural markers the grid groups by.
const EMPTY_COPY = 'Recipes for this profession arrive with the crafting content seed.'
const LOADING_COPY = 'Loading...'
const LOCKED_BLOCK = 'jobs__recipe-block-head is-locked'

describe('RecipeGrid — the served corpus renders rows (issue #765)', () => {
  test('a served recipe renders its row, NOT the empty state', () => {
    const html = grid({ recipes: rows, loading: false, level: 30 })
    expect(html).toContain('Feathergilt Visor Crown')
    expect(html).not.toContain(EMPTY_COPY)
  })

  test('the unlock split follows the CHAIN gate (required_level), not the output item level', () => {
    // The output sits at level 151 while the chain gates at 26, so a level-30 armorsmith can craft it.
    // Gating on the item level (the old bundled behaviour) would have filed this under Locked.
    const at_gate = grid({ recipes: rows, loading: false, level: 30 })
    expect(at_gate).not.toContain(LOCKED_BLOCK)
    // One below the gate flips it, and the card reports the number that actually gates — 26, not 151.
    const under = grid({ recipes: rows, loading: false, level: 25 })
    expect(under).toContain(LOCKED_BLOCK)
    expect(under).toContain('Lv 26')
    expect(under).not.toContain('Lv 151')
  })

  test('absence keeps the honest empty state — nothing is fabricated to fill the grid', () => {
    const html = grid({ recipes: [], loading: false, level: 30 })
    expect(html).toContain(EMPTY_COPY)
    expect(html).not.toContain('Feathergilt')
  })

  test('an in-flight projection reads as LOADING, never as "this job has no recipes"', () => {
    // Loading is not emptiness: the honest-empty copy would lie for as long as the fetch takes.
    const html = grid({ recipes: [], loading: true, level: 30 })
    expect(html).toContain(LOADING_COPY)
    expect(html).not.toContain(EMPTY_COPY)
  })
})

// The root cause of #765, pinned as a SOURCE guard (the content_projection.test.ts pattern): crafting is
// chain content, so no in-game crafting surface may resolve it through the bundled seed catalog. Those
// exports resolve through packages/sdk/src/{items,recipes}.json, which this repo carries as `{}` by
// construction — importing them is not a stale read, it is a guaranteed-empty one, and it renders as
// "arrive with the crafting content seed" forever no matter how much content is live on chain.
describe('crafting reads chain truth, never the bundled seed catalog (#765 root cause)', () => {
  const source = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')
  const BUNDLED_CATALOG_EXPORTS = ['craft_recipes', 'recipe_ingredients', 'craft_affordability']

  for (const file of ['./JobsDrawer.jsx', '../../../world-shell/craft_actions.js']) {
    test(`${file} resolves no recipe through @aresrpg/sdk/jobs`, () => {
      const [sdk_import] = source(file).match(/import \{[^}]*\} from '@aresrpg\/sdk\/jobs'/s) ?? ['']
      for (const symbol of BUNDLED_CATALOG_EXPORTS) expect(sdk_import).not.toContain(symbol)
    })
  }
})
