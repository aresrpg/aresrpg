/// FORGEMAGIE — the rune SCRIBING closed form, a VERBATIM port of the sealed reference-corpus `ForgemagieService.applyRune`
/// (docs/HYTALE_FORMULAS_VENDORED.md §2; DECISIONS 2026-07-09 `ANNEX_SHAPE_FREEZE:149` "ports verbatim"). PURE
/// math: no objects, no events, no `sui::random` — rng threads as `&mut u64` per `prng` conventions; the item's
/// stats are a raw `vector<u64>` of length 17 (index = `rune_catalog` stat id, decentered magnitudes) so the
/// centering convention + `ItemStatistics` storage stay entirely main-side.
///
/// 3 outcomes (CRITICAL_SUCCESS / NEUTRAL_SUCCESS / CRITICAL_FAILURE) driven by PROXIMITY (how close the target
/// stat is to the template max), a flat EXOTIC floor (stat absent from the template), an over-mage penalty, a
/// runic-level bonus, and a crit ratio. NS weight + CF loss are paid PUITS-FIRST, overflowing into a random stat
/// reduction (over-maged stats first) with the destroyed-weight overshoot RE-BANKED into puits.
///
/// FIXED-POINT: the Java `double` rates in [0,1] are held in `u64` scaled by `RATE_SCALE` (1e6). All puits /
/// weight / stat math is INTEGER in the catalog's ×5 weight domain (`rune_catalog::weight_scale()` — Retro's
/// fractional 0.2/pt Vi becomes 1), so the puits NEVER goes fractional: every weight paid, released, or
/// re-banked is a whole number of ×5 units. The puits value main stores/displays is in these units (UI divides
/// by 5 for the Retro view). Any JS twin for client prediction MUST mirror this integer scheme (not floats).
///
/// ── DESIGN LAWS (S-48 riders) ────────────────────────────────────────────────────────────────────────────
/// • UNPREDICTABILITY: there is NO preview/simulate path — an outcome is computable ONLY by consuming the
///   threaded `rng`. Main draws a FRESH `&Random` seed at its entry door, so the outcome is unknowable before
///   the tx commits. No function here derives an outcome from readable pre-draw state.
/// • WRITE-SET PARITY (kills gas-based outcome filtering, a Sui exploit class): `ForgeResult` populates ALL
///   fields in ALL three outcomes — `new_stats` is ALWAYS the full 17-field block, `new_puits` is ALWAYS set
///   (unchanged on CS), `lost_stat == NO_STAT` when nothing was destroyed. So the main door writes an IDENTICAL
///   set every branch — full stats + puits + one uniform event — and the outcome divergence is COMPUTE-ONLY.
/// • STORED-TYPE QUARANTINE: the IO structs are `copy, drop` ONLY (no `store`) — they can never be embedded in
///   main's persistent state or events; main extracts primitives and writes its own storage.
module aresrpg_foundation::forgemagie;

use aresrpg_foundation::{prng, rune_catalog, taux};

// ╔════════════════ [ Fixed-point + Java constants (§2 verbatim) ] ═══════════ ]

/// Rates in [0,1] are stored ×1e6. RNG rolls draw in [0, RATE_SCALE).
const RATE_SCALE: u64 = 1_000_000;

const PROX_BASE: u64 = 990_000; // 0.99  — proximityRate at 0% proximity
const PROX_SLOPE: u64 = 490_000; // 0.49 — proximityRate = 0.99 − proximity·0.49
const EXOTIC_RATE: u64 = 10_000; // 0.01 — exotic / floor rate
const OVERMAGE_COEF: u64 = 800_000; // 0.8 — over-mage penalty = overRatio²·0.8
const LEVEL_BONUS_PER: u64 = 4_000; // 0.004 per runic level above 1
const RATE_MIN: u64 = 10_000; // 0.01 — finalRate clamp floor
const RATE_MAX: u64 = 990_000; // 0.99 — finalRate clamp ceiling
const CRIT_BASE: u64 = 650_000; // 0.65
const CRIT_PROX_SLOPE: u64 = 500_000; // 0.50 — critRatio = 0.65 − proximity·0.50 + level·0.002
const CRIT_LEVEL_PER: u64 = 2_000; // 0.002 per runic level above 1
const CRIT_RATIO_MIN: u64 = 150_000; // 0.15
const CRIT_RATIO_MAX: u64 = 700_000; // 0.70
const CRIT_CHANCE_MIN: u64 = 10_000; // 0.01
const CRIT_CHANCE_MAX: u64 = 600_000; // 0.60

