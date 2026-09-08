// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::consumable_effect_tests;

use aresrpg_math::consumable_effect as effect;

#[test]
fun authored_consumables_resolve_to_exactly_their_intended_action() {
  let effects = vector[
    effect::heal(4_294_967_295), effect::reset_stats(), effect::reset_spells(),
    effect::recall(), effect::city(b"thebes".to_string()), effect::loot_box(),
  ];
  let mut index = 0;
  while (index < effects.length()) {
    let current = &effects[index];
    assert!(effect::heal_amount(current) == if (index == 0) option::some(4_294_967_295) else option::none(), 1);
    assert!(effect::is_reset_stats(current) == (index == 1), 2);
    assert!(effect::is_reset_spells(current) == (index == 2), 3);
    assert!(effect::is_recall(current) == (index == 3), 4);
    assert!(effect::city_name(current) == if (index == 4) option::some(b"thebes".to_string()) else option::none(), 5);
    assert!(effect::is_loot_box(current) == (index == 5), 6);
    index = index + 1;
  };
}

#[test, expected_failure(abort_code = 1901, location = aresrpg_math::consumable_effect)]
fun zero_healing_cannot_be_authored_as_a_consumable() { let _ = effect::heal(0); }

#[test, expected_failure(abort_code = 1902, location = aresrpg_math::consumable_effect)]
fun city_consumable_must_name_its_destination() { let _ = effect::city(b"".to_string()); }
