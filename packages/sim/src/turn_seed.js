// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// §7 TURN-SEED SLOTS — the CLIENT MIRROR of the on-chain per-turn CRIT determinism contract
// (aresrpg_foundation::spell_formula + aresrpg_fight::fight::turn_seed), byte-identical so a client preview
// matches the chain's settlement exactly.
//
// Crits are a per-turn REVEALED SEQUENCE: at turn start a `turn_seed` is derived PURELY from public fight state
// (world_seed, spawn_id, turn_entropy, turn_ordinal, seat). Each committed damaging action
// of the turn takes the next SLOT index (the escrow's `casts_this_turn` counter — weapon strikes count too), and
// slot `i` carries a fixed crit roll bound to the INDEX ONLY (never the spell/target — kills cross-target
// fishing; slot-routing is the mechanic). The client folds this to PREVIEW, before committing, which queued
// slots crit. #577 (owner ruling 2026-07-23) — DAMAGE IS RANDOM: one per-cast `slot_damage_roll` (a DISTINCT
// domain tag from crit) picks a value in each effect's authored `[min, max]`; crit swaps to the crit RANGE.
// `max == min` is the fixed case (byte-identical to the pre-#577 single base). The client mirrors the roll to
// preview this turn's EXACT damage before committing, exactly as it previews crit.
//
// DERIVATION (every step a `prng.mix` fold — mirrors spell_formula.move / fight.move byte-for-byte):
//   turn_seed   = mix(mix(mix(mix(world_seed, spawn_id), turn_entropy), turn_ordinal), seat)
//   crit_roll   = mix(mix(turn_seed, slot), DOMAIN_CRIT) % 10000    ∈ [0, 10000)   (basis points)
//   damage_roll = mix(mix(turn_seed, slot), DOMAIN_DMG)  % 10000    ∈ [0, 10000)   (#577, decorrelated from crit)
// Parity is pinned by test/turn_seed.test.js against golden vectors extracted from the Move source of truth
// (`sui move test` debug-print probe over aresrpg_foundation) + spell_formula's own t_crit_at_bp_threshold set.

import { mix, scramble } from './prng.js'

const CRIT_SCALE = 10000 // crit/damage-roll fixed-point scale (basis points)
const DOMAIN_CRIT = 0 // crit stream domain tag (spell_formula::DOMAIN_CRIT)
const DOMAIN_DMG = 0xd1b54a35 // #577 damage stream domain tag (spell_formula::DOMAIN_DMG); ≠ crit/dodge/failure/tackle

/**
 * The turn's seed — derived from public turn state. Mirrors fight.move::turn_seed. Each seat gets its own
 * sequence; the turn's own entropy and ordinal (both stamped on the Fight and published in TurnStarted) re-seed
 * it every turn. Inputs may be Number, BigInt, or the decimal STRING a JSON capsule stores a u64 as (all four
 * are u64 off the SDK decode — `prng.mix` folds every form through the same BigInt mask, so they agree).
 * @param {{ world_seed: number|bigint|string, spawn_id: number|bigint|string,
 *   turn_entropy: number|bigint|string, turn_ordinal: number|bigint|string,
 *   seat: number|bigint|string }} fight
 * @returns {number} uint32
 */
export const turn_seed = ({
  world_seed,
  spawn_id,
  turn_entropy,
  turn_ordinal,
  seat,
}) => mix(mix(mix(mix(world_seed, spawn_id), turn_entropy), turn_ordinal), seat)

/**
 * Slot `i`'s CRIT ROLL — a spell/target-INDEPENDENT value in [0, 10000) derived from (turn_seed, slot). Mirrors
 * spell_formula::slot_crit_roll. `slot` = the action's commit-order index this turn (casts_this_turn pre-action).
 * @param {number} seed the turn_seed
 * @param {number} slot the action index this turn
 * @returns {number}
 */
export const slot_crit_roll = (seed, slot) =>
  mix(mix(seed, slot), DOMAIN_CRIT) % CRIT_SCALE

/**
 * #577 — Slot `i`'s DAMAGE ROLL — a spell/target-INDEPENDENT fraction in [0, 10000) from (turn_seed, slot),
 * decorrelated from the crit stream by DOMAIN_DMG. Mirrors spell_formula::slot_damage_roll byte-for-byte, so a
 * client previews this turn's exact damage. One roll per cast is mapped onto each effect's own range.
 * @param {number} seed the turn_seed @param {number} slot casts_this_turn pre-action @returns {number} [0,10000)
 */
export const slot_damage_roll = (seed, slot) =>
  mix(mix(seed, slot), DOMAIN_DMG) % CRIT_SCALE

