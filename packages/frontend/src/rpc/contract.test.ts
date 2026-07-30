// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /v1 CONTRACT TEST (D770c) — the client driven headless against RECORDED live-server truth.
//
// FIXTURE PROVENANCE (recorded 2026-07-17 from the LIVE testnet read-API, then PINNED — this suite runs
// offline forever; a re-record that shrinks row coverage reds `row_presence` below). Narrow schema note:
// characters.json's `pet: null` / `pet_equipped: false` were appended for this closed-view extension;
// they are the no-pet response shape, not a claimed live pet=true capture:
//   base: https://rpc.aresrpg.world   (VITE_RPC_URL of the deployed testnet build)
//   owner A (alice / CanaryAlice, the standing QA identity): 0xb495…5cd177 — the FULL address is
//     characters.json's `.characters[0].owner` (OWNER_A derives from it below; chain-id gate: ids live in
//     the registered fixtures, never re-typed here)
//   owner B (a live player wallet WITH FightResults + a loose kiosk item, found via /v1/fights
//     participants): 0xdee0…25ad38 — a query-side address only; the fixture router ignores query params,
//     so OWNER_B below is a placeholder (re-record with any wallet that holds unopened FightResults)
//   status.json            GET /v1/status
//   characters.json        GET /v1/characters?owner=<A>
//   owner_items.json       GET /v1/owner-items?address=<B>
//   listings.json          GET /v1/listings?limit=25
//   sales_history.json     GET /v1/sales-history?seller=<A>          (rows empty at record time)
//   pools.json             GET /v1/pools                             (empty)
//   taux.json              GET /v1/taux?ids=<2 encyclopedia gear ids>
//   shop.json              GET /v1/shop?active=false
//   zones.json             GET /v1/zones?world=<alice's world>       (LIST form — counts only)
//   zone_single.json       GET /v1/zones?world=…&zone=488:488        (STATE form — seed + bitmaps)
//   rare_links.json        GET /v1/rare-links                        (empty)
//   encyclopedia.json      GET /v1/encyclopedia                      (items+mobs+worlds+recipes)
//   config.json            GET /v1/config
//   kolizeum.json          GET /v1/kolizeum                          (empty)
//   dungeon_runs.json      GET /v1/dungeon-runs?owner=<A>            (empty)
//   fights.json            GET /v1/fights?world=<alice's world>
//   fight_results.json     GET /v1/fight-results?owner=<B>           (4 rows — both id families' fields)
//   pending_outcomes.json  GET /v1/pending-outcomes?owner=<A>        (empty; bare-array contract)
//   pet_claims.json        GET /v1/pet-claims?owner=<A>              (empty; bare-array contract)
//   names.json             GET /v1/names?addresses=<A>
//   sponsor_remaining.json GET /v1/sponsor/remaining?address=<A>
// NOT recorded: /v1/inbox + /v1/airdrops (routes not live yet — their client fetchers degrade by design).
//
// TWO DIRECTIONS, ONE CONTRACT: contract_specs.ts is `keyof`-exhaustive over views.ts (typecheck reds a
// client-claim change without a spec change); this file asserts the specs over the recorded server rows
// (a server-truth divergence reds here). The fetch edge is swapped for a fixture-serving stub — the same
// `globalThis.fetch` pattern client.test.ts uses (never mock.module — it is process-global in bun).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  _reset_rpc_client_for_test,
  get_characters,
  get_config,
  get_dungeon_runs,
  get_encyclopedia,
  get_fight_results,
  get_fights,
  get_kolizeums,
  get_listings,
  get_names,
  get_owner_items,
  get_pending_outcomes,
  get_pet_claims,
  get_pools,
  get_rare_links,
  get_sales_history,
  get_shop,
  get_sponsor_remaining,
  get_status,
  get_taux_rows,
  get_zone,
  get_zones,
} from './client'
import {
  character_spec,
  dungeon_run_spec,
  encyclopedia_item_spec,
  encyclopedia_mob_spec,
  encyclopedia_world_spec,
  fight_result_spec,
  fight_spec,
  kolizeum_spec,
  listing_spec,
  owned_item_spec,
  pending_outcome_spec,
  pet_claim_spec,
  pool_spec,
  rare_link_spec,
  recipe_spec,
  sale_spec,
  sales_row_spec,
  sponsor_remaining_spec,
  spec_violations,
  taux_row_spec,
  zone_spec,
  type Spec,
} from './contract_specs'
import status_fx from './fixtures/status.json'
import characters_fx from './fixtures/characters.json'
import owner_items_fx from './fixtures/owner_items.json'
import listings_fx from './fixtures/listings.json'
import sales_history_fx from './fixtures/sales_history.json'
import pools_fx from './fixtures/pools.json'
import taux_fx from './fixtures/taux.json'
import shop_fx from './fixtures/shop.json'
import zones_fx from './fixtures/zones.json'
import zone_single_fx from './fixtures/zone_single.json'
import rare_links_fx from './fixtures/rare_links.json'
import encyclopedia_fx from './fixtures/encyclopedia.json'
import config_fx from './fixtures/config.json'
import kolizeum_fx from './fixtures/kolizeum.json'
import dungeon_runs_fx from './fixtures/dungeon_runs.json'
import fights_fx from './fixtures/fights.json'
import fight_results_fx from './fixtures/fight_results.json'
import pending_outcomes_fx from './fixtures/pending_outcomes.json'
import pet_claims_fx from './fixtures/pet_claims.json'
import names_fx from './fixtures/names.json'
import sponsor_remaining_fx from './fixtures/sponsor_remaining.json'

