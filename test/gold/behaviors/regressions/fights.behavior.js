// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REGRESSION FENCE — FIGHTS (docs/REGRESSION_ENFORCEMENT.md · domain: fights)
//
// Regressions pinned here (the 07-09 → 07-11 "fight is broken" reports):
//  · R-FIGHT-1  turns impossible to commit — MoveAbort 101 actions::begin_action · 111 fight::mark_seated ·
//    105 results::burn_result — turns were reported impossible to commit (three separate incidents,
//    same day). The `fight` verb drives the FULL lifecycle through the SDK choke
//    (create_fight → place → act_move/act_weapon/act_pass → settle_open_world, via framework/world_flow
//    win_fight). If ANY turn/settle aborts, the `do` step throws → RED. A GREEN run = every turn committed.
//  · R-FIGHT-2  refresh → the fight board can't spawn — MoveAbort 104 zones::search_internal / board-seat
//    non-determinism (07-09 16:59, 07-10 12:05, img#70 "agent refresh… board couldn't even spawn"). A settled
//    fight proves the zone searched, the board built, and the seat resolved.
//  · R-FIGHT-3  death-before-teardown / pass-from-lethal leaves stale or bricked state (07-11 12:23 "fight
//    ended without me finishing my turn, seems I was killed"; forensics "Mystery B"). chain.character.exists
//    AFTER settle proves the character survives the terminal wave intact — not consumed, not bricked MARKED.
//  · Money-law: run.spent_sui stays capped → no executed-failure burn loop (tx-burn law; a full fight is << 1 SUI).
//
// NOTE this is the same verb path B0 already proved GREEN (full_slice: fights=1 won 1); here it is narrowed to
// a REGRESSION assertion set with the pre-fix failure modes named, so a re-broken fight lifecycle turns it RED.
//
//   node test/gold/bot/run.mjs test/gold/behaviors/regressions/fights.behavior.js --target localnet --wallet fresh
import fund from '../sub/_fund.behavior.js'

export default {
  name: 'regr_fights',
  description:
    'REGRESSION: a world fight runs its full lifecycle — every turn commits, the board spawns, the character survives settle',
  ui_truth: 'never',
  defaults: { class: 'senshi' },
  steps: [
    { use: fund, with: { sui: 5 } },
    { do: 'create_character', with: { class: '$class', name_prefix: 'regr_fight' } },
    { assert: { oracle: 'chain.character.exists', eq: true } },
    { do: 'enter_world' },
    // R-SEARCH-1: pressing search must resolve a zone with real spawns (07-09 17:21 "pressing F to search a
    // zone does nothing / no feedback"). search_zone reports progressed only when a mob/node is discovered.
    { do: 'search_zone' },
    { do: 'travel_to', with: { target: 'nearest:mob' } },
    // THE FENCE (see header R-FIGHT-1/2): the whole fight lifecycle through the SDK choke. Aborts → RED.
    { do: 'fight' },
    { assert: { oracle: 'chain.character.exists', eq: true } }, // R-FIGHT-3: survived settle/teardown, not bricked
    { assert: { oracle: 'run.spent_sui', lte: 2 } }, // no burn loop — a full fight's gas is well under 1 SUI
    { checkpoint: 'fight_lifecycle_intact' },
  ],
}
