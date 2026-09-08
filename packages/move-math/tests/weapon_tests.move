// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::weapon_tests;

use aresrpg_math::{item_damages, weapon};

#[test]
fun class_affinity_is_specific_to_the_designed_family() {
  let classes = vector[b"senshi", b"yajin", b"ikari", b"mori", b"tokei", b"shugo", b"yogan", b"rojin", b"shusen", b"tomoda", b"asobi", b"iyashi"];
  let families = vector[b"sword", b"daggers", b"axe", b"spear", b"axe", b"spear", b"bow", b"daggers", b"axe", b"spear", b"sword", b"bow"];
  let mut i = 0;
  while (i < classes.length()) {
    let mut j = 0;
    while (j < families.length()) {
      assert!(weapon::affinity_of(&classes[i].to_string(), &families[j].to_string()) == (families[i] == families[j]), 0);
      j = j + 1;
    };
    i = i + 1;
  };
  assert!(!weapon::affinity_of(&b"unknown".to_string(), &b"sword".to_string()), 1);
}

#[test]
fun each_weapon_family_assembles_its_cast_contract_and_multiple_damage_lines() {
  let families = vector[b"daggers", b"spear", b"bow", b"axe", b"sword", b"unknown"];
  let ap = vector<u8>[3, 4, 4, 5, 5, 4];
  let crit = vector<u16>[30, 70, 60, 55, 50, 100];
  let shape = vector<u8>[0, 4, 0, 8, 0, 0];
  let size = vector<u8>[0, 1, 0, 1, 0, 0];
  let lines = vector[
    item_damages::new(10, 20, b"damage".to_string(), b"earth".to_string()),
    item_damages::new(4, 8, b"damage".to_string(), b"fire".to_string()),
  ];
  let mut i = 0;
  while (i < families.length()) {
    let strike = weapon::strike_of(&families[i].to_string(), &lines, false);
    assert!(strike.ap_cost() == ap[i] && strike.crit_1_in() == crit[i], 0);
    assert!(strike.range_min() == (if (i == 2) 2 else 1), 1);
    assert!(strike.range_max() == (if (i == 2) 6 else 1), 2);
    assert!(strike.modifiable_range() == (i == 2), 3);
    assert!(strike.line_of_sight() && !strike.line_launch() && !strike.free_cell(), 4);
    assert!(strike.casts_per_turn() == 0 && strike.casts_per_target() == 0 && strike.cooldown_turns() == 0, 5);
    let effects = strike.effects();
    let critical = strike.crit_effects();
    assert!(effects.length() == 2 && critical.length() == 2, 6);
    assert!(effects[0].value() == 10 && effects[0].value_max() == 20, 7);
    assert!(effects[1].element() == b"fire".to_string() && effects[1].value() == 4, 8);
    assert!(critical[0].value() == 15 && critical[0].value_max() == 30, 9);
    assert!(critical[1].value() == 6 && critical[1].value_max() == 12, 10);
    assert!(effects[0].area_shape() == shape[i] && effects[0].area_size() == size[i], 11);
    assert!(effects[0].kind() == 0 && effects[0].chance_bp() == 10_000 && effects[0].turns() == 0, 12);
    i = i + 1;
  };
  let affinity = weapon::strike_of(&b"sword".to_string(), &lines, true);
  assert!(affinity.effects()[0].value() == 11 && affinity.effects()[0].value_max() == 22, 13);
  assert!(affinity.crit_effects()[0].value() == 16 && affinity.crit_effects()[0].value_max() == 33, 14);
}

#[test]
fun lineless_items_use_unarmed_values_without_affinity() {
  let strike = weapon::strike_of(&b"bow".to_string(), &vector[], true);
  let unarmed = weapon::unarmed();
  assert!(strike == unarmed, 0);
  assert!(strike.ap_cost() == 4 && strike.range_max() == 1 && strike.crit_1_in() == 100, 1);
  assert!(strike.effects()[0].value() == 4 && strike.crit_effects()[0].value() == 6, 2);
}