// Derived from the recorded truth itself — one home per id (the header carries the human provenance).
// OWNER_B only parameterizes queries the fixture router ignores, so it is an honest placeholder.
const OWNER_A = characters_fx.characters[0].owner
const OWNER_B = 'recorded-owner-b-see-provenance-header'
const WORLD = zones_fx.world
const canonical_id = (suffix: string) => `0x${suffix.padStart(64, '0')}`

const real_fetch = globalThis.fetch

// Path-keyed fixture router: the stub serves the recorded body for the requested /v1 path (query ignored
// EXCEPT the zones state-form discriminator, which is a distinct recorded response of the same path).
function serve_fixtures() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const body =
      url.pathname === '/v1/zones' && url.searchParams.has('zone')
        ? zone_single_fx
        : {
            '/v1/status': status_fx,
            '/v1/characters': characters_fx,
            '/v1/owner-items': owner_items_fx,
            '/v1/listings': listings_fx,
            '/v1/sales-history': sales_history_fx,
            '/v1/pools': pools_fx,
            '/v1/taux': taux_fx,
            '/v1/shop': shop_fx,
            '/v1/zones': zones_fx,
            '/v1/rare-links': rare_links_fx,
            '/v1/encyclopedia': encyclopedia_fx,
            '/v1/config': config_fx,
            '/v1/kolizeum': kolizeum_fx,
            '/v1/dungeon-runs': dungeon_runs_fx,
            '/v1/fights': fights_fx,
            '/v1/fight-results': fight_results_fx,
            '/v1/pending-outcomes': pending_outcomes_fx,
            '/v1/pet-claims': pet_claims_fx,
            '/v1/names': names_fx,
            '/v1/sponsor/remaining': sponsor_remaining_fx,
          }[url.pathname]
    if (body === undefined) throw new Error(`contract stub: unrecorded path ${url.pathname}`)
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

function assert_rows<T>(view: string, spec: Spec<T>, rows: unknown[]) {
  for (const [idx, row] of rows.entries()) {
    const violations = spec_violations(spec, row as Record<string, unknown>)
    expect(violations, `${view}[${idx}] contract violations`).toEqual([])
  }
}

beforeEach(() => {
  _reset_rpc_client_for_test()
  serve_fixtures()
})

afterEach(() => {
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
})

