/// TAUX DE BRISAGE — the Retro crushing-coefficient INFLATION ECONOMY as pure math (R3 canon:
/// docs/RETRO_RUNES_RESEARCH.md; design rulings DECISIONS 2026-07-09: ONE shared object, no bracket sharding,
/// bulk crush in one tx with the per-item sequential formula preserved, one write per crush tx). NO state, NO
/// objects, NO events, NO `sui::random` here — rng threads as `&mut u64` per `prng` conventions; main owns the
/// shared `Taux` object later and calls these calculators.
///
/// ── UNITS ───────────────────────────────────────────────────────────────────────────────────────────────
/// Coefficients are MILLI-PERCENT (`COEFF_SCALE` = 1000/percent): neutral 100% = 100_000; bounds are Retro's
/// [1%, 4000%] = [1_000, 4_000_000]. Weights arrive in the catalog's ×5 domain (`rune_catalog`) — the yield
/// formula takes unit_weight AND rune_weight both ×5, so the scale cancels exactly.
///
/// ── STATE MODEL the math assumes (main-side, ONE shared object) ────────────────────────────
/// • per level-BRACKET: `pressure` — a MONOTONE counter, incremented once per crush tx (phase-2, capped).
/// • per template: `coeff_milli` + `carry` (sub-unit accrual remainder) + `snapshot` (bracket pressure at the
///   template's last settle).
/// R3 mechanics honoured: crushing X drops ONLY X (immediate, front-loaded, asymptotic to the 1% floor);
/// crushing X raises the OTHER templates of X's bracket (bounded redistribution via the pressure counter — a
/// template's own snapshot is stamped AFTER its tx's emission, so it NEVER accrues its own pressure); NO clock
/// term anywhere ("le temps ne compte absolument pas"); no scheduled reset. Coefficient is PUBLIC on-chain and
/// DISPLAYED in UI (R3 visibility flag — hiding is impossible; honest chain).
///
/// ── TWO-PHASE CRUSH PROTOCOL (entry-snapshot pricing) ───────────────────────────────────────────────────
/// PHASE 1 — price at entry, BEFORE any rng draw: `settle_pressure` folds the bracket-pressure delta into the
///   template's stored coefficient (remainder carried per the lazy-accrual law — never re-stamp the snapshot
///   without carrying the sub-unit remainder). The settled coefficient is the tx's price basis AND the number
///   the UI shows.
/// PHASE 2 — execute per-item SEQUENTIALLY: for each crushed item, `rune_yield` at the CURRENT
///   coefficient (stochastic rounding draws rng), then `update_on_crush` decays the coefficient before the next
///   item — bulk crushing one template self-limits (≈13.9% left of a 100% coeff after 50 items). After the
///   loop, ONE `crush_pressure`-capped emission bumps the bracket counter and the template stamps
///   `snapshot = counter AFTER the emission` (self-pressure exclusion). One write to the shared object per tx.
///   The tx's WRITE SET is identical whatever the rolls — yields vary in VALUE only (write-set parity law).
///
/// ── THREAT MODEL (R3 attack surface, designed for perfect information + atomic composition) ─────────────
/// Taux sniping / bracket pumping are bounded by `PRESSURE_TX_CAP` (max bracket uplift per tx) and by the
/// front-loaded self-decay (a sniper's own dump collapses its template's coefficient within the same tx).
/// Mass-crush fodder botting self-limits the same way; the recipe-less 50% coefficient cap kills boss-loot
/// fodder (R2/R3).
///
/// ── OURS vs CANON ───────────────────────────────────────────────────────────────────────────────────────
/// The Retro source NEVER published the increment/decay curves (R3). Bounds [1,4000]%, front-loaded self-decay,
/// bracket-up redistribution, no-clock, stochastic rounding, recipe-less cap, and the yield formula are CANON
/// (R3/brief). The specific DECAY_KEEP, PRESSURE_RATE and PRESSURE_TX_CAP constants are OURS — each declared
/// with its derivation at the constant. Declared, not smuggled.
module aresrpg_foundation::taux;

use aresrpg_foundation::prng;

