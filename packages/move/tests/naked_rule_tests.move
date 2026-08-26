// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::naked_rule_tests;

use aresrpg::{character, naked_rule};

#[test]
fun a_bare_character_at_sale_level_qualifies() {
  let mut ctx = tx_context::dummy();
  let senshi = character::test_character(b"senshi".to_string(), 30, 0, &mut ctx);
  naked_rule::assert_sellable(&senshi);
  character::destroy(senshi);
}

#[test, expected_failure(abort_code = 823, location = aresrpg::naked_rule)]
fun a_character_below_sale_level_is_refused() {
  let mut ctx = tx_context::dummy();
  let senshi = character::test_character(b"senshi".to_string(), 29, 0, &mut ctx);
  naked_rule::assert_sellable(&senshi);
  character::destroy(senshi);
}
