// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Rune outcomes over signed item statistics and one puits ledger. Crushing retains its
/// separate committed-seed flow. All weights use rune_catalog's exact integer scale.
module aresrpg_math::forge;

use aresrpg_math::{item_stats::{Self, ItemStatistics}, prng, rune_catalog as cat};
use std::bcs;

const RATE_SCALE: u64 = 1_000_000;
const PERCENT: u64 = 10_000;
const MAX_OVER_WEIGHT: u64 = 101;
const MAX_U64: u64 = 0xffff_ffff_ffff_ffff;
const CRUSH_KEEP_NUM: u64 = 1;
const CRUSH_KEEP_DEN: u64 = 4;
const OUTCOME_CS: u8 = 0;
const OUTCOME_NS: u8 = 1;
const OUTCOME_CF: u8 = 2;
const EStatLimit: u64 = 1;
const EZeroDen: u64 = 2;
const EPuitsTooLarge: u64 = 3;

public struct ForgeResult has copy, drop {
  outcome: u8,
  new_stats: ItemStatistics,
  new_puits: u64,
  applied_value: u64,
  lost_amounts: vector<u64>,
}

/// Natural maxima above 101 weight remain valid. Overmages use the whole-line limit,
/// and the combined excess over all natural maxima may not grow beyond 101 weight.
public fun can_apply_rune(
  current: &ItemStatistics, natural_max: &ItemStatistics, stat: u8, tier: u8,
): bool {
  if (!cat::has_rune(stat, tier)) return false;
  let values = current.to_vector();
  let maxima = natural_max.to_vector();
  let index = stat as u64;
  let value = values[index] as u64;
  let maximum = maxima[index] as u64;
  let next = value + cat::rune_amount(stat, tier);
  let unit = cat::stat_unit_weight(stat);
  let limit = MAX_OVER_WEIGHT * cat::weight_scale();
  let ceiling = max_u64(maximum, (item_stats::shift() as u64) + limit / unit);
  if (next > ceiling) return false;
  let mut over = 0;
  let mut i = 0;
  while (i < cat::stat_count()) {
    over = over + sat_sub(values[i] as u64, maxima[i] as u64) * cat::stat_unit_weight(i as u8);
    i = i + 1;
  };
  let next_over = over - sat_sub(value, maximum) * unit + sat_sub(next, maximum) * unit;
  next_over <= limit || next_over <= over
}

