// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg_math::aresrpg_tests;

#[test]
fun transaction_prelude_needs_no_inputs_and_emits_no_game_fact() {
  let events = sui::event::num_events();
  aresrpg_math::aresrpg::prelude_for_testing();
  assert!(sui::event::num_events() == events);
}