/// `MAX_STAT_WEIGHT` (101) in the catalog's ×5 weight domain (101 × `rune_catalog::weight_scale()`): the gain
/// hard-cap is `templateMax + floor(505/unitWeight×5)` ≡ the Java `templateMax + floor(101/unitWeight)` EXACTLY
/// for every catalog row (505 = 101×5, so the scale cancels inside the floor). 505 also prices Retro's
/// fractional Vi honestly: floor(505/1) = 505 Vi of over-mage headroom = 101 weight at 0.2/pt.
const MAX_STAT_WEIGHT_SCALED: u64 = 505;

// ╔════════════════ [ Outcomes + sentinels ] ═════════════════════════════════ ]

const OUTCOME_CS: u8 = 0; // CRITICAL_SUCCESS — rune passes, no loss, puits unchanged
const OUTCOME_NS: u8 = 1; // NEUTRAL_SUCCESS — rune passes, weight balanced (puits/loss)
const OUTCOME_CF: u8 = 2; // CRITICAL_FAILURE — rune fails, weight lost (puits/loss)

/// "No stat" sentinel (valid ids are 0..16): a null `protectedStat` and an empty `lostStat`.
const NO_STAT: u8 = 255;

const EBadLen: u64 = 1; // a stat vector was not exactly 17 long

// ╔════════════════ [ IO structs (copy/drop — pure data) ] ══════════════════ ]

/// The result of one rune application. `new_stats` = the full 17-field block after the rune (raw magnitudes).
/// `lost_stat == NO_STAT` ⇒ nothing was destroyed (puits absorbed it, or CS).
public struct ForgeResult has copy, drop {
  outcome: u8,
  new_stats: vector<u64>,
  new_puits: u64,
  applied_stat: u8,
  applied_value: u64,
  lost_stat: u8,
  lost_amount: u64,
}

/// The pick made by `select_stat_to_reduce`. `found == false` ⇒ no reducible stat existed (empty pool).
public struct StatLoss has copy, drop {
  found: bool,
  stat: u8,
  new_value: u64,
  amount: u64,
}

// ╔════════════════ [ applyRune (§2 verbatim) ] ═════════════════════════════ ]