/// Qualified Retro-emulator probability model, adapted to signed natural ranges.
/// Reference: StarLoco JobAction.craftMaging1, revision 038dd961. This is an explicit
/// emulator model, not a claim to possess Ankama's unpublished server formula.
public fun outcome_chances(
  current: &ItemStatistics, natural_min: &ItemStatistics, natural_max: &ItemStatistics,
  stat: u8, tier: u8,
): (u64, u64) {
  let values = current.to_vector();
  let minima = natural_min.to_vector();
  let maxima = natural_max.to_vector();
  let index = stat as u64;
  let center = item_stats::shift() as u64;
  let value = values[index] as u64;
  let minimum = minima[index] as u64;
  let maximum = maxima[index] as u64;
  let amount = cat::rune_amount(stat, tier);
  let weight = cat::rune_weight(stat, tier);
  let scale = cat::weight_scale();
  let unit = cat::stat_unit_weight(stat);
  let exotic = minimum == center && maximum == center;
  if (exotic && weight > 50 * scale) return (PERCENT, PERCENT);
  let mut current_weight = 0;
  let mut minimum_weight = 0;
  let mut maximum_weight = 0;
  let mut i = 0;
  while (i < cat::stat_count()) {
    let price = cat::stat_unit_weight(i as u8);
    current_weight = current_weight + (values[i] as u64) * price;
    minimum_weight = minimum_weight + (minima[i] as u64) * price;
    maximum_weight = maximum_weight + (maxima[i] as u64) * price;
    i = i + 1;
  };
  let mut line = max_u64(60 * PERCENT, quality(value + amount, minimum, maximum));
  let mut whole = max_u64(15 * PERCENT, quality(current_weight, minimum_weight, maximum_weight));
  let ratio = if (exotic) sat_sub(value, center) * RATE_SCALE
    else if (maximum > center) sat_sub(value, center) * RATE_SCALE / (maximum - center)
    else quality(value, minimum, maximum);
  let over = value + amount > maximum;
  if (exotic || over) line = RATE_SCALE;
  if (weight <= 3 * scale && unit == scale && ratio > 65 * PERCENT) line = 150 * PERCENT;
  if (!exotic && weight <= 3 * scale && unit == scale && ratio > 80 * PERCENT) line = 300 * PERCENT;
  if (!exotic && weight <= 3 * scale && unit == 3 * scale && ratio > 85 * PERCENT) line = 200 * PERCENT;
  let line_factor = if (exotic) 40 else if (over) 60 else 47;
  let whole_factor = if (exotic || over) 54 else 50;
  if (exotic) whole = 15 * PERCENT + sat_sub(value, center) * unit * PERCENT / scale
    + weight * 3 * PERCENT / scale;
  let line_cost = line * line_factor / 100;
  let whole_cost = if (!exotic && whole < 50 * PERCENT) whole else whole * whole_factor / 100;
  let raw_critical = sat_sub(RATE_SCALE, line_cost + whole_cost + 5 * PERCENT);
  let mut critical = (raw_critical + PERCENT - 1) / PERCENT * PERCENT;
  let mut neutral = if (critical > 50 * PERCENT) RATE_SCALE - critical
    else if (critical < 25 * PERCENT) critical + 10 * PERCENT else 50 * PERCENT;
  if (over && !exotic) {
    if (critical <= PERCENT) { critical = PERCENT; neutral = 22 * PERCENT; };
  } else if (!exotic && critical < 15 * PERCENT) {
    critical = 15 * PERCENT;
    neutral = 50 * PERCENT;
  };
  (critical, critical + neutral)
}

fun quality(value: u64, minimum: u64, maximum: u64): u64 {
  if (maximum <= minimum) 0 else sat_sub(value, minimum) * RATE_SCALE / (maximum - minimum)
}

/// One rune, one transaction. After the outcome draw, all loops have fixed lengths and
/// all value choices use fixed-width selection. No result changes the number of stat visits,
/// RNG draws, result fields, or written fields.
public fun apply_rune(
  current: ItemStatistics, natural_min: ItemStatistics, natural_max: ItemStatistics,
  rune_stat: u8, rune_tier: u8, current_puits: u64, rng: &mut u64,
): ForgeResult {
  assert!(can_apply_rune(&current, &natural_max, rune_stat, rune_tier), EStatLimit);
  let (critical, success) = outcome_chances(&current, &natural_min, &natural_max, rune_stat, rune_tier);
  let before = current.to_vector().map!(|value| value as u64);
  let minima = natural_min.to_vector().map!(|value| value as u64);
  let maxima = natural_max.to_vector().map!(|value| value as u64);
  let floors = vector::tabulate!(cat::stat_count(), |i| min_u64(before[i], min_u64(minima[i], item_stats::shift() as u64)));
  let prices = vector::tabulate!(cat::stat_count(), |i| cat::stat_unit_weight(i as u8));
  let mut largest_price = 0;
  prices.do_ref!(|price| largest_price = max_u64(largest_price, *price));
  assert!(current_puits <= MAX_U64 - largest_price, EPuitsTooLarge);
  let amount = cat::rune_amount(rune_stat, rune_tier);
  let weight = cat::rune_weight(rune_stat, rune_tier);
  let target = rune_stat as u64;

  let roll = prng::draw(rng) % RATE_SCALE;
  let outcome = (flag(roll >= critical) + flag(roll >= success)) as u8;
  let mut stats = before;
  *stats.borrow_mut(target) = stats[target] + choose(outcome != OUTCOME_CF, amount, 0);
  let mut remaining = choose(outcome != OUTCOME_CS, weight, 0);
  let mut puits = current_puits;
  let order = shuffled_stats(rng);

  // Other over/exo lines, then puits, then the target's over/exo portion.
  let mut i = 0;
  while (i < cat::stat_count()) {
    let index = order[i];
    pay_stat(&mut stats, index, maxima[index], prices[index], index != target, &mut remaining, &mut puits);
    i = i + 1;
  };
  let from_puits = min_u64(puits, remaining);
  puits = puits - from_puits;
  remaining = remaining - from_puits;
  pay_stat(&mut stats, target, maxima[target], prices[target], true, &mut remaining, &mut puits);

  // Ordinary lines can pay across several stats. The target pays last, including its new gain.
  i = 0;
  while (i < cat::stat_count()) {
    let index = order[i];
    pay_stat(&mut stats, index, floors[index], prices[index], index != target, &mut remaining, &mut puits);
    i = i + 1;
  };
  pay_stat(&mut stats, target, floors[target], prices[target], true, &mut remaining, &mut puits);
  let applied_value = sat_sub(stats[target], before[target]);
  let lost_amounts = vector::tabulate!(cat::stat_count(), |index| sat_sub(before[index], stats[index]));
  ForgeResult { outcome, new_stats: item_stats::from_vector(stats.map!(|value| value as u16)),
    new_puits: puits, applied_value, lost_amounts }
}

