// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HP MATH — the client's HP door: the lazy natural-regen kernel (ANNEX §5.4), plus the max-HP kernel RE-EXPORTED
// from `@aresrpg/sdk/stats`, which owns it. The max-HP formula and the per-class base-HP table used to be copied
// here too, and that second home is precisely what let the client drift 35 points under the chain (#867 / #880);
// the SDK reads the base off its own class table, whose parity with `aresrpg::config` default_classes() is pinned
// by packages/sdk/test/max_hp_parity.test.js. Direction is forced: the frontend may import the SDK, never the
// reverse. Zero state, zero effects — plain scalar transforms, exactly like the Move module
// (packages/move/foundation/sources/progression_math.move). read_character.js's character_max_hp / projected_hp
// are thin adapters over these; there is NO other HP formula in the client (single source of truth).
export { base_hp_for_class, max_hp_from_base } from '@aresrpg/sdk/stats'

// ── ANNEX §5.4 FROZEN constants — VERBATIM from progression_math.move (they ride WITH the immutable XP curve;
//    they are NOT admin dials): the natural-regen rate as an EXACT integer rational.
const REGEN_BASE = 150 // §5.4: 2.0 HP/s × 75
const REGEN_PER_LEVEL = 6 // 0.08 HP/s per level × 75
const REGEN_PER_WIS = 2 // (1/37.5) HP/s per wisdom × 75
const REGEN_DEN_MS = 75_000 // 75 (per-second denominator) × 1000 ms/s

const regen_num = (level, wisdom) => REGEN_BASE + level * REGEN_PER_LEVEL + wisdom * REGEN_PER_WIS

// Lazy natural HP regen — VERBATIM port of progression_math::regen_hp, incl. the REMAINDER-CARRY LAW: the stamp
// advances only by the time that produced WHOLE HP (`consumed_ms`), NEVER straight to `now_ms`, so the sub-unit
// fraction stays on the clock and slow ticks never starve. Returns `[new_hp, new_hp_updated_ms]` (JS tuple).
// Total function, matching the Move branches exactly:
//   • already full (hp >= max_hp) ⇒ [max_hp, now]        • no elapsed / clock skew ⇒ unchanged
//   • sub-unit accrual (accrued == 0) ⇒ HP AND stamp UNCHANGED (the whole span rolls forward)
//   • reaches max ⇒ [max_hp, now] (overshoot fraction discarded at full HP)
// All divisions FLOOR (Math.floor) to mirror Move's u64 integer arithmetic byte-for-byte. Read callers keep [0].
/** @param {number} hp @param {number} hp_updated_ms @param {number} max_hp @param {number} level @param {number} wisdom @param {number} now_ms @returns {[number, number]} */
export function regen_hp(hp, hp_updated_ms, max_hp, level, wisdom, now_ms) {
  if (hp >= max_hp) return [max_hp, now_ms]
  if (now_ms <= hp_updated_ms) return [hp, hp_updated_ms]
  const elapsed = now_ms - hp_updated_ms
  const num = regen_num(level, wisdom) // ≥ REGEN_BASE, never 0
  const accrued = Math.floor((elapsed * num) / REGEN_DEN_MS)
  if (accrued === 0) return [hp, hp_updated_ms] // sub-unit only — keep the stamp so the fraction carries forward
  if (hp + accrued >= max_hp) return [max_hp, now_ms] // reached full — no remainder to bank
  const consumed_ms = Math.floor((accrued * REGEN_DEN_MS) / num) // the ms that produced WHOLE hp (≤ elapsed)
  return [hp + accrued, hp_updated_ms + consumed_ms] // carry the leftover fraction as un-consumed time
}

// The earliest absolute millisecond at which the SAME untouched anchor projects one more whole HP. Absolute
// boundaries are essential: repeatedly adding a rounded per-point delay loses the fractional cadence, while this
// inversion of `floor(elapsed × num / den)` carries it exactly. Null means the projection is already at its chain
// settle cap and needs no timer. Pure scheduling data only — callers own the timer edge.
/** @param {number} hp @param {number} hp_updated_ms @param {number} max_hp @param {number} level @param {number} wisdom @param {number} now_ms @returns {number | null} */
export function next_regen_hp_ms(hp, hp_updated_ms, max_hp, level, wisdom, now_ms) {
  const [current] = regen_hp(hp, hp_updated_ms, max_hp, level, wisdom, now_ms)
  if (current >= max_hp) return null
  const elapsed = Math.max(0, now_ms - hp_updated_ms)
  const num = regen_num(level, wisdom)
  const accrued = Math.floor((elapsed * num) / REGEN_DEN_MS)
  const next_elapsed_ms = Math.ceil(((accrued + 1) * REGEN_DEN_MS) / num)
  return hp_updated_ms + next_elapsed_ms
}