/// Apply one rune to `current` (17 raw magnitudes) against `template_max` (17 raw maxes). `rune_value` /
/// `rune_weight` come from `rune_catalog`; `runic_level` is the scribe job level (≥1); `current_puits` the
/// item's sink balance; `rng` the threaded prng state. Returns the full `ForgeResult`. Does NOT mutate inputs.
public fun apply_rune(
  current: vector<u64>,
  template_max: vector<u64>,
  rune_stat: u8,
  rune_value: u64,
  rune_weight: u64,
  runic_level: u64,
  current_puits: u64,
  rng: &mut u64,
): ForgeResult {
  assert!(current.length() == rune_catalog::stat_count(), EBadLen);
  assert!(template_max.length() == rune_catalog::stat_count(), EBadLen);

  let mut stats = current;
  let cur = *stats.borrow(rune_stat as u64);
  let max_stat = *template_max.borrow(rune_stat as u64);
  let exotic = max_stat == 0; // stat absent from the template (the on-chain analog of templateRange == null)
  let lvl = if (runic_level > 0) runic_level - 1 else 0;

  // proximity ×1e6 (1.0 when the template grants none of this stat)
  let proximity = if (max_stat > 0) cur * RATE_SCALE / max_stat else RATE_SCALE;

  // proximityRate = max(0, 0.99 − proximity·0.49); exotic overrides to 0.01
  let mut rate = sat_sub(PROX_BASE, proximity * PROX_SLOPE / RATE_SCALE);
  if (exotic) rate = EXOTIC_RATE;

  // over-mage: currentStatValue > maxStat → steep exponential penalty (or 0.01 when maxStat==0)
  if (cur > max_stat) {
    if (max_stat > 0) {
      let over = (cur - max_stat) * RATE_SCALE / max_stat; // overRatio ×1e6
      let penalty = over * over / RATE_SCALE * OVERMAGE_COEF / RATE_SCALE; // overRatio²·0.8
      rate = max_u64(EXOTIC_RATE, sat_sub(rate, penalty));
    } else {
      rate = EXOTIC_RATE;
    };
  };

  // level bonus + clamp; exotic bypasses the level bonus (flat 0.01)
  let mut final_rate = clamp(rate + lvl * LEVEL_BONUS_PER, RATE_MIN, RATE_MAX);
  if (exotic) final_rate = EXOTIC_RATE;

  // critRatio = clamp(0.65 − proximity·0.50 + level·0.002, 0.15, 0.70)
  let crit_ratio = clamp(
    sat_sub(CRIT_BASE + lvl * CRIT_LEVEL_PER, proximity * CRIT_PROX_SLOPE / RATE_SCALE),
    CRIT_RATIO_MIN,
    CRIT_RATIO_MAX,
  );
  // critChance = clamp(finalRate · critRatio, 0.01, 0.60)
  let crit_chance = clamp(final_rate * crit_ratio / RATE_SCALE, CRIT_CHANCE_MIN, CRIT_CHANCE_MAX);

  // roll ∈ [0, 1e6): CS < critChance ≤ NS < finalRate ≤ CF
  let roll = prng::draw(rng) % RATE_SCALE;
  let outcome = if (roll < crit_chance) OUTCOME_CS
    else if (roll < final_rate) OUTCOME_NS
    else OUTCOME_CF;

  let mut new_puits = current_puits;
  let mut lost_stat = NO_STAT;
  let mut lost_amount = 0;

  if (outcome == OUTCOME_CS) {
    // rune passes, no loss, puits unchanged
    *stats.borrow_mut(rune_stat as u64) = gain_capped(cur, rune_value, max_stat, rune_stat);
  } else if (outcome == OUTCOME_NS) {
    // rune passes, then balance its weight (protect the stat we just raised)
    *stats.borrow_mut(rune_stat as u64) = gain_capped(cur, rune_value, max_stat, rune_stat);
    let (p, ls, la) = pay_weight(&mut stats, &template_max, rune_stat, new_puits, rune_weight, rng);
    new_puits = p; lost_stat = ls; lost_amount = la;
  } else {
    // CF: no gain; lose the rune's full weight (nothing protected)
    let (p, ls, la) = pay_weight(&mut stats, &template_max, NO_STAT, new_puits, rune_weight, rng);
    new_puits = p; lost_stat = ls; lost_amount = la;
  };

  let applied_value = if (outcome != OUTCOME_CF) rune_value else 0;
  ForgeResult { outcome, new_stats: stats, new_puits, applied_stat: rune_stat, applied_value, lost_stat, lost_amount }
}

// ╔════════════════ [ Puits ledger (spend-first, re-bank excess) — §2 NS/CF ] ═ ]

