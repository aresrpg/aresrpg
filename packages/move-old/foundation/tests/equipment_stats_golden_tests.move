// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twins of `packages/sim/test/vectors/equipment_stats_golden.json` for formula cases.
#[test_only]
module aresrpg_foundation::equipment_stats_golden_tests;

use aresrpg_foundation::{prng, spell, spell_formula};

fun stats(strength: u64, intelligence: u64, chance: u64, agility: u64, raw_damage: u64): spell::Stats {
  spell::new_stats(strength, intelligence, chance, agility, raw_damage, 0, 0, 0, 0, 0, 0)
}

#[test]
/// Vector: earth_strength_percentage.
fun earth_strength_percentage() {
  assert!(spell_formula::amplify_damage(20, spell::el_earth(), &stats(200, 0, 0, 0, 0)) == 60, 0);
}

#[test]
/// Vector: fire_intelligence_percentage.
fun fire_intelligence_percentage() {
  assert!(spell_formula::amplify_damage(20, spell::el_fire(), &stats(0, 50, 0, 0, 0)) == 30, 0);
}

#[test]
/// Vector: water_chance_percentage.
fun water_chance_percentage() {
  assert!(spell_formula::amplify_damage(20, spell::el_water(), &stats(0, 0, 75, 0, 0)) == 35, 0);
}

#[test]
/// Vector: air_agility_percentage.
fun air_agility_percentage() {
  assert!(spell_formula::amplify_damage(20, spell::el_air(), &stats(0, 0, 0, 25, 0)) == 25, 0);
}

#[test]
/// Vector: percent_and_physical_damage_formula.
fun percent_and_physical_damage_formula() {
  let mut caster = stats(200, 0, 0, 0, 5);
  spell::add_stat(&mut caster, 8, 30);
  spell::set_physical_damage_for_testing(&mut caster, 10);
  assert!(spell_formula::amplify_damage(20, spell::el_earth(), &caster) == 81, 0);
}

#[test]
/// Vector: neutral_strength_and_physical_damage.
fun neutral_strength_and_physical_damage() {
  let mut caster = stats(50, 0, 0, 0, 3);
  spell::set_physical_damage_for_testing(&mut caster, 7);
  assert!(spell_formula::amplify_damage(20, spell::el_none(), &caster) == 40, 0);
}

#[test]
/// Vector: intelligence_heal_percentage.
fun intelligence_heal_percentage() {
  assert!(spell_formula::heal_amount(30, &stats(0, 55, 0, 0, 0)) == 46, 0);
}

#[test]
/// Vector: flat_heal_after_intelligence.
fun flat_heal_after_intelligence() {
  let mut caster = stats(0, 55, 0, 0, 0);
  spell::add_stat(&mut caster, 11, 4);
  assert!(spell_formula::heal_amount(30, &caster) == 50, 0);
}

#[test]
/// Vector: raw_damage_post_amplification_not_level_scaled.
fun raw_damage_post_amplification_not_level_scaled() {
  // The live chain formula has no caster-level input: flat 10 stays exactly 10 at every character level.
  assert!(spell_formula::amplify_damage(100, spell::el_fire(), &stats(0, 0, 0, 0, 10)) == 110, 0);
}

#[test]
/// Vector: critical_denominator_floor_two.
fun critical_denominator_floor_two() {
  // Shared vector input: seed=1, rate=3, bonus=2. Both runtimes draw odd modulo 2, so the capped roll misses.
  let (_, critical) = spell_formula::roll_crit(prng::rng_seed(1), 3, 2);
  assert!(!critical, 0);
  // effective=max(3-100, 2)=2, so the divisor is nonzero and the 50% boundary is exact.
  assert!(spell_formula::crit_at(4_999, 3, 100), 1);
  assert!(!spell_formula::crit_at(5_000, 3, 100), 2);
}

#[test]
/// Vector: resistance_caps_at_sixty (07-23 ruling — was fifty).
fun resistance_caps_at_sixty() {
  let target = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0);
  assert!(spell::apply_resistance(100, spell::el_fire(), &target) == 40, 0);
}
