// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::forgemagie_tests;

use aresrpg::{character, forgemagie, progression};

const LEVEL_70_XP: u64 = 156_481;

#[test]
fun a_level_70_tailor_can_runeforge_a_hat() {
  let mut ctx = tx_context::dummy();
  let mut tailor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  progression::bank_job_xp(&mut tailor, b"TAILOR".to_string(), LEVEL_70_XP);
  forgemagie::assert_scribe_job_for_testing(&tailor, b"hat".to_string());
  character::destroy(tailor);
}

#[test]
fun a_level_70_jeweler_can_runeforge_rings_and_amulets() {
  let mut ctx = tx_context::dummy();
  let mut jeweler = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  progression::bank_job_xp(&mut jeweler, b"JEWELER".to_string(), LEVEL_70_XP);
  forgemagie::assert_scribe_job_for_testing(&jeweler, b"ring".to_string());
  forgemagie::assert_scribe_job_for_testing(&jeweler, b"amulet".to_string());
  character::destroy(jeweler);
}

#[test]
#[expected_failure(abort_code = 2701, location = aresrpg::forgemagie)]
fun a_level_70_tailor_cannot_runeforge_a_tanner_belt() {
  let mut ctx = tx_context::dummy();
  let mut tailor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  progression::bank_job_xp(&mut tailor, b"TAILOR".to_string(), LEVEL_70_XP);
  forgemagie::assert_scribe_job_for_testing(&tailor, b"belt".to_string());
  character::destroy(tailor);
}

#[test]
#[expected_failure(abort_code = 2701, location = aresrpg::forgemagie)]
fun a_level_70_tailor_cannot_runeforge_a_jeweler_ring() {
  let mut ctx = tx_context::dummy();
  let mut tailor = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  progression::bank_job_xp(&mut tailor, b"TAILOR".to_string(), LEVEL_70_XP);
  forgemagie::assert_scribe_job_for_testing(&tailor, b"ring".to_string());
  character::destroy(tailor);
}

#[test]
fun stat_bearing_crafted_gear_is_crushable() {
  forgemagie::assert_crushable_for_testing(b"sword".to_string(), true);
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
