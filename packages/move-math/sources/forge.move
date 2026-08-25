// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORGE — the rune math. Two lanes, both PURE (no objects, no events, no `sui::random` — rng
/// threads as `&mut u64` per `prng`; stats arrive as a raw `vector<u64>` of length 15, index =
/// `rune_catalog` stat id, magnitudes above centre):
///
///   • SCRIBE (`apply_rune`) — a VERBATIM port of the sealed 1.29 `applyRune` closed form. Three
///     outcomes (CRITICAL_SUCCESS / NEUTRAL_SUCCESS / CRITICAL_FAILURE) driven by proximity to
///     the template max, an exotic floor, an over-mage penalty, a runic-level bonus, and a crit
///     ratio. NS weight + CF loss are paid PUITS-FIRST, overflowing into a random over-maged
///     stat reduction with the destroyed-weight overshoot re-banked into puits. WRITE-SET PARITY:
///     `ForgeResult` populates every field in all three outcomes (kills gas-based outcome
///     filtering); the outcome is DATA, never a different write set.
///
///   • CRUSH (`crush_lines`) — STATELESS + LINEAR + LOSSY (owner 2026-08-11: no taux economy).
///     Each positive runeable stat line yields `value / ba_amount × CRUSH_KEEP` base runes
///     (EV-preserving stochastic rounding — small stats often give nothing: lossy by design),
///     then a per-rune tier roll. No coefficient, no bracket, no shared state.
///
/// FIXED-POINT: rates in [0,1] are `u64` ×`RATE_SCALE` (1e6). Puits / weight / stat math is
/// INTEGER in the ×20 weight domain (`rune_catalog::weight_scale`) so puits stays exact.
module aresrpg_math::forge;

use aresrpg_math::{prng, rune_catalog as cat};

// ╔════════════════ [ Fixed-point + 1.29 constants (verbatim) ] ═════════════ ]

const RATE_SCALE: u64 = 1_000_000;

const PROX_BASE: u64 = 990_000; // 0.99 — proximityRate at 0% proximity
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

/// `MAX_STAT_WEIGHT` (101) in the ×20 domain: the gain hard-cap is
/// `templateMax + floor(2020/(unit×20))` ≡ `templateMax + floor(101/unit)`.
const MAX_STAT_WEIGHT_SCALED: u64 = 2_020;

/// OURS (owner 2026-08-11): crushing is LOSSY — the rune pool is `CRUSH_KEEP_NUM/CRUSH_KEEP_DEN`
/// of the stat's points (currently 1/4 ≈ a quarter back, always less than the item). One knob.
const CRUSH_KEEP_NUM: u64 = 1;
const CRUSH_KEEP_DEN: u64 = 4;

// ╔════════════════ [ Outcomes + sentinels ] ════════════════════════════════ ]

const OUTCOME_CS: u8 = 0; // CRITICAL_SUCCESS — rune passes, no loss, puits unchanged
const OUTCOME_NS: u8 = 1; // NEUTRAL_SUCCESS — rune passes, weight balanced (puits/loss)
const OUTCOME_CF: u8 = 2; // CRITICAL_FAILURE — rune fails, weight lost (puits/loss)

const NO_STAT: u8 = 255; // "no stat" sentinel (valid ids are 0..14)

const EBadLen: u64 = 1; // a stat vector was not exactly 15 long
const EZeroDen: u64 = 2; // stochastic_round: division by zero

// ╔════════════════ [ IO structs (copy/drop — pure data, never stored) ] ════ ]

/// The result of one rune application. `new_stats` = the full 15-field raw block after the rune.
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

/// The pick made by `select_stat_to_reduce`. `found == false` ⇒ no reducible stat existed.
public struct StatLoss has copy, drop {
  found: bool,
  stat: u8,
  new_value: u64,
  amount: u64,
}

// ╔════════════════ [ SCRIBE — applyRune (verbatim) ] ═══════════════════════ ]