// ╔════════════════ [ Bounds (Retro canon) ] ═════════════════════════════════ ]

/// Milli-percent scale: coefficient 100% = 100_000.
const COEFF_SCALE: u64 = 1000;
/// Retro floor: 1% (5+ sources, R3).
const FLOOR_MILLI: u64 = 1_000;
/// Retro cap: 4000% (5+ sources, R3).
const CAP_MILLI: u64 = 4_000_000;
/// The neutral coefficient every fresh template starts at: 100%.
const NEUTRAL_MILLI: u64 = 100_000;
/// Recipe-less templates (rare drops/quest items) price at min(coeff, 50%) — the anti "boss loot as fodder"
/// rule (R2/R3 "flat 50%"; SYNTHESIS #2 "capped at 50% coeff" — the cap reading, per the S-48 brief).
const RECIPELESS_CAP_MILLI: u64 = 50_000;

// ╔════════════════ [ OURS — declared curve constants ] ══════════════════════ ]

/// OURS: per-ITEM front-loaded decay keeps 96/100 of the distance to the floor. Derived from R3's anecdote
/// (1000%→~700%→~500% on successive crush BATCHES) read as ~8-item batches: 0.96^8 ≈ 0.72, 0.96^16 ≈ 0.52.
/// Asymptotic to — and terminally reaching — the 1% floor (integer truncation closes the last milli).
const DECAY_KEEP_NUM: u64 = 96;
const DECAY_KEEP_DEN: u64 = 100;

/// OURS: pressure→coefficient rate — each ×5-weight unit of crushed stat lines raises bracket peers by 3/5
/// milli. Derived from R3's drift anecdote (untouched templates reaching ~400%): ~1000 typical items (retro
/// weight ~100 each = 500 ×5-units) ⇒ +300% = 300_000 milli ⇒ 300_000 / 500_000 = 3/5 milli per unit. The
/// deliberate /5 is why the remainder carry exists (lazy-accrual law).
const PRESSURE_RATE_NUM: u64 = 3;
const PRESSURE_RATE_DEN: u64 = 5;

/// OURS: per-TX cap on the bracket-pressure emission (≈50 typical items' weight) ⇒ max bracket uplift
/// ≈ +15% (25_000 × 3/5 = 15_000 milli) per tx — bounds sniping/pumping (R3 attacks 3-4) while leaving the
/// organic pump alive. A bulk crush beyond the cap still yields runes; only its bracket IMPACT saturates.
const PRESSURE_TX_CAP: u64 = 25_000;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EPressureRewind: u64 = 1; // settle: bracket pressure below the template's snapshot (monotone violated)
const EZeroDenominator: u64 = 2; // stochastic_round / rune_yield: division by zero

// ╔════════════════ [ Phase 1 — settle / price (lazy accrual, remainder carried) ] ═ ]

/// Fold the bracket-pressure delta since `snapshot` into `coeff_milli`, carrying the sub-unit remainder:
/// `units = carry + (pressure_now − snapshot) × 3` · gain = units / 5 · new carry = units % 5. Returns
/// `(new_coeff_milli, new_carry)`; the caller stamps its snapshot to the pressure value it settled against
/// (post-emission for the crushed template itself — self-pressure exclusion, module doc). Splitting one delta
/// across many settles is EXACTLY equivalent to one settle (the carry law) until the cap clamps.
public fun settle_pressure(coeff_milli: u64, carry: u64, snapshot: u64, pressure_now: u64): (u64, u64) {
  assert!(pressure_now >= snapshot, EPressureRewind);
  let units = carry + (pressure_now - snapshot) * PRESSURE_RATE_NUM;
  let gain = units / PRESSURE_RATE_DEN;
  (clamp_coefficient(coeff_milli + gain), units % PRESSURE_RATE_DEN)
}

/// Read-only view of the settled coefficient (phase-1 price + the UI-displayed number). Same math as
/// `settle_pressure`, coefficient only.
public fun effective_coefficient(coeff_milli: u64, carry: u64, snapshot: u64, pressure_now: u64): u64 {
  let (coeff, _carry) = settle_pressure(coeff_milli, carry, snapshot, pressure_now);
  coeff
}

