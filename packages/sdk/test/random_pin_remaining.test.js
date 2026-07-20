// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LATENCY FOLLOW-UP (lane 2 continued) — proves the 7 REMAINING &Random builders (game.js: crush_ptb/
// scribe_rune_ptb; items_shop.js: buy_ptb/buy_many_ptb; game_world.js: join_world_ptb/search_zone_ptb/
// gather_ptb) also PIN the 0x8 Random system object via `random_shared_ref` instead of the SDK's unresolved
// `tx.object.random()` — the SAME fix `fight_random_pin.test.js` proved for the fight builders. Byte-equality
// claim: the pinned SharedObjectRef this test finds on each built tx is IDENTICAL (objectId 0x8, mutable:false,
// testnet initialSharedVersion 43342337) to what a resolved `tx.object.random()` input carries — proving the
// swap is execution-neutral and purely removes the build-time resolve round-trip.
import { test, expect, describe } from 'bun:test'

import { crush_ptb, scribe_rune_ptb } from '../src/game.js'
import { buy_ptb, buy_many_ptb } from '../src/sui/write/items_shop.js'
import * as game_world from '../src/sui/write/game_world.js'

import { id } from './_onchain_fixtures.js'

const { join_world_ptb, search_zone_ptb, gather_ptb } = game_world

const RANDOM_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000008'
const ctx = { network: 'testnet' } // no ids override — resolves the LIVE stamped testnet deployment (aresrpg.js)
// forgemagie is a not-yet-stamped SIBLING package (package-split 2026-07-12): its id is '' in the live testnet
// map until the 7-package ceremony re-publishes, so the scribe/crush guard refuses without it. Layer ONLY the
// sibling id over the live deployment — every other id (VERSION, policies, the pinned 0x8 Random) still resolves
// from the stamped map, so this stays a faithful live-shared-version Random-pin proof.
const forge_ctx = {
  network: 'testnet',
  ids: { aresrpg: { FORGEMAGIE_PACKAGE_ID: id('f09e') } },
}

const inputs_of = tx => tx.getData().inputs
const random_input = tx =>
  inputs_of(tx).find(i =>
    (i.Object?.SharedObject?.objectId ?? '').endsWith('0000000000000008'),
  )?.Object?.SharedObject

/** The Random argument must be the pinned SharedObjectRef — byte-identical to a resolved `tx.object.random()`
 *  input (same 0x8, mutable:false) — never an UnresolvedObject (the thing that forces the resolve round-trip). */
function expect_pinned_random(tx) {
  const r = random_input(tx)
  expect(r).toBeTruthy()
  expect(r.objectId).toBe(RANDOM_ID)
  expect(r.initialSharedVersion).toBe('43342337')
  expect(r.mutable).toBe(false)
}

// 34 distinct filler templates + the gear template fill crush's 35 fixed rune-template slots (mirrors game.test.js).
const FILLERS = Array.from({ length: 34 }, (_, i) => id(`fl${i}`))

describe('remaining &Random sites — pinned SharedObjectRef, not UnresolvedObject', () => {
  test('game.js crush_ptb', () => {
    const tx = crush_ptb(forge_ctx)({
      crush_board_id: id('cb0'),
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
      gear_template_id: id('gt0'),
      gear_item_ids: [id('ge0')],
      rune_template_ids: [id('rt0')],
      filler_template_ids: FILLERS,
      gas_budget_mist: 10_000_000, // explicit override (the measured constant would otherwise supply the budget)
    })
    expect_pinned_random(tx)
  })

  test('game.js scribe_rune_ptb', () => {
    const tx = scribe_rune_ptb(forge_ctx)({
      crush_board_id: id('cb0'),
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
      gear_item_id: id('ge0'),
      gear_template_id: id('gt0'),
      rune_item_id: id('ru0'),
      rune_template_id: id('rt0'),
    })
    expect_pinned_random(tx)
  })

  test('items_shop.js buy_ptb', () => {
    const tx = buy_ptb(ctx)({
      sale_id: id('sa0'),
      template_id: id('it0'),
      price_mist: 1_000_000,
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
    })
    expect_pinned_random(tx)
  })

  test('items_shop.js buy_many_ptb', () => {
    const tx = buy_many_ptb(ctx)({
      sale_id: id('sa0'),
      template_id: id('it0'),
      price_mist: 1_000_000,
      quantity: 3,
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
    })
    expect_pinned_random(tx)
  })

  test('game_world.js join_world_ptb', () => {
    const tx = join_world_ptb(ctx)({
      world_id: id('w0'),
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
    })
    expect_pinned_random(tx)
  })

  test('game_world.js search_zone_ptb', () => {
    const tx = search_zone_ptb(ctx)({
      world_id: id('w0'),
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
      x: 10,
      z: 10,
    })
    expect_pinned_random(tx)
    expect(tx.getData().gasData.budget).toBe(
      String(game_world.SEARCH_ZONE_GAS_MIST),
    )
    expect(game_world.SEARCH_ZONE_GAS_MIST).toBeGreaterThanOrEqual(300_000_000)
  })

  test('game_world.js gather_ptb', () => {
    const tx = gather_ptb(ctx)({
      world_id: id('w0'),
      kiosk_id: id('k0'),
      personal_kiosk_cap_id: id('pk0'),
      character_id: id('ca0'),
      zx: 1,
      zy: 1,
      node_index: 0,
      template_id: id('it0'),
      protector_template_id: id('mob0'), // §17.22 ambush MobTemplate (required)
    })
    expect_pinned_random(tx)
  })
})
