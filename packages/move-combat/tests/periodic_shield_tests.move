// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_combat::periodic_shield_tests;

use aresrpg_combat::{combat, periodic_effect_tests};
use aresrpg_math::spell_effect;

fun cast(state: &mut combat::State, effects: vector<spell_effect::Effect>) {
  let spell = spell_effect::new_spell_level(1, 0, 0, false, false, false, false, 0, 0, 0, 0, effects, vector[]);
  combat::cast(state, 0, &spell, b"Effect".to_string(), 100, 1);
}

fun poison(state: &mut combat::State) {
  cast(state, vector[
    spell_effect::new_effect(5, b"earth".to_string(), 26, 26, 0, 0, 4, 10000, 5, 12),
    spell_effect::new_effect(5, b"fire".to_string(), 17, 17, 0, 0, 4, 10000, 3, 12),
  ]);
}

#[test]
fun sylvan_power_blocks_poison_until_protection_expires() {
  let mut state = periodic_effect_tests::active();
  poison(&mut state);
  cast(&mut state, vector[
    spell_effect::new_effect(20, b"".to_string(), 100, 100, 0, 0, 4, 10000, 3, 6),
    spell_effect::new_effect(20, b"".to_string(), 100, 100, 0, 0, 4, 10000, 3, 7),
    spell_effect::new_effect(14, b"".to_string(), 1000, 1000, 0, 0, 4, 10000, 3, 0),
    spell_effect::new_effect(4, b"".to_string(), 16, 16, 0, 0, 4, 10000, 3, 12),
  ]);
  periodic_effect_tests::next_round(&mut state, 0);
  assert!(combat::fighter_hp(&state, 0) == 116, 0);
  periodic_effect_tests::next_round(&mut state, 1);
  assert!(combat::fighter_hp(&state, 0) == 132, 1);
  periodic_effect_tests::next_round(&mut state, 2);
  assert!(combat::fighter_hp(&state, 0) == 132 - 26 - 17 + 16, 2);
  combat::destroy(state);
}

#[test]
fun periodic_damage_respects_only_matching_and_universal_shields() {
  vector[false, true].do!(|shield_first| {
    let mut state = periodic_effect_tests::active();
    if (!shield_first) poison(&mut state);
    cast(&mut state, vector[
      spell_effect::new_effect(14, b"earth".to_string(), 20, 20, 0, 0, 4, 10000, 2, 0),
      spell_effect::new_effect(14, b"water".to_string(), 1000, 1000, 0, 0, 4, 10000, 2, 0),
      spell_effect::new_effect(14, b"".to_string(), 3, 3, 0, 0, 4, 10000, 2, 0),
    ]);
    if (shield_first) poison(&mut state);
    periodic_effect_tests::next_round(&mut state, 0);
    assert!(combat::fighter_hp(&state, 0) == 100 - 3 - 14, 0);
    combat::destroy(state);
  });
}