describe('/v1 contract — recorded live truth, drift-pinned', () => {
  // Row coverage at record time. A future re-record must keep every true row non-empty (a fixture refresh
  // that silently loses its rows would hollow the suite out — this reds instead). The false rows are views
  // with no live data on 2026-07-17: their ENVELOPE stays pinned; flip to true when a re-record gains rows.
  test('row_presence — the recorded coverage manifest', () => {
    expect({
      characters: characters_fx.characters.length > 0,
      owner_items: owner_items_fx.items.length > 0,
      listings: listings_fx.listings.length > 0,
      taux: taux_fx.taux.length > 0,
      shop: shop_fx.sales.length > 0,
      zones: zones_fx.zones.length > 0,
      zone_single: zone_single_fx.zones.length > 0,
      encyclopedia_items: encyclopedia_fx.items.length > 0,
      encyclopedia_mobs: encyclopedia_fx.mobs.length > 0,
      encyclopedia_worlds: encyclopedia_fx.worlds.length > 0,
      encyclopedia_recipes: encyclopedia_fx.recipes.length > 0,
      fights: fights_fx.fights.length > 0,
      fight_results: fight_results_fx.results.length > 0,
      sales_history: sales_history_fx.sales.length > 0,
      pools: pools_fx.pools.length > 0,
      rare_links: rare_links_fx.rare_links.length > 0,
      kolizeum: kolizeum_fx.kolizeums.length > 0,
      dungeon_runs: dungeon_runs_fx.runs.length > 0,
      pending_outcomes: pending_outcomes_fx.length > 0,
      pet_claims: pet_claims_fx.length > 0,
    }).toEqual({
      characters: true,
      owner_items: true,
      listings: true,
      taux: true,
      shop: true,
      zones: true,
      zone_single: true,
      encyclopedia_items: true,
      encyclopedia_mobs: true,
      encyclopedia_worlds: true,
      encyclopedia_recipes: true,
      fights: true,
      fight_results: true,
      sales_history: false,
      pools: false,
      rare_links: false,
      kolizeum: false,
      dungeon_runs: false,
      pending_outcomes: false,
      pet_claims: false,
    })
  })

  test('status — get_status unwraps the ok arm', async () => {
    const status = await get_status()
    expect(status).toEqual(status_fx as typeof status)
    expect(status.status).toBe('ok')
    if (status.status === 'ok') {
      expect(status.indexed).toBe(true)
      expect(typeof status.latest_checkpoint).toBe('number')
      expect(typeof status.lag_ms).toBe('number')
    }
  })

  test('characters — get_characters unwraps {characters} and every row holds RpcCharacter', async () => {
    const characters = await get_characters({ owner: OWNER_A })
    expect(characters).toEqual(characters_fx.characters as typeof characters)
    assert_rows('characters', character_spec, characters)

    // CONSTRUCTED TRUE CASE — no live pet=true capture exists in-repo; NEEDS-LEAD before deploy.
    // This positive nested-pet vector is independent of the recorded no-pet row. It keeps canonical
    // chain identity separate from the render/catalog slug and carries no invented riding boolean.
    const with_pet = {
      ...characters[0],
      pet: {
        item_id: canonical_id('a004'),
        template_id: canonical_id('7a05'),
        slug: 'pet_bouloute',
      },
      pet_equipped: true,
    }
    expect(spec_violations(character_spec, with_pet)).toEqual([])
  })

  test('owner-items — get_owner_items unwraps {items} and rows hold RpcOwnedItem', async () => {
    const items = await get_owner_items(OWNER_B)
    expect(items).toEqual(owner_items_fx.items as typeof items)
    assert_rows('owner_items', owned_item_spec, items)
  })

  test('listings — get_listings returns the page envelope; rows hold RpcListing', async () => {
    const page = await get_listings({ limit: 25 })
    expect(page.listings).toEqual(listings_fx.listings as typeof page.listings)
    expect(typeof page.total).toBe('number')
    expect(page.next_cursor === null || typeof page.next_cursor === 'string').toBe(true)
    assert_rows('listings', listing_spec, page.listings)
  })

  test('sales-history — envelope (seller + revenue_30d_mist + pager); rows hold RpcSalesRow', async () => {
    const history = await get_sales_history({ seller: OWNER_A })
    expect(history.seller).toBe(OWNER_A)
    expect(/^\d+$/.test(history.revenue_30d_mist)).toBe(true)
    expect(typeof history.total).toBe('number')
    assert_rows('sales_history', sales_row_spec, history.sales)
  })

  test('pools + taux — get_pools/get_taux_rows unwrap; rows hold their specs', async () => {
    const pools = await get_pools()
    expect(pools).toEqual(pools_fx.pools as typeof pools)
    assert_rows('pools', pool_spec, pools)
    const taux = await get_taux_rows(taux_fx.taux.map((row) => row.template_id))
    expect(taux).toEqual(taux_fx.taux as typeof taux)
    assert_rows('taux', taux_row_spec, taux)
  })

  test('shop — get_shop unwraps {sales}; rows hold RpcSale', async () => {
    const sales = await get_shop(false)
    expect(sales).toEqual(shop_fx.sales as typeof sales)
    assert_rows('shop', sale_spec, sales)
  })

  test('zones — LIST form counts-only; STATE form carries seed + bitmaps (get_zone)', async () => {
    const zones = await get_zones(WORLD)
    expect(zones.world).toBe(WORLD)
    expect(zones.seed === null || typeof zones.seed === 'string').toBe(true) // u64 seed → string (2^53 law)
    expect(zones.biome === null || typeof zones.biome === 'string').toBe(true)
    assert_rows('zones', zone_spec, zones.zones)
    for (const row of zones.zones) expect('seed' in row).toBe(false) // list form never ships zone state

    const zone = await get_zone(WORLD, 488, 488)
    expect(zone).not.toBeNull()
    assert_rows('zone_single', zone_spec, [zone])
    expect(typeof zone?.seed).toBe('string') // u64 → string (2^53 law)
    expect(Array.isArray(zone?.mob_bitmap)).toBe(true)
    expect(Array.isArray(zone?.res_bitmap)).toBe(true)
    // Eligibility pin: /v1's sibling ZoneGroupCommitment is authoritative. Format 3 is the tag plus digest;
    // dropping it would make the sim fall back to legacy polarity and surface rows the chain refuses.
    expect(zone?.group_root).toHaveLength(33)
    expect(zone?.group_root?.[0]).toBe(3)
    expect(zone?.group_count).toBe(53)
  })

  test('rare-links — get_rare_links unwraps {rare_links}; rows hold RpcRareLink', async () => {
    const rare_links = await get_rare_links(WORLD)
    expect(rare_links).toEqual(rare_links_fx.rare_links as typeof rare_links)
    assert_rows('rare_links', rare_link_spec, rare_links)
  })

  test('encyclopedia — the all-kinds envelope; every kind row holds its spec', async () => {
    const encyclopedia = await get_encyclopedia()
    expect(encyclopedia.items.length).toBe(encyclopedia_fx.items.length)
    assert_rows('encyclopedia.items', encyclopedia_item_spec, encyclopedia.items)
    assert_rows('encyclopedia.mobs', encyclopedia_mob_spec, encyclopedia.mobs)
    assert_rows('encyclopedia.worlds', encyclopedia_world_spec, encyclopedia.worlds)
    assert_rows('encyclopedia.recipes', recipe_spec, encyclopedia.recipes)
  })

  test('config — loosely-typed doc; the typed dials hold their kinds when present', async () => {
    const config = await get_config()
    expect(config).toEqual(config_fx as typeof config)
    if ('enabled' in config) expect(config.enabled === null || typeof config.enabled === 'boolean').toBe(true)
    if (config.dials) for (const value of Object.values(config.dials)) expect(typeof value).toBe('number')
    if (config.protector_templates)
      for (const value of Object.values(config.protector_templates)) expect(typeof value).toBe('string')
    if (config.creation?.price_mist) expect(/^\d+$/.test(config.creation.price_mist)).toBe(true)
  })

  test('kolizeum + dungeon-runs — unwrap; rows hold their specs', async () => {
    const kolizeums = await get_kolizeums()
    expect(kolizeums).toEqual(kolizeum_fx.kolizeums as typeof kolizeums)
    assert_rows('kolizeum', kolizeum_spec, kolizeums)
    const runs = await get_dungeon_runs({ owner: OWNER_A })
    expect(runs).toEqual(dungeon_runs_fx.runs as typeof runs)
    assert_rows('dungeon_runs', dungeon_run_spec, runs)
  })

  test('fights — get_fights unwraps {fights}; rows hold the CORRECTED RpcFight (fight_id/anchor{}/participants[])', async () => {
    const fights = await get_fights({ world: WORLD })
    expect(fights).toEqual(fights_fx.fights as typeof fights)
    assert_rows('fights', fight_spec, fights)
    // the exact drift class the census flagged: the row keys are the VIEW's, not the indexer doc's
    expect(fights[0]).toHaveProperty('fight_id')
    expect(fights[0]).not.toHaveProperty('fight')
    expect(fights[0]).not.toHaveProperty('anchor_x')
    expect(Array.isArray(fights[0].participants)).toBe(true)
  })

  test('fight-results — get_fight_results unwraps {results}; rows hold the CORRECTED RpcFightResult', async () => {
    const results = await get_fight_results(OWNER_B)
    expect(results).toEqual(fight_results_fx.results as typeof results)
    expect(results.length).toBeGreaterThan(0)
    assert_rows('fight_results', fight_result_spec, results)
    // the D770c finding itself: rows key by result_id/fight_id and never echo an owner back
    expect(results[0]).toHaveProperty('result_id')
    expect(results[0]).not.toHaveProperty('result')
    expect(results[0]).not.toHaveProperty('owner')
  })

  test('pending-outcomes + pet-claims — bare-array contracts; rows hold their specs', async () => {
    const outcomes = await get_pending_outcomes(OWNER_A)
    expect(outcomes).toEqual(pending_outcomes_fx as typeof outcomes)
    assert_rows('pending_outcomes', pending_outcome_spec, outcomes)
    const claims = await get_pet_claims(OWNER_A)
    expect(claims).toEqual(pet_claims_fx as typeof claims)
    assert_rows('pet_claims', pet_claim_spec, claims)
  })

  test('names — flat address→name|null map; every requested address answered', async () => {
    const names = await get_names([OWNER_A])
    expect(names).toEqual(names_fx as typeof names)
    expect(OWNER_A in names).toBe(true)
    for (const value of Object.values(names)) expect(value === null || typeof value === 'string').toBe(true)
  })

  test('sponsor/remaining — the allowance doc holds RpcSponsorRemaining', async () => {
    const remaining = await get_sponsor_remaining(OWNER_A)
    expect(remaining).toEqual(sponsor_remaining_fx as typeof remaining)
    assert_rows('sponsor_remaining', sponsor_remaining_spec, [remaining])
  })
})
