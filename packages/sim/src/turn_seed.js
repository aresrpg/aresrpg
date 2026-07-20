// §7 TURN-SEED SLOTS — the CLIENT MIRROR of the on-chain per-turn CRIT determinism contract
// (aresrpg_foundation::spell_formula + aresrpg_fight::fight::turn_seed), byte-identical so a client preview
// matches the chain's settlement exactly.
//
// Crits are a per-turn REVEALED SEQUENCE: at turn start a `turn_seed` is derived PURELY from public fight state
// (world_seed, spawn_id, turn_deadline_ms, seat — no stored field, upgrade-safe). Each committed damaging action
// of the turn takes the next SLOT index (the escrow's `casts_this_turn` counter — weapon strikes count too), and
// slot `i` carries a fixed crit roll bound to the INDEX ONLY (never the spell/target — kills cross-target
// fishing; slot-routing is the mechanic). The client folds this to PREVIEW, before committing, which queued
// slots crit. DAMAGE IS EXACT: a hit deals precisely its authored base — crit swaps to
// the crit base, nothing else moves. (The pre-ceremony ±15% global variance band was REMOVED from the chain;
// per-spell authored ranges are a future spells-package schema evolution, not this layer.)
//
// DERIVATION (every step a `prng.mix` fold — mirrors spell_formula.move / fight.move byte-for-byte):
//   turn_seed  = mix(mix(mix(world_seed, spawn_id), turn_deadline_ms), seat)
//   crit_roll  = mix(mix(turn_seed, slot), DOMAIN_CRIT) % 10000     ∈ [0, 10000)   (basis points)
// Parity is pinned by test/turn_seed.test.js against golden vectors extracted from the Move source of truth
// (`sui move test` debug-print probe over aresrpg_foundation) + spell_formula's own t_crit_at_bp_threshold set.

import { mix } from './prng.js'

const CRIT_SCALE = 10000 // crit-roll fixed-point scale (basis points)
const DOMAIN_CRIT = 0 // crit stream domain tag (spell_formula::DOMAIN_CRIT)

/**
 * The turn's seed — derived PURELY from public fight state (no stored field; upgrade-safe). Mirrors
 * fight.move::turn_seed. Each seat gets its own sequence; a fresh `turn_deadline_ms` (stamped + emitted in
 * TurnStarted) re-seeds every turn. Inputs may be Number or BigInt (world_seed/spawn_id/turn_deadline_ms are
 * u64 off the SDK decode — BigInt-safe).
 * @param {{ world_seed: number|bigint, spawn_id: number|bigint, turn_deadline_ms: number|bigint, seat: number|bigint }} fight
 * @returns {number} uint32
 */
export const turn_seed = ({ world_seed, spawn_id, turn_deadline_ms, seat }) =>
  mix(mix(mix(world_seed, spawn_id), turn_deadline_ms), seat)

/**
 * Slot `i`'s CRIT ROLL — a spell/target-INDEPENDENT value in [0, 10000) derived from (turn_seed, slot). Mirrors
 * spell_formula::slot_crit_roll. `slot` = the action's commit-order index this turn (casts_this_turn pre-action).
 * @param {number} seed the turn_seed
 * @param {number} slot the action index this turn
 * @returns {number}
 */
export const slot_crit_roll = (seed, slot) =>
  mix(mix(seed, slot), DOMAIN_CRIT) % CRIT_SCALE

// AP/MP-removal DODGE stream: the point-removal contest draws off the SAME public turn-seed as
// crit — a NEW domain tag, zero new RNG — so a client previews a drain's dodge before commit exactly like a crit.
const DOMAIN_DODGE = 0xd0d6e // dodge stream domain tag (spell_formula::DOMAIN_DODGE); ≠ DOMAIN_CRIT (0)

/**
 * The prng STATE a player cast's point-removal dodge threads from — mix(mix(turn_seed, slot), DOMAIN_DODGE).
 * Mirrors spell_formula::dodge_seed byte-for-byte. Feed into spell_formula::remove_points as its `rng`; the roll
 * is deterministic + client-previewable (public turn-seed derivation). Mob-cast drains instead thread the crank.
 * @param {number} seed the turn_seed @param {number} slot the action index this turn @returns {number} uint32
 */
export const dodge_seed = (seed, slot) => mix(mix(seed, slot), DOMAIN_DODGE)

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
