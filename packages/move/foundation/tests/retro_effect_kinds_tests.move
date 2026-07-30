// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// WAVE 12 FOUNDATION GOLDEN TESTS — executable Move twin of
/// `packages/sim/test/vectors/missing_effect_stats_golden.json`.
///
/// Locks the append-only effect vocabulary, the three new combat-stat ids and mutators, the physical-only
/// damage lane, and deterministic 1-in-N cast failure. BRAND LAW: reference spell/effect names remain corpus
/// data; these executable contracts use generic, internal mechanic names only.
#[test_only]
module aresrpg_foundation::retro_effect_kinds_tests;

use aresrpg_foundation::{spell, spell_effect as effect, spell_formula as formula};

fun legal_wave_12_effect(kind: u8): effect::Effect {
  effect::new_effect(
    kind,
    spell::el_none(),
    1,
    effect::shape_point(),
    0,
    effect::tf_none(),
    100,
    1,
    effect::stat_strength(),
    0,
    effect::phase_on_enter(),
  )
}

fun assert_kind_is_legal(kind: u8, expected: u8, abort_code: u64) {
  assert!(kind == expected, abort_code);
  let candidate = legal_wave_12_effect(kind);
  assert!(effect::is_legal(&candidate), abort_code + 100);
}

#[test]
fun t_wave_12_kinds_are_append_only_and_structurally_legal() {
  assert_kind_is_legal(effect::k_critical_failure(), 31, 31);
  assert_kind_is_legal(effect::k_damage_to_heal(), 32, 32);
  assert_kind_is_legal(effect::k_forced_death(), 33, 33);
  assert_kind_is_legal(effect::k_timed_payload(), 34, 34);
  assert_kind_is_legal(effect::k_named_damage_stack(), 35, 35);
  assert_kind_is_legal(effect::k_stance(), 36, 36);
  assert_kind_is_legal(effect::k_reactive_punishment(), 37, 37);
  assert_kind_is_legal(effect::k_erosion(), 38, 38);
  assert_kind_is_legal(effect::k_damage_redirect(), 39, 39);
  assert_kind_is_legal(effect::k_pool_shield(), 40, 40);
}

#[test]
fun t_wave_12_stat_ids_and_mutators_update_then_saturate() {
  assert!(effect::stat_ap_dodge() == 12, 0);
  assert!(effect::stat_mp_dodge() == 13, 1);
  assert!(effect::stat_physical_damage() == 14, 2);

  let mut stats = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  spell::add_stat(&mut stats, effect::stat_ap_dodge(), 7);
  spell::add_stat(&mut stats, effect::stat_mp_dodge(), 9);
  spell::add_stat(&mut stats, effect::stat_physical_damage(), 11);
  assert!(spell::stat_ap_dodge(&stats) == 7, 3);
  assert!(spell::stat_mp_dodge(&stats) == 9, 4);
  assert!(spell::stat_physical_damage(&stats) == 11, 5);

  spell::sub_stat(&mut stats, effect::stat_ap_dodge(), 2);
  spell::sub_stat(&mut stats, effect::stat_mp_dodge(), 4);
  spell::sub_stat(&mut stats, effect::stat_physical_damage(), 1);
  assert!(spell::stat_ap_dodge(&stats) == 5, 6);
  assert!(spell::stat_mp_dodge(&stats) == 5, 7);
  assert!(spell::stat_physical_damage(&stats) == 10, 8);

  spell::sub_stat(&mut stats, effect::stat_ap_dodge(), 99);
  spell::sub_stat(&mut stats, effect::stat_mp_dodge(), 99);
  spell::sub_stat(&mut stats, effect::stat_physical_damage(), 99);
  assert!(spell::stat_ap_dodge(&stats) == 0, 9);
  assert!(spell::stat_mp_dodge(&stats) == 0, 10);
  assert!(spell::stat_physical_damage(&stats) == 0, 11);
}

#[test]
fun t_physical_bonus_only_amplifies_earth_and_neutral_lines() {
  let mut stats = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  spell::add_stat(&mut stats, effect::stat_physical_damage(), 7);

  assert!(formula::amplify_damage(20, spell::el_earth(), &stats) == 27, 0);
  assert!(formula::amplify_damage(20, spell::el_none(), &stats) == 27, 1);
  assert!(formula::amplify_damage(20, spell::el_fire(), &stats) == 20, 2);
  assert!(formula::amplify_damage(20, spell::el_water(), &stats) == 20, 3);
  assert!(formula::amplify_damage(20, spell::el_air(), &stats) == 20, 4);
}

#[test]
fun t_critical_failure_denominator_and_slot_determinism() {
  assert!(!formula::critical_failure_at(0, 0, 0), 0);
  assert!(!formula::critical_failure_at(987654321, 42, 0), 1);
  assert!(formula::critical_failure_at(0, 0, 1), 2);
  assert!(formula::critical_failure_at(987654321, 42, 1), 3);

  let first = formula::critical_failure_at(123456789, 7, 17);
  let repeated = formula::critical_failure_at(123456789, 7, 17);
  assert!(first == repeated, 4);
}

#[test]
fun t_critical_failure_roll_exposes_the_exact_committed_draw() {
  let seed = 123456789;
  let slot = 7;
  let denominator = 17;
  let roll = formula::critical_failure_roll(seed, slot, denominator);
  assert!(roll < denominator, 0);
  assert!(roll == formula::critical_failure_roll(seed, slot, denominator), 1);
  assert!(formula::critical_failure_at(seed, slot, denominator) == (roll == 0), 2);
  assert!(formula::critical_failure_roll(seed, slot, 0) == 0, 3);
}
