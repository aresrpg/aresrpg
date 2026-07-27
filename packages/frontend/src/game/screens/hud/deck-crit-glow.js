// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure §7 TURN-SEED CRIT PREVIEW for the DeckCluster spell bar — split out (deck-key-arm.js pattern) so the
// decision unit-tests without the component's store/auth imports. The chain rolls each action's crit off a
// PUBLIC per-turn seed and the action's SLOT index (cast.move: crit_at(slot_crit_roll(turn_seed, slot), rate, 0)
// — casts AND weapon strikes share the sequence via participant.casts_this_turn). @aresrpg/sim mirrors the
// derivation byte-for-byte, so the bar can KNOW, before committing, whether the NEXT queued action crits:
// every socket whose crit_rate crosses the next slot's roll gets the gold glow (the exact UI rule —
// glow only, no labels/badges/numbers on the socket; the number rides the tooltip).
//
// DAMAGE IS EXACT: a hit deals precisely its authored base — crit swaps to the crit
// base, nothing else moves (the pre-ceremony ±15% variance band was removed on-chain). `next_hit` is that rule's
// one client home.

import { turn_seed, slot_crit_roll, crit_at } from '@aresrpg/sim/turn_seed'

/**
 * The crit PREVIEW for the NEXT action slot: this module keeps only the ROLL. The clock it rolls comes from
 * `crit_clock_of` (@aresrpg/fight/predict_cast), the ONE composer of the §7 tuple (#1190) — which seat, which
 * slot, and every "unknowable ⇒ null" rule live there, so the preview and the cast it previews can never read
 * different sequences. Callers gate turn ownership themselves (off-turn ⇒ hand null ⇒ no preview).
 * @param {{ world_seed: number|bigint, spawn_id: number|bigint, turn_deadline_ms: number|bigint,
 *   seat: number, slot: number } | null} clock
 * @returns {{ slot: number, crit_roll: number } | null}
 */
export function next_slot_crit(clock) {
  if (!clock) return null
  return { slot: clock.slot, crit_roll: slot_crit_roll(turn_seed(clock), clock.slot) }
}

/**
 * Does a socket whose spell/weapon has `crit_rate` (1-in-X; 0 = never) GLOW at this slot's roll? Mirrors the
 * chain's live call exactly — crit_bonus 0 on every path today (cast.move). Rate 0 never glows.
 * @param {number} crit_roll @param {number} crit_rate @returns {boolean}
 */
export const socket_glows = (crit_roll, crit_rate) => crit_at(crit_roll, crit_rate ?? 0, 0)

/**
 * The slot-exact NEXT-HIT value for the tooltip's one-line preview: the authored base, swapped to the crit base
 * when the slot crits (identity damage — the chain deals exactly this number). A missing crit base (heals
 * without a crit line, legacy rows) honestly falls back to the base.
 * @param {number} base @param {number | null | undefined} crit_base @param {boolean} glows @returns {number}
 */
export const next_hit = (base, crit_base, glows) => (glows ? (crit_base ?? base) : base)