fun pay_stat(
  stats: &mut vector<u64>, index: u64, floor: u64, price: u64, eligible: bool,
  remaining: &mut u64, puits: &mut u64,
) {
  let available = sat_sub(stats[index], floor);
  let required = (*remaining + price - 1) / price;
  let removed = min_u64(available, required) * flag(eligible);
  *stats.borrow_mut(index) = stats[index] - removed;
  let paid = removed * price;
  *puits = *puits + sat_sub(paid, *remaining);
  *remaining = sat_sub(*remaining, paid);
}

fun shuffled_stats(rng: &mut u64): vector<u64> {
  let mut order = vector::tabulate!(cat::stat_count(), |index| index);
  let mut remaining = cat::stat_count();
  while (remaining > 1) {
    let index = prng::draw(rng) % remaining;
    remaining = remaining - 1;
    let last = order[remaining];
    let selected = order[index];
    *order.borrow_mut(remaining) = selected;
    *order.borrow_mut(index) = last;
  };
  order
}

// Native BCS encodes either boolean in one byte. Fixed-width indexing avoids branching on
// a random-derived amount; both alternatives must be safe to evaluate.
fun flag(value: bool): u64 { bcs::to_bytes(&value)[0] as u64 }
fun choose(condition: bool, yes: u64, no: u64): u64 { vector[no, yes][flag(condition)] }
fun min_u64(a: u64, b: u64): u64 { choose(a < b, a, b) }
fun max_u64(a: u64, b: u64): u64 { choose(a > b, a, b) }
fun sat_sub(a: u64, b: u64): u64 { a - min_u64(a, b) }

public fun outcome(result: &ForgeResult): u8 { result.outcome }
public fun new_stats(result: &ForgeResult): ItemStatistics { result.new_stats }
public fun new_puits(result: &ForgeResult): u64 { result.new_puits }
public fun applied_value(result: &ForgeResult): u64 { result.applied_value }
public fun lost_amounts(result: &ForgeResult): vector<u64> { result.lost_amounts }
public fun outcome_cs(): u8 { OUTCOME_CS }
public fun outcome_ns(): u8 { OUTCOME_NS }
public fun outcome_cf(): u8 { OUTCOME_CF }

// ╔════════════════ [ CRUSH — stateless, linear, lossy ] ════════════════════ ]

/// One item's raw stat block → a stat_count × 3 vector of owed runes (index `stat×3 + (tier−1)`). Per
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
    if (value > 0) {
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

/// A fresh all-zero stat_count × 3 vector (`stat_count × 3` tiers) — the crush accumulator shape.
public fun zero_counts(): vector<u64> {
  let mut v = vector<u64>[];
  let mut i = 0;
  while (i < cat::stat_count() * 3) { v.push_back(0); i = i + 1; };
  v
}
