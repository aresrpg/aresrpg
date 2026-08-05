// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TRAVEL BUDGET — the deterministic JS twin of `aresrpg_foundation::world_math` (SPEC §17.3 speed-budget law,
// packages/move/foundation/sources/world_math.move). The chain's overworld position rule is TIME-BUDGETED, not
// a radius: a claimed position is legal iff the straight-line distance from the character's proven checkpoint
// is physically coverable at the world's `speed_budget` in the elapsed time since that checkpoint was written
// (`world::verify_travel` → `world_math::travel_ok`, abort 121 ETravelTooFar). Every client-side question of
// the form "would the chain accept a body standing HERE?" derives from this module — writing a second, looser
// or stricter rule anywhere in the client is how a client renders a position the chain refuses to act from.
//
// FIDELITY. Ported line for line from the Move source: same constants, same saturation guards, same EXACT
// squared-distance compare (no sqrt, no floats). Move's `u64` division truncates, so every division here is
// `Math.floor`. The pinned parity oracle is `move/foundation/tests/world_math_tests.move` — its assertions are
// replayed verbatim in `packages/sdk/test/travel.test.js`, so a chain-side tuning change reds the twin.
//
// COORDINATES. The chain compares UNSIGNED chain block coords; the client works in SIGNED world blocks. The
// two spaces differ by ONE per-axis integer offset (`bounds/2`, @aresrpg/sdk/coords) shared by both points, so
// every delta this module measures is identical in either space — callers may pass whichever they hold, as
// long as BOTH points are in the SAME space and are whole blocks (the value a PTB would send).

// ── Overflow-guard + mount constants (mirrors world_math.move) ──
/** A budget that dwarfs any in-world distance short-circuits the compare (no squaring). */
const MAX_LINEAR = 4_000_000
/** Pathological elapsed saturates the budget instead of overflowing. */
const BIG_MS = 10_000_000_000_000
/** `speed_budget` is blocks/sec ×100; ÷100 (fixed-point) then ÷1000 (ms→s). */
const SPEED_SCALE = 100_000
/** ×1.5 mount budget = ×3/2, granted only when a pet is equipped at BOTH ends of the move. */
const PET_NUM = 3
const PET_DEN = 2

/**
 * Max coverable distance in BLOCKS over `elapsed_ms` at `speed_budget` (blocks/sec ×100), ×1.5 when
 * `pet_both`. Saturates for pathological elapsed so the product never overflows.
 * @param {number} speed_budget @param {number} elapsed_ms @param {boolean} [pet_both]
 * @returns {number}
 */
export function travel_budget_blocks(speed_budget, elapsed_ms, pet_both = false) {
  const raw = elapsed_ms >= BIG_MS ? MAX_LINEAR : Math.floor((speed_budget * elapsed_ms) / SPEED_SCALE)
  return pet_both ? Math.floor(raw / PET_DEN) * PET_NUM : raw
}

/**
 * `true` iff traveling `(from_x, from_z)` → `(to_x, to_z)` by `now_ms` is physically coverable at
 * `speed_budget`. THE rule the chain enforces — a client check that answers `false` here is a position the
 * chain would refuse to act from. A clock regression (`now_ms < from_ms`) is always false: the chain aborts
 * it as ECheckpointFuture before the budget is ever consulted.
 * @param {number} speed_budget blocks/sec ×100 (the world's dial)
 * @param {number} from_x @param {number} from_z @param {number} from_ms the proven checkpoint
 * @param {number} to_x @param {number} to_z @param {number} now_ms the claimed position + its instant
 * @param {boolean} [pet_both] pet equipped at BOTH ends (§17.2)
 * @returns {boolean}
 */
export function travel_ok(speed_budget, from_x, from_z, from_ms, to_x, to_z, now_ms, pet_both = false) {
  if (now_ms < from_ms) return false
  const budget = travel_budget_blocks(speed_budget, now_ms - from_ms, pet_both)
  if (budget >= MAX_LINEAR) return true
  const dx = Math.abs(to_x - from_x)
  const dz = Math.abs(to_z - from_z)
  return budget * budget >= dx * dx + dz * dz
}
