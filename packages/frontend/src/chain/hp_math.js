// HP MATH — the SINGLE off-chain home for character HP derivation, a PURE mirror of the on-chain kernels so a
// client read matches chain truth EXACTLY. Ports `aresrpg_foundation::progression_math` (max_hp + lazy natural
// regen, ANNEX §4c/§5.4) VERBATIM, plus the per-class BASE-HP defaults from `aresrpg::config` (§17.31). Zero
// state, zero effects — plain scalar transforms, exactly like the Move module (packages/move/foundation/sources/
// progression_math.move + packages/move/aresrpg/sources/config.move). read_character.js's character_max_hp /
// projected_hp are thin adapters over these; there is NO other HP formula in the client (single source of truth).

// ── ANNEX §4c / §5.4 FROZEN constants — VERBATIM from progression_math.move (they ride WITH the immutable XP
//    curve; they are NOT admin dials). max_hp slope + the natural-regen rate as an EXACT integer rational.
const HP_PER_LEVEL = 5 // §4c: +5 HP per level gained
const REGEN_BASE = 150 // §5.4: 2.0 HP/s × 75
const REGEN_PER_LEVEL = 6 // 0.08 HP/s per level × 75
const REGEN_PER_WIS = 2 // (1/37.5) HP/s per wisdom × 75
const REGEN_DEN_MS = 75_000 // 75 (per-second denominator) × 1000 ms/s

// ── Per-class DEFAULT base HP — MIRRORS `aresrpg::config` default_classes() (§17.31 / ANNEX §4), the values the
//    on-chain GameConfig ships with at init. These per-class rows are admin-TUNABLE via `set_class_base_hp`, but:
//      1. NO `set_class_base_hp` is ever composed on THIS deployment (verified: no call in frontend / sdk / seed,
//         and config_dials.js — the only class-dial admin UI — exposes level gates ONLY, not class base HP), so
//      2. the `ClassRowSet` event never fires, `/v1/config.classes` stays `{}` forever (the indexer projects
//         ClassRowSet events, never the init defaults — packages/rpc project.rs:533), therefore
//      3. these defaults ARE the exact live on-chain values. The moment an admin tunes a row, the live value must
//         come from a populated `/v1/config.classes[class_id]` override — a DECLARED follow-up (needs a /v1
//         config-classes fetch + the frozen slug→id order); until then the defaults are chain-truthful, not a
//         blind hardcode. Keyed by the lowercase §3 class slug (the form read_character carries as `classe`).
export const DEFAULT_CLASS_BASE_HP = {
  senshi: 70,
  yajin: 45,
  ikari: 120,
  mori: 55,
  tokei: 45,
  shugo: 50,
  yogen: 30,
  rojin: 50,
  shusen: 65,
  tomoda: 30,
  asobi: 55,
  iyashi: 50,
}

// The default base HP for a §3 class slug. Unknown / missing slug (a mob, or a not-yet-hydrated party row) →
// senshi's baseline (70) — a total function that never returns NaN; every real §3 character carries a valid slug.
/** @param {string | null | undefined} classe @returns {number} */
export function base_hp_for_class(classe) {
  return DEFAULT_CLASS_BASE_HP[String(classe ?? '')] ?? DEFAULT_CLASS_BASE_HP.senshi
}

// Max HP over a class BASE at `level` with `vitality` — ANNEX §4c frozen formula, VERBATIM from
// progression_math::max_hp_from_base. `vitality` is the TOTAL folded into the pool (allocated + net gear).
/** @param {number} base_hp @param {number} level @param {number} vitality @returns {number} */
export function max_hp_from_base(base_hp, level, vitality) {
  const growth = level > 1 ? (level - 1) * HP_PER_LEVEL : 0
  return base_hp + growth + vitality
}

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
  const num = REGEN_BASE + level * REGEN_PER_LEVEL + wisdom * REGEN_PER_WIS // ≥ REGEN_BASE, never 0
  const accrued = Math.floor((elapsed * num) / REGEN_DEN_MS)
  if (accrued === 0) return [hp, hp_updated_ms] // sub-unit only — keep the stamp so the fraction carries forward
  if (hp + accrued >= max_hp) return [max_hp, now_ms] // reached full — no remainder to bank
  const consumed_ms = Math.floor((accrued * REGEN_DEN_MS) / num) // the ms that produced WHOLE hp (≤ elapsed)
  return [hp + accrued, hp_updated_ms + consumed_ms] // carry the leftover fraction as un-consumed time
}
