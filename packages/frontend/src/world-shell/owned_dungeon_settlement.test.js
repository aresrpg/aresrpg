// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1212 — a same-wallet dungeon COMPANION's own settled loot never landed in the bag without a full page
// refresh. owned_dungeon_settlement.js is NOT imported here: it pulls settle_owned_dungeon_runs from
// owned_team_actions.js → dungeon_actions.js → the SDK/auth/window graph (unloadable headless — same class
// dungeon_settlement.test.js documents for its own module, `window is not defined` via @mysten/enoki at import
// time). Per the established house pattern this MIRRORS the exact `on_settled` control-flow shape 1:1 with
// owned_dungeon_settlement.js, driving the REAL leaf pieces every other mint-door test already drives directly:
// pending_mints.js's enqueue_mint/drain_pending_mints (real, leaf), loot_inventory_effect.js's
// mint_and_reduce_inventory (real, leaf), and the real engine `context` (game/core/game.js, headless-safe —
// lootbox_claim_inventory.test.js already imports it the same way).
//
// ROOT CAUSE: the leader's own settlement (dungeon_settlement.js finish_result) enqueues its result_id for
// mint+burn via pending_mints.js and that mint dispatches `action/sui_data` on success — the bag updates without
// a refresh. A same-wallet companion character's settlement (owned_dungeon_settlement.js
// settle_owned_dungeon_companions) opens its OWN FightResult per character and stores the id in
// `owned_result_ids` (dungeon_run_store.js) — but NOTHING ever enqueues that result_id for its mint+burn. The
// companion's loot sits on-chain, unminted, until the next session's boot sweep
// (pending_mints.js sweep_stranded_results, driven off `/v1/fight-results`) finally mints it — which reads to
// the player as "needs a refresh."
import { afterEach, describe, expect, it } from 'bun:test'

import { context } from '../game/core/game.js'

import { mint_and_reduce_inventory } from './loot_inventory_effect.js'
import { enqueue_mint, drain_pending_mints, reset_pending_mints_for_test } from './pending_mints.js'

const owner = '0xowner-companion'
const result_id = '0xcompanion-result'
const item_id = '0xcompanion-loot-item'
const template_id = '0xcompanion-loot-template'
const templates = new Map([[template_id, { name: 'Companion Drop', item_type: 'resource', category: 'RESOURCE' }]])

// The chain-direct FightResult read process_mint gates on (pending_mints.js) — an opened result owing one rolled
// template, exactly the companion's own outcome shape.
const read_opened_result = async () => ({ is_opened: true, rolled: [{ item_template: template_id }] })

// mint_all_and_burn's own receipt shape (an ItemMinted event) — settled_loot_rows' one home reads this.
const fake_mint_and_burn = async () => ({
  receipt: {
    events: [{ type: '0xares::item::ItemMinted', parsedJson: { item: item_id, template: template_id, amount: '1' } }],
  },
  kiosk_id: '0xcompanion-kiosk',
  kiosk_cap_id: '0xcompanion-cap',
})

// dungeon_settlement.js's `mint_deps()` composer, mirrored 1:1: read_result (chain-direct) + mint_and_burn
// (mint_and_reduce_inventory — the REAL shared reducer-door edge, loot_inventory_effect.js).
const mint_deps = () => ({
  read_result: read_opened_result,
  mint_and_burn: (id, tpls) =>
    mint_and_reduce_inventory(id, tpls, {
      mint_and_burn: fake_mint_and_burn,
      load_templates: async () => templates,
      reducer_door: context,
      current_address: () => owner,
    }),
})

/** MIRROR of owned_dungeon_settlement.js's `on_settled` callback. `mint_parity` toggles the fix under test: false
 *  reproduces the CURRENT (pre-fix) shape — XP/HP patch only, the companion's result_id never enqueued. */
function settle_companion_outcome(character_id, opened_result, { mint_parity }) {
  if (mint_parity && opened_result?.result_id) {
    enqueue_mint(opened_result.result_id)
    void drain_pending_mints(mint_deps()).catch(() => {})
  }
  context.dispatch('action/sui_data', {
    kind: 'receipt_patch',
    op: 'fight_receipt',
    character_id,
    xp_share: opened_result?.xp_share,
    final_hp: opened_result?.final_hp,
  })
}

const settle_engine = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
  reset_pending_mints_for_test()
  await new Promise((resolve) => {
    context.events.once('action/sui_logout', resolve)
    context.dispatch('action/sui_logout')
  })
})

describe('owned dungeon companion settlement (#1212) — a companion result must mint without a refresh', () => {
  it('RED: today (mint_parity off) a companion outcome patches XP/HP but its loot NEVER lands in the bag', async () => {
    settle_companion_outcome('char-companion', { result_id, xp_share: 10, final_hp: 42 }, { mint_parity: false })
    await settle_engine()
    await settle_engine()

    expect(context.get_state().sui.items.some((item) => item.id === item_id)).toBe(false)
  })

  it('GREEN: the companion result rides the same enqueue_mint/drain_pending_mints door as the leader — loot lands', async () => {
    settle_companion_outcome('char-companion', { result_id, xp_share: 10, final_hp: 42 }, { mint_parity: true })
    await settle_engine()
    await settle_engine()

    expect(context.get_state().sui.items.some((item) => item.id === item_id)).toBe(true)
  })
})
