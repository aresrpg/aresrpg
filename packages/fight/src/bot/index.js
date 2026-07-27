// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/index.js — the scripted fight bot's ONE public door (#1100). The brain and the assertions are pure and
// node-clean; the browser half (booting the page, driving the seams, writing the sheet) lives in
// packages/frontend/scripts/fight_bot.mjs, which imports exactly this.

export { WEIGHTS, plan_turn } from './policy.js'
export {
  assert_turn,
  assert_traps_sprung,
  assert_cross_client,
  assert_status_proof_ran,
  assert_prediction_proofs,
  prediction_tally,
  summarise,
} from './assert.js'
export {
  assert_joiner_seated,
  assert_placements,
  assert_turn_order,
  assert_move_proofs,
  assert_settlement_seen,
  assert_member_loot,
  coop_rows,
} from './coop.js'
export { MAX_HOPS, pick_hop, plan_provision, zone_key_of } from './provision.js'
export * from './read.js'