/// Pay `weight` from the puits FIRST; on shortfall, zero the puits and destroy points from ONE random stat
/// (`select_stat_to_reduce`), RE-BANKING the destroyed-weight overshoot back into puits. `protected` (or
/// `NO_STAT`) is never reduced. Mutates `stats`. Returns `(new_puits, lost_stat|NO_STAT, lost_amount)`.
/// Public so the puits round-trip is directly testable.
public fun pay_weight(
  stats: &mut vector<u64>,
  template_max: &vector<u64>,
  protected: u8,
  puits: u64,
  weight: u64,
  rng: &mut u64,
): (u64, u8, u64) {
  if (puits >= weight) return (puits - weight, NO_STAT, 0);

  let remaining = weight - puits; // puits fully spent; this much weight must be destroyed
  let loss = select_stat_to_reduce(stats, template_max, protected, remaining, rng);
  if (!loss.found) return (0, NO_STAT, 0);

  *stats.borrow_mut(loss.stat as u64) = loss.new_value;
  let lost_weight = loss.amount * rune_catalog::stat_unit_weight(loss.stat);
  let new_puits = if (lost_weight > remaining) lost_weight - remaining else 0; // re-bank overshoot
  (new_puits, loss.stat, loss.amount)
}

/// Select which stat to reduce to burn `weight_needed` of weight (§2 `selectStatToReduce`): prefer OVER-MAGED
/// stats (value > templateMax), else any positive stat; pick uniformly at random from that pool; lose
/// `min(current, max(1, ceil(weight_needed / unitWeight)))` points. `protected` is skipped. Public for testing.
///
/// PORTED (reference corpus, sealed): a 2-BUCKET priority — over-maged first, then a uniform-random regular stat, with NO
/// stat-TYPE ordering. The Retro tool leak's granular in-game order (PA/PM/CC/Invoc → Do/Soins/%Do → primaries →
/// Vita) is a DIVERGENCE we did NOT implement — the sealed source is the canon per the ticket (flagged in report).
/// The pool is built in stat-id order (the Java iterated an unordered HashMap; the random pick makes order
/// immaterial, and id-order is deterministic on-chain).
public fun select_stat_to_reduce(
  stats: &vector<u64>,
  template_max: &vector<u64>,
  protected: u8,
  weight_needed: u64,
  rng: &mut u64,
): StatLoss {
  let mut over_maged = vector<u8>[];
  let mut candidates = vector<u8>[];
  let count = rune_catalog::stat_count();
  let mut i = 0;
  while (i < count) {
    let val = *stats.borrow(i);
    let id = i as u8;
    if (id != protected && val > 0) {
      if (val > *template_max.borrow(i)) over_maged.push_back(id) else candidates.push_back(id);
    };
    i = i + 1;
  };

  let pool = if (!over_maged.is_empty()) over_maged else candidates;
  if (pool.is_empty()) return StatLoss { found: false, stat: NO_STAT, new_value: 0, amount: 0 };

  let chosen = *pool.borrow((prng::draw(rng) as u64) % pool.length());
  let unit = rune_catalog::stat_unit_weight(chosen);
  let ceil_div = (weight_needed + unit - 1) / unit; // ceil(weight_needed / unit)
  let mut amount = if (ceil_div < 1) 1 else ceil_div;
  let cur = *stats.borrow(chosen as u64);
  if (amount > cur) amount = cur;
  StatLoss { found: true, stat: chosen, new_value: cur - amount, amount }
}

// ╔════════════════ [ Gain cap + XP ] ═══════════════════════════════════════ ]

/// The scribe gain hard-cap (§2): `min(current + value, templateMax + floor(101 / unitWeight))`, computed in
/// the ×5 weight domain (exact equivalence — see `MAX_STAT_WEIGHT_SCALED`). Applies on CS and NS. Every scaled
/// unit weight ≥ 1, so the divisor never zeroes.
public fun gain_capped(current: u64, value: u64, template_max: u64, stat: u8): u64 {
  let cap = template_max + MAX_STAT_WEIGHT_SCALED / rune_catalog::stat_unit_weight(stat);
  let nv = current + value;
  if (nv < cap) nv else cap
}

/// XP for a successful rune application (§2 `computeXp`): `max(1, floor(weight · (1 + itemLevel/50) · tierMult))`,
/// tierMult = 2 for Ra (tier ≥ 3) else 1. `rune_weight` arrives ×5 (catalog domain); the integer form divides
/// the scale back out: `weight×5 · (50 + itemLevel) · tierMult / (50 · 5)` — Java-faithful floor semantics.
public fun compute_xp(tier: u8, rune_weight: u64, item_level: u64): u64 {
  let tier_mult = if (tier >= rune_catalog::tier_ra()) 2 else 1;
  let xp = rune_weight * (50 + item_level) * tier_mult / (50 * rune_catalog::weight_scale());
  if (xp < 1) 1 else xp
}