/// Apply one rune to `current` (15 raw magnitudes) against `template_max` (15 raw maxes).
/// `rune_value` / `rune_weight` come from `rune_catalog`; `runic_level` is the scribe job level
/// (≥1); `current_puits` the item's sink balance; `rng` the threaded prng. Does NOT mutate inputs.
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
  assert!(current.length() == cat::stat_count(), EBadLen);
  assert!(template_max.length() == cat::stat_count(), EBadLen);

  let mut stats = current;
  let cur = stats[rune_stat as u64];
  let max_stat = template_max[rune_stat as u64];
  let exotic = max_stat == 0; // stat absent from the template
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

  // GAS-UNIFORM (owner gas law): every outcome runs the SAME compute — one gain, and one loss
  // SELECTION (the 15-stat loop + its single draw), UNCONDITIONALLY — then writes only what the
  // outcome calls for. `scribe` burns the rune BEFORE this roll, so an uneven compute cost would
  // let a gas-budget attacker OOG-revert the expensive failure (rune refunded) while committing
  // the cheap success — a filter. The write divergence below is one vector store, gas-negligible.
  let gained = gain_capped(cur, rune_value, max_stat, rune_stat);
  let protected = if (outcome == OUTCOME_CF) NO_STAT else rune_stat;
  let remaining = if (new_puits >= rune_weight) 0 else rune_weight - new_puits;
  let loss = select_stat_to_reduce(&stats, &template_max, protected, remaining, rng);

  if (outcome != OUTCOME_CF) *&mut stats[rune_stat as u64] = gained; // CS + NS raise the target
  if (outcome != OUTCOME_CS) {
    // pay the rune's weight: puits FIRST, else the precomputed loss (re-banking the overshoot)
    if (new_puits >= rune_weight) {
      new_puits = new_puits - rune_weight;
    } else if (loss.found) {
      *&mut stats[loss.stat as u64] = loss.new_value;
      let lost_weight = loss.amount * cat::stat_unit_weight(loss.stat);
      new_puits = if (lost_weight > remaining) lost_weight - remaining else 0;
      lost_stat = loss.stat; lost_amount = loss.amount;
    } else {
      new_puits = 0;
    };
  };

  let applied_value = if (outcome != OUTCOME_CF) rune_value else 0;
  ForgeResult { outcome, new_stats: stats, new_puits, applied_stat: rune_stat, applied_value, lost_stat, lost_amount }
}

/// Select which stat to reduce to burn `weight_needed`: prefer OVER-MAGED stats (value >
/// templateMax), else any positive stat; pick uniformly at random; lose `min(current, max(1,
/// ceil(weight_needed / unitWeight)))` points. `protected` is skipped.
public fun select_stat_to_reduce(
  stats: &vector<u64>,
  template_max: &vector<u64>,
  protected: u8,
  weight_needed: u64,
  rng: &mut u64,
): StatLoss {
  let mut over_maged = vector<u8>[];
  let mut candidates = vector<u8>[];
  let count = cat::stat_count();
  let mut i = 0;
  while (i < count) {
    let val = stats[i];
    let id = i as u8;
    if (id != protected && val > 0) {
      if (val > template_max[i]) over_maged.push_back(id) else candidates.push_back(id);
    };
    i = i + 1;
  };

  // Draw UNCONDITIONALLY, before the empty check — gas-uniformity law (owner): if the runed stat
  // is the gear's only positive stat, CS/NS protect it (empty pool) while CF does not (non-empty).
  // Drawing only on a non-empty pool would make CF cost a draw that CS skips → gas-based filtering.
  let roll = prng::draw(rng) as u64;
  let pool = if (!over_maged.is_empty()) over_maged else candidates;
  if (pool.is_empty()) return StatLoss { found: false, stat: NO_STAT, new_value: 0, amount: 0 };

  let chosen = pool[roll % pool.length()];
  let unit = cat::stat_unit_weight(chosen);
  let ceil_div = (weight_needed + unit - 1) / unit;
  let mut amount = if (ceil_div < 1) 1 else ceil_div;
  let cur = stats[chosen as u64];
  if (amount > cur) amount = cur;
  StatLoss { found: true, stat: chosen, new_value: cur - amount, amount }
}

/// The scribe gain hard-cap: `min(current + value, templateMax + floor(101 / unitWeight))`,
/// computed in the ×20 domain (exact equivalence). Applies on CS and NS.
public fun gain_capped(current: u64, value: u64, template_max: u64, stat: u8): u64 {
  let cap = template_max + MAX_STAT_WEIGHT_SCALED / cat::stat_unit_weight(stat);
  let nv = current + value;
  if (nv < cap) nv else cap
}

/// XP for a successful rune application: `max(1, floor(weight · (1 + itemLevel/50) · tierMult))`,
/// tierMult = 2 for Ra else 1. `rune_weight` arrives ×20; the integer form divides the scale out.
public fun compute_xp(tier: u8, rune_weight: u64, item_level: u64): u64 {
  let tier_mult = if (tier >= cat::tier_ra()) 2 else 1;
  let xp = rune_weight * (50 + item_level) * tier_mult / (50 * cat::weight_scale());
  if (xp < 1) 1 else xp
}

