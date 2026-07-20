// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure your-turn-chime rising-edge predicate — split out of TurnBanner.jsx SPECIFICALLY so it unit-tests
// without pulling in the component's other imports (use_game_state transitively loads auth/index.ts ->
// @mysten/enoki's wallet registration, which touches `window` at MODULE-LOAD time and throws under bun:test's
// Node-like environment — the same wall deck-key-arm.js documents). Zero imports, zero DOM.

/**
 * Rising-edge predicate for the your-turn chime — true ONLY the instant `my_turn` flips false → true.
 * An opponent's turn (my_turn never true) and re-polling the SAME active turn (my_turn stays true across
 * renders) must never re-fire: the chime is a one-shot turn-start cue, not a held/level cue.
 * @param {boolean} was_my_turn previous render's my_turn
 * @param {boolean} my_turn this render's my_turn
 * @returns {boolean}
 */
export function is_turn_start(was_my_turn, my_turn) {
  return my_turn && !was_my_turn
}
