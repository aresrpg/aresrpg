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
import { MemoryRouter } from 'react-router-dom'
import { JOBS } from '@aresrpg/sdk/jobs'

import { craft_recipes_for_job } from '../../../pages/encyclopedia/recipes'
import { reset_auth_mock } from '../../../test_helpers/auth_mock.js'

const visible_text = (html) => html.replace(/<[^>]+>/g, '')

// JobsDrawer reaches the craft tx seam, which pulls in the browser wallet — isolate this DOM-less unit
// surface from Enoki's module-load `window.location` access (the Stats.test.jsx guard). No test below
// executes a wallet action; the grid is pure render.
reset_auth_mock()

const { JobDetail, RecipeGrid, JobItemDetail } = await import('./JobsDrawer.jsx')

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
    // The §14 projection carries the template's Display description and its AUTHORED characteristics on the
    // SAME row as the identity fields — biased stat ranges (RES_SHIFT/stat centering, decoded client-side)
    // and the weapon damage lines. The detail pane must consume them.
    description: 'Worn by the silent court, its feathers still catch the light.',
    level: 151,
    category: 'helmet',
    stats: { vitality: [32771, 32776] },
    damages: [{ from: 16, to: 29, damage_type: 'weapon', element: 'water' }],
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
const detail = job => renderToStaticMarkup(<JobDetail job={job} xp={0} active={false} owned={{}} />)

// The rendered EN copy (i18n resolves for real here) and the structural markers the grid groups by.
const EMPTY_COPY = 'Recipes for this profession arrive with the crafting content seed.'
const LOADING_COPY = 'Loading...'
const LOCKED_BLOCK = 'jobs__recipe-block-head is-locked'

describe('JobDetail — resources and recipes are stacked, never tabbed', () => {
  test('a gathering job shows the resource tiers first and recipes directly below', () => {
    const html = detail(JOBS[0])
    const resources = html.indexOf('<span>Resources</span>')
    const recipes = html.indexOf('<span>Recipes</span>')

    expect(resources).toBeGreaterThan(-1)
    expect(recipes).toBeGreaterThan(resources)
    expect(html.indexOf('jobs__table')).toBeGreaterThan(resources)
    expect(html.indexOf('Loading...')).toBeGreaterThan(recipes)
    expect(html).not.toContain('jobs__subtab')
  })

  test('a craft job shows the recipes section only', () => {
    const html = detail(JOBS[ARMORSMITH])

    expect(html).toContain('<div class="jobs__section-head"><span>Recipes</span></div>')
    expect(html).not.toContain('<span>Resources</span>')
    expect(html).not.toContain('jobs__table')
    expect(html.match(/jobs__section-head/g)).toHaveLength(1)
  })
})

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

// The recipe DETAIL pane rendered a generic cube, no description and no characteristics while the list rows
// beside it showed the right icons. Root cause: the pane resolved its content through `use_content()` — the
// bundled seed catalog (packages/sdk/src/items.json), `{}` in this repo BY CONSTRUCTION — so the join always
// missed and it fell back to the recipe row, which carries no art slug, no description and no stats. The live
// /v1 row it was handed already carries all three (the SAME row the encyclopedia ITEMS tab renders from).
describe('the recipe detail pane consumes the live item row (#799 follow-up)', () => {
  const OUTPUT_ROW = LIVE_ITEMS[0]
  const [row] = rows
  const pane = (props) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <JobItemDetail
          item={OUTPUT_ROW}
          recipe={row}
          job={JOBS[ARMORSMITH]}
          level={30}
          owned={{}}
          on_back={() => {}}
          {...props}
        />
      </MemoryRouter>
    )

  test('the HD icon resolves off the row’s chain art slug, never the object id', () => {
    // chain_icon_slug: the icon key of a /v1 row IS its item_type; ItemDetailImage asks for the _hd variant.
    // The FILENAME is the assertion, never the origin — a sibling test file installs an asset manifest
    // process-wide, and which host serves the art is not what this pins.
    const html = pane()
    expect(html).toContain(`${OUTPUT_ROW.item_type}_hd.png`)
    // The bug itself: an icon keyed by the Sui object address, which is not an art identity and 404s.
    expect(html).not.toContain(OUTPUT_ROW.template_id)
  })

  test('the description renders', () => {
    expect(visible_text(pane())).toContain(OUTPUT_ROW.description)
  })

  test('the authored damage + stat lines render, decoded like every other item surface', () => {
    const text = visible_text(pane())
    // Damages pass through decode_item_damages (element UPPERCASED); the biased stat pair un-biases to +3..8.
    expect(text).toContain('16 - 29')
    expect(text).toContain('WATER')
    expect(text).toContain('+3 to 8 Vitality')
  })

  // A bill-of-materials row names an item the player has to go find — and named it as dead text: the only way
  // to learn what a "Diadem Lattice Crown" is was to leave the drawer and search the encyclopedia by hand.
  // The name is now the same clickable entity reference every other surface uses (EncyclopediaLink → the ONE
  // encyclopedia_path idiom), so an unresolved ingredient still degrades to plain text rather than a dead link.
  test('an ingredient NAME deep-links to its encyclopedia item page', () => {
    const ingredient = row.ingredients[0]
    const html = pane()
    expect(html).toContain(`href="/encyclopedia/items/${ingredient.template_id}"`)
    expect(html).toContain(ingredient.name)
  })

  test('the link rides the TEMPLATE id — the key an unsnapshotted ingredient still carries', () => {
    // recipes.ts EXISTENCE LAW: an ingredient the items projection has not reached keeps its row with a
    // short-id name and NO art slug — but always its template id, which is exactly what the ency routes on.
    const [unresolved] = craft_recipes_for_job([LIVE_RECIPE], [LIVE_ITEMS[0]], ARMORSMITH)
    const ingredient = unresolved.ingredients[0]
    expect(ingredient.id).toBeNull()
    expect(pane({ recipe: unresolved })).toContain(`href="/encyclopedia/items/${ingredient.template_id}"`)
  })

  test('a row the projection has not reached keeps the honest recipe fallback — nothing fabricated', () => {
    const text = visible_text(pane({ item: null }))
    expect(text).toContain(row.name)
    expect(text).not.toContain(OUTPUT_ROW.description)
    expect(text).not.toContain('Vitality')
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

  // The remaining two surfaces landed with #800 (the job level-up unlock panel and the artisan commission
  // list). The guard covers EVERY crafting surface now, so the class cannot come back on any of them.
  for (const file of [
    './JobsDrawer.jsx',
    '../../../world-shell/craft_actions.js',
    './level_unlocks.js',
    './world/commission/commission_recipes.js',
  ]) {
    test(`${file} resolves no recipe through @aresrpg/sdk/jobs`, () => {
      const [sdk_import] = source(file).match(/import \{[^}]*\} from '@aresrpg\/sdk\/jobs'/s) ?? ['']
      for (const symbol of BUNDLED_CATALOG_EXPORTS) expect(sdk_import).not.toContain(symbol)
    })
  }
})
