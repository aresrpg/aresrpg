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
 * The crit PREVIEW for the NEXT action slot, or null when unknowable. Non-null only on MY active turn with the
 * full §7 seed tuple present (world_seed/spawn_id are static Fight fields; turn_deadline_ms is stamped fresh in
 * TurnStarted; seat + casts_this_turn ride my escrow row). The slot ADVANCES with the local draft (`draft_len` =
 * the AP-queue lane's queued cast/weapon count — dungeon-turn cast_path; moves never count, mirroring
 * count_action), so queuing an action live-updates which socket glows.
 * @param {{ my_turn: boolean, world_seed: number|bigint|null, spawn_id: number|bigint|null,
 *   turn_deadline_ms: number|bigint|null, seat: number|null, casts_this_turn: number, draft_len: number }} args
 * @returns {{ slot: number, crit_roll: number } | null}
 */
export function next_slot_crit({ my_turn, world_seed, spawn_id, turn_deadline_ms, seat, casts_this_turn, draft_len }) {
  if (!my_turn) return null
  if (world_seed == null || spawn_id == null || turn_deadline_ms == null || seat == null) return null
  const slot = (casts_this_turn ?? 0) + (draft_len ?? 0)
  const seed = turn_seed({ world_seed, spawn_id, turn_deadline_ms, seat })
  return { slot, crit_roll: slot_crit_roll(seed, slot) }
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
