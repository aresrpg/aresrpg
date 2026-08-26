// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::character_stat_tests;

use aresrpg::character;

#[test]
fun allocation_prices_before_mutation_and_reset_refunds_level_capital() {
  let mut ctx = tx_context::dummy();
  let mut senshi = character::test_character(b"senshi".to_string(), 10, 45, &mut ctx);
  character::raise_stat(&mut senshi, b"intelligence".to_string(), 22);
  assert!(senshi.intelligence() == 21);
  assert!(senshi.available_points() == 23);
  character::reset_stats(&mut senshi);
  assert!(senshi.intelligence() == 0);
  assert!(senshi.available_points() == 45);
  character::destroy(senshi);

  let mut ikari = character::test_character(b"ikari".to_string(), 2, 5, &mut ctx);
  character::raise_stat(&mut ikari, b"vitality".to_string(), 3);
  assert!(ikari.vitality() == 6);
  assert!(ikari.available_points() == 2);
  character::destroy(ikari);
}

#[test, expected_failure(abort_code = 109, location = aresrpg::character)]
fun a_batch_that_crosses_a_cost_boundary_must_afford_the_whole_quote() {
  let mut ctx = tx_context::dummy();
  let mut senshi = character::test_character(b"senshi".to_string(), 10, 21, &mut ctx);
  character::raise_stat(&mut senshi, b"intelligence".to_string(), 21);
  character::destroy(senshi);
}
