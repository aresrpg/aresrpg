// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/index.js — the scripted fight bot's ONE public door (#1100). The brain and the assertions are pure and
// node-clean; the browser half (booting the page, driving the seams, writing the sheet) lives in
// packages/frontend/scripts/fight_bot.mjs, which imports exactly this.

export { WEIGHTS, plan_turn } from './policy.js'
export { assert_turn, assert_traps_sprung, assert_cross_client, assert_status_proof_ran, summarise } from './assert.js'
export * from './read.js'