/**
 * #577 — a MOB's damage roll fraction: mobs have no turn seed (crank-driven, never previewable), so it derives
 * from the threaded rng STATE by a NON-ADVANCING `scramble` — one roll per cast that does NOT consume the stream
 * (fixed effects stay byte-identical; a range never shifts the mob's dodge draws). Mirrors spell_formula::crank_damage_roll.
 * @param {number} rng_state the current threaded prng state @returns {number} [0,10000)
 */
export const crank_damage_roll = rng_state => scramble(rng_state) % CRIT_SCALE

/**
 * #577 — Map a damage roll ∈ [0, 10000) onto an authored `[min, max]` (inclusive): `min + roll·span/10000` where
 * `span = max − min + 1`. `max <= min` ⇒ `min` (the fixed case). Mirrors spell_formula::roll_in_range — both
 * twins pick the identical integer from the identical roll.
 * @param {number} min @param {number} max @param {number} roll ∈ [0,10000) @returns {number}
 */
export const roll_in_range = (min, max, roll) =>
  max <= min ? min : min + Math.floor((roll * (max - min + 1)) / CRIT_SCALE)

// AP/MP-removal DODGE stream: the point-removal contest draws off the SAME public turn-seed as
// crit — a NEW domain tag, zero new RNG — so a client previews a drain's dodge before commit exactly like a crit.
const DOMAIN_DODGE = 0xd0d6e // dodge stream domain tag (spell_formula::DOMAIN_DODGE); ≠ DOMAIN_CRIT (0)
const DOMAIN_FAILURE = 0xfa117 // critical-failure stream; mirrors spell_formula::DOMAIN_FAILURE

/**
 * The prng STATE a player cast's point-removal dodge threads from — mix(mix(turn_seed, slot), DOMAIN_DODGE).
 * Mirrors spell_formula::dodge_seed byte-for-byte. Feed into spell_formula::remove_points as its `rng`; the roll
 * is deterministic + client-previewable (public turn-seed derivation). Mob-cast drains instead thread the crank.
 * @param {number} seed the turn_seed @param {number} slot the action index this turn @returns {number} uint32
 */
export const dodge_seed = (seed, slot) => mix(mix(seed, slot), DOMAIN_DODGE)

/** The deterministic critical-failure roll for one action slot. Mirrors spell_formula::critical_failure_roll. */
export const critical_failure_roll = (seed, slot, denominator) =>
  denominator > 0 ? mix(mix(seed, slot), DOMAIN_FAILURE) % denominator : 0

/**
 * Does `crit_roll` crit at `crit_rate` (1-in-X; 0 = never; `crit_bonus` lowers X, floored at 2 = the 50% cap)?
 * The 1-in-X rate becomes a basis-point threshold: crit iff roll < 10000/X. Mirrors spell_formula::crit_at.
 * Live chain paths pass the caster's folded `critical_hit`; preview callers must mirror that bonus exactly.
 * @param {number} crit_roll @param {number} crit_rate @param {number} crit_bonus @returns {boolean}
 */
export const crit_at = (crit_roll, crit_rate, crit_bonus) => {
  if (crit_rate === 0) return false
  const effective = crit_rate >= crit_bonus + 2 ? crit_rate - crit_bonus : 2
  return crit_roll < Math.floor(CRIT_SCALE / effective)
}

// TACKLE stream (the movement escape contest): a player move's roll draws off the SAME public turn-seed as
// crit/dodge — a NEW domain tag, zero new RNG — folded with the action slot AND the runner's live MP (moves
// never advance the slot; MP strictly decreases on every failed escape, so each re-attempt reprices — no free
// identical re-roll). Mob moves draw the crank thread instead (never previewable).
const DOMAIN_TACKLE = 0x7ac1e // tackle stream domain tag (spell_formula::DOMAIN_TACKLE); ≠ CRIT/DODGE/FAILURE

/**
 * The prng STATE a player move's tackle roll draws from — `mix(mix(mix(turn_seed, slot), mp), DOMAIN_TACKLE)`.
 * Mirrors spell_formula::tackle_seed byte-for-byte. The roll is `rng_next(state).value % den` against the
 * `tackle_contest` fraction (fight_tackle.js) — deterministic + client-previewable, parity-pinned by
 * test/tackle_golden.test.js against the numbers the chain committed in aresrpg_fight::tackle_tests.
 * @param {number} seed the turn_seed @param {number} slot casts_this_turn @param {number} mp the runner's MP
 * @returns {number} uint32
 */
export const tackle_seed = (seed, slot, mp) =>
  mix(mix(mix(seed, slot), mp), DOMAIN_TACKLE)
