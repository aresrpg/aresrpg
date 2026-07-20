// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// @aresrpg/sim — the deterministic turn-based combat reducer.
//
// reduce(state, command, grid) -> { state, events }. Pure, integer-only, seeded-PRNG. The combat AUTHORITY is
// the on-chain `aresrpg_fight` Move engine (turns/actions/settlement); this reducer mirrors it for the client's
// local PREDICTION, kept deterministic so a predicted result matches the chain's settlement.
//
// Built slice by slice. Landed: prng, cell, pathfind, noise, arena, world + the turn-based fight engine
// (fight_state, visibility, spell_templates, spell_targeting, spell_calculator, fight_actions, fight_spells,
// fight_ai, reduce). The public combat entry point is `reduce` + `create_fight_state` (reduce.js).

export * from './prng.js'
export * from './turn_seed.js'
export * from './cell.js'
export * from './pathfind.js'
export * from './noise.js'
export * from './arena.js'
export * from './world.js'
export * from './zone_derive.js'

// ── Turn-based fight engine ──────────────────────────────────────────────────
export * from './fight_state.js'
export * from './visibility.js'
export * from './spell_templates.js'
export * from './chain_spell_corpus.js'
export * from './spell_targeting.js'
export * from './spell_calculator.js'
export * from './equipment_stats.js'
export * from './fight_actions.js'
export * from './fight_tackle.js'
export * from './fight_reactions.js'
export * from './fight_retro_effects.js'
export * from './fight_stat_effects.js'
export * from './fight_delayed.js'
export * from './fight_displacement.js'
export * from './fight_statuses.js'
export * from './fight_sweep.js'
export * from './fight_traps.js'
export * from './fight_summon.js'
export * from './fight_spells.js'
export * from './fight_ai.js'
export * from './reduce.js'
