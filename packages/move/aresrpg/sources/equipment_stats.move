// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EQUIPMENT STATS — signed centered-item folding over the frozen unsigned combat block.
///
/// `ItemStatistics` stores signed lines around 32768, while `spell::Stats` is all `u64`. Positive and negative
/// aggregates therefore stay in separate blocks; no signed sentinel ever enters the legacy-positive `gear` fields
/// observed by the indexer. AresRPG brand law keeps this runtime surface numeric and canonical: invented corpus
/// aliases never enter the combat fold.
module aresrpg::equipment_stats;

use aresrpg::{item_stats::{Self, ItemStatistics}};
use aresrpg_foundation::spell::{Self, Stats};

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Split one centered field into disjoint positive/malus magnitudes. Both subtractions are branch-guarded, so a
/// below-center value can never underflow `u16`; the widened `u64` magnitude is at most 32768.
fun z70(v: u16): (u64, u64) {
  let center = item_stats::shift();
  if (v > center) (((v - center) as u64), 0)
  else if (v < center) (0, ((center - v) as u64))
  else (0, 0)
}

fun bonus(v: u16): u64 { let (positive, _) = z70(v); positive }
fun malus(v: u16): u64 { let (_, negative) = z70(v); negative }

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// The exact item-key consumer mapping. `critical_chance` and `critical_outcomes` are deliberately absent; the
/// reseed must write the combat denominator reduction to canonical `critical`.
public(package) fun z504(s: &ItemStatistics): (Stats, Stats) {
  let mut positive = spell::new_stats(
    bonus(item_stats::strength(s)), bonus(item_stats::intelligence(s)), bonus(item_stats::chance(s)),
    bonus(item_stats::agility(s)), bonus(item_stats::raw_damage(s)), bonus(item_stats::critical(s)),
    bonus(item_stats::range(s)), bonus(item_stats::fire_resistance(s)), bonus(item_stats::water_resistance(s)),
    bonus(item_stats::earth_resistance(s)), bonus(item_stats::air_resistance(s)),
  );
  spell::set_ext_gear(
    &mut positive,
    bonus(item_stats::wisdom(s)), bonus(item_stats::action(s)), bonus(item_stats::movement(s)),
    bonus(item_stats::vitality(s)),
  );
  let mut negative = spell::new_stats(
    malus(item_stats::strength(s)), malus(item_stats::intelligence(s)), malus(item_stats::chance(s)),
    malus(item_stats::agility(s)), malus(item_stats::raw_damage(s)), malus(item_stats::critical(s)),
    malus(item_stats::range(s)), malus(item_stats::fire_resistance(s)), malus(item_stats::water_resistance(s)),
    malus(item_stats::earth_resistance(s)), malus(item_stats::air_resistance(s)),
  );
  spell::set_ext_gear(
    &mut negative,
    malus(item_stats::wisdom(s)), malus(item_stats::action(s)), malus(item_stats::movement(s)),
    malus(item_stats::vitality(s)),
  );
  (positive, negative)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Apply `base + positive - malus`, with the foundation subtraction flooring every unsigned field at zero.
public(package) fun z17(base: &Stats, positive: &Stats, malus: &Stats): Stats {
  spell::stats_sub(&spell::stats_add(base, positive), malus)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the growth row
/// Apply a positive and negative action/movement line to a class scalar. Addition precedes the checked subtraction,
/// so an oversized -32768 item line floors at zero without an intermediate `u64` underflow.
public(package) fun z18(base: u64, positive: u64, malus: u64): u64 {
  let total = base + positive;
  if (total > malus) total - malus else 0
}

/// Remove a malus only when that item was folded by this upgrade. Legacy items had maluses dropped, so removing one
/// must leave the additive malus cache unchanged; this prevents a pre-upgrade -N line becoming a phantom +N buff.
public(package) fun remove_malus(cache: &Stats, item_malus: &Stats, signed_folded: bool): Stats {
  if (signed_folded) spell::stats_sub(cache, item_malus) else *cache
}
