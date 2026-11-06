// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::naked_rule_tests;

use aresrpg::{character, naked_rule};

#[test]
fun a_bare_level_30_character_qualifies() {
  let mut ctx = tx_context::dummy();
  let senshi = character::test_character(b"senshi".to_string(), 30, 0, &mut ctx);
  naked_rule::assert_sellable_for_testing(&senshi);
  character::destroy(senshi);
}

#[test]
fun a_bare_new_character_qualifies() {
  let mut ctx = tx_context::dummy();
  let senshi = character::test_character(b"senshi".to_string(), 1, 0, &mut ctx);
  naked_rule::assert_sellable_for_testing(&senshi);
  character::destroy(senshi);
}
