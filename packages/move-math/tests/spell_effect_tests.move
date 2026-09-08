// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::spell_effect_tests;

use aresrpg_math::spell_effect;

const EBadTurns: u64 = 1409;
const EBadLevel: u64 = 1407;
const ETooManyRows: u64 = 1410;
const EBadAreaSize: u64 = 1411;

fun row(kind: u8, filter: u8, stat: u8, turns: u8): spell_effect::Effect {
  spell_effect::new_effect(kind,
    if (kind <= 3 || ((kind == 5 || kind == 6) && stat == 12)) b"earth".to_string() else b"".to_string(),
    2, 5, spell_effect::shape_point(), 0, filter, 10_000, turns, stat)
}

fun level(base: vector<spell_effect::Effect>, critical: vector<spell_effect::Effect>): spell_effect::SpellLevel {
  spell_effect::new_spell_level(3, 0, 5, true, true, false, false, 2, 1, 3, 20, base, critical)
}

#[test]
fun displacement_order_and_zone_split_preserve_every_payload_once() {
  let damage = row(0, 1, 0, 0);
  let push = row(8, 1, 0, 0);
  let pull = row(9, 1, 0, 0);
  let teleport = row(10, 4, 0, 0);
  let swap = row(11, 2, 0, 0);
  let trap = row(12, 1, 0, 0);
  let glyph = row(13, 1, 0, 2);
  let original = vector[push, trap, damage, pull, glyph, teleport, swap];
  let ordered = spell_effect::displacement_last(&original);
  assert!(ordered == vector[trap, damage, glyph, push, pull, teleport, swap], 1);
  assert!(spell_effect::has_displacement(&original), 2);
  assert!(!spell_effect::has_displacement(&vector[damage, trap, glyph]), 3);
  assert!(!spell_effect::has_displacement(&vector[]), 4);
  let (placements, payload) = spell_effect::split_placements(&ordered);
  assert!(placements == vector[trap, glyph], 5);
  assert!(payload == vector[damage, push, pull, teleport, swap], 6);
  let expanded = damage.with_area(spell_effect::shape_circle(), 3);
  assert!(expanded.area_shape() == 1 && expanded.area_size() == 3, 7);
  assert!(expanded.with_area(damage.area_shape(), damage.area_size()) == damage, 8);
}

#[test]
fun target_filters_distinguish_self_ally_and_enemy() {
  let expected = vector[vector[true, true, true], vector[false, false, true],
    vector[false, true, true], vector[true, true, false], vector[true, false, false]];
  let mut filter = 0u8;
  while (filter < 5) {
    assert!(spell_effect::target_allowed(filter, 0, 0, true) == expected[filter as u64][0], 1);
    assert!(spell_effect::target_allowed(filter, 0, 0, false) == expected[filter as u64][1], 2);
    assert!(spell_effect::target_allowed(filter, 0, 1, false) == expected[filter as u64][2], 3);
    filter = filter + 1;
  };
}

#[test]
fun ai_intent_considers_normal_and_critical_branches() {
  let heal = row(4, 3, 12, 0);
  let self_buff = row(4, 4, 0, 1);
  let enemy = row(0, 1, 0, 0);
  let supportive = level(vector[self_buff, heal], vector[self_buff]);
  assert!(supportive.has_heal() && supportive.aims_only_at_allies(), 1);
  assert!(!supportive.aims_only_at_caster(), 2);
  let self_only = level(vector[self_buff], vector[self_buff]);
  assert!(self_only.aims_only_at_caster() && !self_only.has_heal(), 3);
  let mixed_critical = level(vector[heal], vector[enemy]);
  assert!(!mixed_critical.aims_only_at_allies() && !mixed_critical.aims_only_at_caster(), 4);
  let mixed_base = level(vector[enemy], vector[heal]);
  assert!(!mixed_base.aims_only_at_allies() && !mixed_base.has_heal(), 5);
  let empty = level(vector[], vector[]);
  assert!(!empty.aims_only_at_allies() && !empty.aims_only_at_caster() && !empty.has_heal(), 6);
  assert!(level(vector[], vector[self_buff]).aims_only_at_caster(), 7);
  assert!(!level(vector[self_buff], vector[heal]).aims_only_at_caster(), 8);
}

#[test]
fun direct_damage_excludes_tolls_dots_and_non_hp_steals() {
  let harmless = vector[row(2, 4, 0, 0), row(5, 1, 12, 1), row(6, 1, 6, 0), row(6, 1, 12, 1)];
  assert!(!spell_effect::has_direct_damage(&harmless), 1);
  assert!(!spell_effect::has_direct_damage(&vector[]), 2);
  let damage = vector[row(0, 1, 0, 0), row(1, 1, 0, 0), row(3, 1, 0, 0), row(6, 1, 12, 0)];
  let mut index = 0;
  while (index < damage.length()) {
    let mut rows = harmless;
    rows.push_back(damage[index]);
    assert!(spell_effect::has_direct_damage(&rows), 3);
    index = index + 1;
  };
}

#[test]
fun chatiment_and_fixed_removal_accept_their_supported_channels() {
  let stats = vector[0u8, 1, 2, 3, 4, 5, 8, 9, 10];
  let mut index = 0;
  while (index < stats.length()) {
    let stance = row(7, 4, stats[index], spell_effect::chatiment_turns());
    assert!(stance.turns() == 5 && stance.stat() == stats[index], 1);
    index = index + 1;
  };
  assert!(row(20, 1, 6, 0).stat() == 6, 2);
  assert!(row(20, 1, 7, 1).turns() == 1, 3);
}

