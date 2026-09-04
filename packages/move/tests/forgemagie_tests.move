// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::forgemagie_tests;

use aresrpg::{character, forgemagie};

#[test]
fun a_fresh_character_can_runeforge_every_gear_profession() {
  let mut ctx = tx_context::dummy();
  let character = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  let categories = vector[
    b"sword".to_string(), b"bow".to_string(), b"hat".to_string(),
    b"belt".to_string(), b"ring".to_string(), b"amulet".to_string(),
  ];
  let mut index = 0;
  while (index < categories.length()) {
    forgemagie::assert_scribe_job_for_testing(&character, categories[index]);
    index = index + 1;
  };
  character::destroy(character);
}

#[test]
fun stat_bearing_crafted_gear_is_crushable() {
  forgemagie::assert_crushable_for_testing(b"sword".to_string(), true);
}

#[test]
fun caller_coordinates_may_name_the_exact_owned_rune() {
  forgemagie::assert_rune_identity_for_testing(b"rune_agility_ba".to_string(), 5, 1);
}

#[test]
#[expected_failure(abort_code = 2711, location = aresrpg::forgemagie)]
fun caller_coordinates_cannot_relabel_a_rune() {
  forgemagie::assert_rune_identity_for_testing(b"rune_agility_ba".to_string(), 2, 3);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun a_pet_is_not_gear_and_cannot_be_crushed() {
  forgemagie::assert_crushable_for_testing(b"pet".to_string(), true);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2705, location = aresrpg::forgemagie)]
fun a_stackable_key_is_not_gear_even_if_bad_content_gave_it_stats() {
  forgemagie::assert_crushable_for_testing(b"key".to_string(), true);
  abort 999
}