// ╔════════════════ [ ForgeResult accessors ] ═══════════════════════════════ ]

public fun outcome(r: &ForgeResult): u8 { r.outcome }
public fun new_stats(r: &ForgeResult): vector<u64> { r.new_stats }
public fun new_puits(r: &ForgeResult): u64 { r.new_puits }
public fun applied_stat(r: &ForgeResult): u8 { r.applied_stat }
public fun applied_value(r: &ForgeResult): u64 { r.applied_value }
public fun lost_stat(r: &ForgeResult): u8 { r.lost_stat }
public fun lost_amount(r: &ForgeResult): u64 { r.lost_amount }
public fun has_loss(r: &ForgeResult): bool { r.lost_stat != NO_STAT }

public fun outcome_cs(): u8 { OUTCOME_CS }
public fun outcome_ns(): u8 { OUTCOME_NS }
public fun outcome_cf(): u8 { OUTCOME_CF }
public fun no_stat(): u8 { NO_STAT }

// StatLoss accessors (for direct tests of select_stat_to_reduce)
public fun loss_found(l: &StatLoss): bool { l.found }
public fun loss_stat(l: &StatLoss): u8 { l.stat }
public fun loss_new_value(l: &StatLoss): u64 { l.new_value }
public fun loss_amount(l: &StatLoss): u64 { l.amount }

// ╔════════════════ [ Integer helpers ] ═════════════════════════════════════ ]

fun sat_sub(a: u64, b: u64): u64 { if (a > b) a - b else 0 }
fun max_u64(a: u64, b: u64): u64 { if (a > b) a else b }
fun clamp(v: u64, lo: u64, hi: u64): u64 { if (v < lo) lo else if (v > hi) hi else v }

// ╔════════════════ [ Brisage (crush) kernels — S-70 size split, moved VERBATIM from core ] ═ ]
// The per-item crush math over PLAIN inputs (raw 17-stat vector + level + coefficient + the seeded prng thread).
// Core `aresrpg::forgemagie` owns the objects/receipts/events and delegates here.

/// The R3 crush-yield calibration divisor — a PER-LEVEL-BAND CURVE (curve-based;
/// docs/ECONOMY_SIM.md §7). The single flat divisor could not hold the same crush/sale floor at every level:
/// crush value multiplies `item_level × stat_value` (both level-growing), so it compounds FASTER than the
/// `level^1.4` marketplace sale law — one constant is inert at low levels or beats selling at high ones. Each
/// band's divisor is solved by the crush sim runner (see docs, sim/crush_run.mjs) so the STEADY-STATE crush ratio
/// reaches the 70% target ceiling at the band's peak level and NEVER exceeds it (crush never strictly beats
/// selling; verified global steady-state max = 70%, the same margin as the superseded flat fallback 19822).
/// Monotonic increasing — higher bands divide harder. `BAND_MAX_LEVEL[i]` is band i's inclusive upper level;
/// `BAND_DIVISOR` carries one extra trailing entry for levels above the last bound (151+). Pure integer math.
const BAND_MAX_LEVEL: vector<u64> = vector[20, 50, 100, 150];
const BAND_DIVISOR: vector<u64> = vector[277, 2044, 6675, 12922, 19822];

/// The crush-yield divisor for `item_level` — the value `crush_lines` divides the raw R3 yield by. Pure
/// lookup over the band table. `public(package)`: consumed by `crush_lines` (this module) and the goldens.
public(package) fun band_divisor(item_level: u64): u64 {
  let maxes = BAND_MAX_LEVEL;
  let divs = BAND_DIVISOR;
  let n = maxes.length();
  let mut i = 0;
  while (i < n) {
    if (item_level <= *maxes.borrow(i)) return *divs.borrow(i);
    i = i + 1;
  };
  *divs.borrow(n) // levels above the last band bound (151+)
}