#[test, expected_failure(abort_code = 1401, location = aresrpg_math::spell_effect)]
fun unknown_kind_is_refused() { row(21, 1, 0, 0); }

#[test, expected_failure(abort_code = 1402, location = aresrpg_math::spell_effect)]
fun unknown_shape_is_refused() { spell_effect::new_effect(0, b"earth".to_string(), 1, 2, 10, 0, 1, 10_000, 0, 0); }

#[test, expected_failure(abort_code = 1403, location = aresrpg_math::spell_effect)]
fun unknown_filter_is_refused() { row(0, 5, 0, 0); }

#[test, expected_failure(abort_code = 1404, location = aresrpg_math::spell_effect)]
fun unknown_element_is_refused() { spell_effect::new_effect(0, b"ice".to_string(), 1, 2, 0, 0, 1, 10_000, 0, 0); }

#[test, expected_failure(abort_code = 1405, location = aresrpg_math::spell_effect)]
fun inverted_values_are_refused() { spell_effect::new_effect(0, b"earth".to_string(), 2, 1, 0, 0, 1, 10_000, 0, 0); }

#[test, expected_failure(abort_code = 1406, location = aresrpg_math::spell_effect)]
fun chance_above_one_hundred_percent_is_refused() { spell_effect::new_effect(0, b"earth".to_string(), 1, 2, 0, 0, 1, 10_001, 0, 0); }

#[test, expected_failure(abort_code = 1408, location = aresrpg_math::spell_effect)]
fun unknown_numeric_channel_is_refused() { row(4, 3, 13, 0); }

#[test, expected_failure(abort_code = 1408, location = aresrpg_math::spell_effect)]
fun hp_removal_requires_damage_or_a_duration() { row(5, 1, 12, 0); }

#[test, expected_failure(abort_code = 1404, location = aresrpg_math::spell_effect)]
fun heal_cannot_carry_an_element() { spell_effect::new_effect(4, b"fire".to_string(), 1, 2, 0, 0, 3, 10_000, 0, 12); }

#[test, expected_failure(abort_code = 1404, location = aresrpg_math::spell_effect)]
fun life_steal_requires_an_element() { spell_effect::new_effect(6, b"".to_string(), 1, 2, 0, 0, 1, 10_000, 0, 12); }

#[test, expected_failure(abort_code = 1408, location = aresrpg_math::spell_effect)]
fun chatiment_cannot_grant_action_points() { row(7, 4, 6, 5); }

#[test, expected_failure(abort_code = 1408, location = aresrpg_math::spell_effect)]
fun fixed_removal_cannot_target_hp() { row(20, 1, 12, 0); }

#[test, expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun timed_glyph_requires_a_duration() { row(13, 1, 0, 0); }

#[test, expected_failure(abort_code = EBadLevel, location = aresrpg_math::spell_effect)]
fun inverted_cast_range_is_refused() { spell_effect::new_spell_level(1, 2, 1, false, false, false, false, 0, 0, 0, 0, vector[], vector[]); }

#[test, expected_failure(abort_code = EBadLevel, location = aresrpg_math::spell_effect)]
fun guaranteed_critical_is_refused() { spell_effect::new_spell_level(1, 0, 1, false, false, false, false, 0, 0, 0, 1, vector[], vector[]); }

fun effect(kind: u8, turns: u8) {
  spell_effect::new_effect(
    kind,
    if (kind <= 3) b"earth".to_string() else b"".to_string(),
    1,
    1,
    spell_effect::shape_point(),
    0,
    if (kind == 10) 4 else 1,
    10_000,
    turns,
    0,
  );
}

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun percentage_damage_rejects_duration() { effect(1, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun teleport_rejects_duration() { effect(10, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun dispel_rejects_duration() { effect(16, 1) }

#[test]
#[expected_failure(abort_code = EBadTurns, location = aresrpg_math::spell_effect)]
fun chatiment_rejects_a_non_retro_duration() { effect(7, 4) }

#[test]
#[expected_failure(abort_code = EBadAreaSize, location = aresrpg_math::spell_effect)]
fun an_effect_rejects_an_area_larger_than_the_authored_board_envelope() {
  spell_effect::new_effect(0, b"earth".to_string(), 1, 1, spell_effect::shape_circle(), 11, 1, 10_000, 0, 0);
}

#[test]
#[expected_failure(abort_code = EBadLevel, location = aresrpg_math::spell_effect)]
fun a_spell_rejects_zero_ap() {
  spell_effect::new_spell_level(0, 0, 1, false, false, false, false, 0, 0, 0, 0, vector[], vector[]);
}

#[test]
#[expected_failure(abort_code = ETooManyRows, location = aresrpg_math::spell_effect)]
fun a_spell_rejects_more_than_eight_effect_rows() {
  let row = spell_effect::new_effect(0, b"earth".to_string(), 1, 1, spell_effect::shape_point(), 0, 1, 10_000, 0, 0);
  spell_effect::new_spell_level(
    1, 0, 1, false, false, false, false, 0, 0, 0, 0,
    vector[row, row, row, row, row, row, row, row, row],
    vector[],
  );
}