// ╔════════════════ [ CRUSH — stateless, linear, lossy ] ════════════════════ ]

/// One item's raw stat block → a 51-vector of owed runes (index `stat×3 + (tier−1)`). Per
/// positive runeable line: a give-back POOL of `value × CRUSH_KEEP` stat-points (lossy — always
/// LESS than the stat, owner 2026-08-11), then runes are drawn from the pool — tier rolled by the
/// stat value (higher tiers rarer AND costlier), each CONSUMING its amount from the pool so the
/// total rune value is conserved. The sub-`Ba` remainder is lost (the lossy tail). No state.
public fun crush_lines(raw: &vector<u64>, rng: &mut u64): vector<u64> {
  let count = cat::stat_count();
  let mut counts = zero_counts();
  let mut s = 0;
  while (s < count) {
    let value = raw[s];
    let stat = s as u8;
    if (value > 0 && cat::is_runeable(stat)) {
      let mut pool = stochastic_round(value * CRUSH_KEEP_NUM, CRUSH_KEEP_DEN, rng);
      while (pool > 0) {
        let mut tier = roll_tier(stat, value, rng);
        let mut amount = cat::rune_amount(stat, tier);
        while (amount > pool && tier > cat::tier_ba()) {
          tier = tier - 1;
          amount = cat::rune_amount(stat, tier);
        };
        if (amount > pool) break; // even a Ba won't fit — the remainder is the lossy tail
        let idx = (s * 3) + ((tier as u64) - 1);
        *&mut counts[idx] = counts[idx] + 1;
        pool = pool - amount;
      };
    };
    s = s + 1;
  };
  counts
}

/// Tier roll for one yielded rune (1.29 `selectRuneTier`): tiers DESCENDING; eligible if
/// `value ≥ amount×3`; selected with probability `min(1, value/(amount×10)) × 0.5`; falls to Ba.
public fun roll_tier(stat: u8, value: u64, rng: &mut u64): u8 {
  let mut tier = cat::max_tier(stat);
  while (tier > cat::tier_ba()) {
    if (cat::has_rune(stat, tier)) {
      let amount = cat::rune_amount(stat, tier);
      if (value >= amount * 3) {
        let ratio = if (value * RATE_SCALE / (amount * 10) < RATE_SCALE) value * RATE_SCALE / (amount * 10) else RATE_SCALE;
        if (prng::draw(rng) % RATE_SCALE < ratio / 2) return tier;
      };
    };
    tier = tier - 1;
  };
  cat::tier_ba()
}

/// EV-preserving stochastic rounding of `num / den`: floor, plus one more with probability
/// `(num % den) / den`. The rng draw is CONDITIONAL on a nonzero remainder.
public fun stochastic_round(num: u64, den: u64, rng: &mut u64): u64 {
  assert!(den > 0, EZeroDen);
  let q = num / den;
  let r = num % den;
  if (r > 0 && prng::draw(rng) % den < r) q + 1 else q
}

/// Element-wise `owed += counts` — the crush accumulator across a multi-item batch.
public fun add_counts(owed: &mut vector<u64>, counts: &vector<u64>) {
  let mut idx = 0;
  while (idx < counts.length()) {
    *&mut owed[idx] = owed[idx] + counts[idx];
    idx = idx + 1;
  };
}

/// A fresh all-zero 51-vector (`stat_count × 3` tiers) — the crush accumulator shape.
public fun zero_counts(): vector<u64> {
  let mut v = vector<u64>[];
  let mut i = 0;
  while (i < cat::stat_count() * 3) { v.push_back(0); i = i + 1; };
  v
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

public fun loss_found(l: &StatLoss): bool { l.found }
public fun loss_stat(l: &StatLoss): u8 { l.stat }
public fun loss_new_value(l: &StatLoss): u64 { l.new_value }
public fun loss_amount(l: &StatLoss): u64 { l.amount }

// ╔════════════════ [ Integer helpers ] ═════════════════════════════════════ ]

fun sat_sub(a: u64, b: u64): u64 { if (a > b) a - b else 0 }
fun max_u64(a: u64, b: u64): u64 { if (a > b) a else b }
fun clamp(v: u64, lo: u64, hi: u64): u64 { if (v < lo) lo else if (v > hi) hi else v }
