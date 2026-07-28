// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The explicit combat RNG thread for crank-driven and legacy paths. Player casts temporarily resolve from their
// public turn_context and restore this thread before returning. `FightState.rng` remains a legacy capsule field,
// never a combat draw; standalone reducer fixtures fall back to arena_seed.

/** @param {import('./fight_state.js').FightState} state @returns {import('./prng.js').Rng} */
export const turn_rng_of = state => state.turn_rng ?? state.arena_seed ?? 0

/** @param {import('./fight_state.js').FightState} state @param {import('./prng.js').Rng} turn_rng */
export const with_turn_rng = (state, turn_rng) => ({ ...state, turn_rng })
