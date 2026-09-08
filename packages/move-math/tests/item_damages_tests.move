// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::item_damages_tests;

use aresrpg_math::item_damages;

#[test]
fun weapon_lines_preserve_their_authored_interval_type_and_element() {
  let elements = vector[b"earth", b"fire", b"water", b"air"];
  let mut index = 0;
  while (index < elements.length()) {
    let element = elements[index].to_string();
    let line = item_damages::new(0, 65_535, b"life_steal".to_string(), element);
    assert!(item_damages::from(&line) == 0 && item_damages::to(&line) == 65_535, 1);
    assert!(item_damages::element(&line) == element, 2);
    assert!(item_damages::damage_type(&line) == b"life_steal".to_string(), 3);
    index = index + 1;
  };
}

#[test, expected_failure(abort_code = 901, location = aresrpg_math::item_damages)]
fun inverted_weapon_interval_is_rejected() {
  let _ = item_damages::new(10, 9, b"damage".to_string(), b"earth".to_string());
}

#[test, expected_failure(abort_code = 902, location = aresrpg_math::item_damages)]
fun unknown_weapon_element_is_rejected() {
  let _ = item_damages::new(1, 1, b"damage".to_string(), b"unknown".to_string());
}