// ╔════════════════ [ Phase 2 — per-item decay + capped emission ] ═══════════ ]

/// Front-loaded self-decay, applied once per CRUSHED ITEM (sequentially inside a bulk tx): keep 96/100 of the
/// distance to the 1% floor. Only crushing THIS template calls it (R3: the fall is self-only, immediate,
/// asymptotic; the floor is terminally reached when the distance truncates to zero).
public fun update_on_crush(coeff_milli: u64): u64 {
  let c = clamp_coefficient(coeff_milli);
  FLOOR_MILLI + (c - FLOOR_MILLI) * DECAY_KEEP_NUM / DECAY_KEEP_DEN
}

/// The bracket-pressure emission for one crush tx: the total ×5-weight of all stat lines crushed, saturated at
/// `PRESSURE_TX_CAP` (bounded per-tx bracket impact — R3 threat model). Main adds this to the bracket counter
/// ONCE per tx, after the per-item loop.
public fun crush_pressure(total_weight_crushed: u64): u64 {
  if (total_weight_crushed < PRESSURE_TX_CAP) total_weight_crushed else PRESSURE_TX_CAP
}

// ╔════════════════ [ Yield (R3 confirmed formula + EV-preserving rounding) ] ═ ]

/// Runes of one type from one stat line (R3 confirmed, linear in taux):
///   `(item_level × stat_value × unit_weight × coeff) / (100 × rune_weight)`
/// computed in milli-coefficient (`den` carries the extra ×1000) with EV-PRESERVING STOCHASTIC ROUNDING
/// (computed 10.2 ⇒ 80% ten / 20% eleven). `unit_weight`/`rune_weight` arrive ×5 (catalog domain — the scale
/// cancels). `recipe_less` prices at min(coeff, 50%). Overflow-safe: max realistic numerator
/// 200 × 10⁴ × 500 × 4×10⁶ = 4×10¹⁵ « u64::MAX; den = 10⁵ × rune_weight < 2³² so one prng draw is unbiased
/// enough per house convention (`prng::rng_int` is `%`-based).
public fun rune_yield(
  item_level: u64,
  stat_value: u64,
  unit_weight: u64,
  rune_weight: u64,
  coeff_milli: u64,
  recipe_less: bool,
  rng: &mut u64,
): u64 {
  assert!(rune_weight > 0, EZeroDenominator);
  let mut coeff = clamp_coefficient(coeff_milli);
  if (recipe_less && coeff > RECIPELESS_CAP_MILLI) coeff = RECIPELESS_CAP_MILLI;
  let num = item_level * stat_value * unit_weight * coeff;
  let den = 100 * COEFF_SCALE * rune_weight;
  stochastic_round(num, den, rng)
}

/// EV-preserving stochastic rounding of `num / den`: floor, plus one more with probability `(num % den) / den`.
/// The rng draw is CONDITIONAL on a nonzero remainder — faithful to the sealed crush Java (`if (fractional > 0
/// && rng.nextDouble() < fractional)`); an exact quotient consumes no entropy.
public fun stochastic_round(num: u64, den: u64, rng: &mut u64): u64 {
  assert!(den > 0, EZeroDenominator);
  let q = num / den;
  let r = num % den;
  if (r > 0 && prng::draw(rng) % den < r) q + 1 else q
}

// ╔════════════════ [ Bounds + getters ] ═════════════════════════════════════ ]

/// Clamp a coefficient into Retro's [1%, 4000%].
public fun clamp_coefficient(coeff_milli: u64): u64 {
  if (coeff_milli < FLOOR_MILLI) FLOOR_MILLI
  else if (coeff_milli > CAP_MILLI) CAP_MILLI
  else coeff_milli
}

public fun coeff_scale(): u64 { COEFF_SCALE }
public fun floor_milli(): u64 { FLOOR_MILLI }
public fun cap_milli(): u64 { CAP_MILLI }
public fun neutral_milli(): u64 { NEUTRAL_MILLI }
public fun recipeless_cap_milli(): u64 { RECIPELESS_CAP_MILLI }
public fun pressure_tx_cap(): u64 { PRESSURE_TX_CAP }