/// Legacy getter — kept for upgrade compatibility (this public signature is frozen). Returns the divisor at
/// the historic L50 reference level (DECISIONS 460's golden anchor); the LIVE dial is `band_divisor(level)`.
public fun yield_divisor(): u64 { band_divisor(50) }

/// One item's lines → (counts, weight) — the per-item brisage kernel. `counts` is a 51-vector indexed
/// `stat×3 + (tier−1)`; `weight` is the item's total crushed line weight (×5 domain — bracket pressure input).
/// Per positive RUNEABLE line: the CALIBRATED Retro yield (R3 formula ÷ band_divisor(item_level), EV-preserving stochastic
/// rounding), then the sealed reference-corpus `selectRuneTier` roll PER YIELDED RUNE (docs/HYTALE_FORMULAS_VENDORED.md).
public fun crush_lines(raw: &vector<u64>, item_level: u64, coeff_milli: u64, recipe_less: bool, rng: &mut u64): (vector<u64>, u64) {
  let count = rune_catalog::stat_count();
  let mut counts = zero_counts();
  let mut weight = 0u64;
  let mut s = 0;
  while (s < count) {
    let value = *raw.borrow(s);
    let stat = s as u8;
    if (value > 0 && rune_catalog::is_runeable(stat)) {
      let unit = rune_catalog::stat_unit_weight(stat);
      weight = weight + value * unit;
      let mut coeff = taux::clamp_coefficient(coeff_milli);
      if (recipe_less && coeff > taux::recipeless_cap_milli()) coeff = taux::recipeless_cap_milli();
      let num = item_level * value * unit * coeff;
      let den = 100 * taux::coeff_scale() * rune_catalog::rune_weight(stat, rune_catalog::tier_ba()) * band_divisor(item_level);
      let yield_n = taux::stochastic_round(num, den, rng);
      let mut k = 0;
      while (k < yield_n) {
        let tier = roll_tier(stat, value, rng);
        let idx = (s * 3) + ((tier as u64) - 1);
        *counts.borrow_mut(idx) = *counts.borrow(idx) + 1;
        k = k + 1;
      };
    };
    s = s + 1;
  };
  (counts, weight)
}

/// The reference corpus's `selectRuneTier` verbatim: tiers DESCENDING (Ra, Pa); eligible if `value ≥ amount×3`; selected with
/// probability `min(1, value/(amount×10)) × 0.5`; falls through to Ba.
public fun roll_tier(stat: u8, value: u64, rng: &mut u64): u8 {
  let top = rune_catalog::max_tier(stat);
  let mut tier = top;
  while (tier > rune_catalog::tier_ba()) {
    if (rune_catalog::has_rune(stat, tier)) {
      let amount = rune_catalog::rune_amount(stat, tier);
      if (value >= amount * 3) {
        let ratio = if (value * 1_000_000 / (amount * 10) < 1_000_000) value * 1_000_000 / (amount * 10) else 1_000_000;
        if (prng::draw(rng) % 1_000_000 < ratio / 2) return tier;
      };
    };
    tier = tier - 1;
  };
  rune_catalog::tier_ba()
}

/// Element-wise `owed += counts` (the crush accumulator over the 51-vector).
public fun add_counts(owed: &mut vector<u64>, counts: &vector<u64>) {
  let mut idx = 0;
  while (idx < counts.length()) {
    *owed.borrow_mut(idx) = *owed.borrow(idx) + *counts.borrow(idx);
    idx = idx + 1;
  };
}

/// A fresh all-zero 51-vector (`stat_count × 3` tiers) — the crush accumulator shape.
public fun zero_counts(): vector<u64> {
  let mut v = vector<u64>[];
  let mut i = 0;
  while (i < rune_catalog::stat_count() * 3) { v.push_back(0); i = i + 1; };
  v
}
