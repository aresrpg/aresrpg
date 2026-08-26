// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::trade_tests;

use aresrpg::trade;
use sui::test_scenario;

const A: address = @0xA;
const B: address = @0xB;

#[test]
fun every_mutation_resets_both_acceptances() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 0, A);
  assert!(trade::state_for_testing(&row) == vector[0, 1, 0, 0], 0);
  trade::touch_for_testing(&mut row);
  assert!(trade::state_for_testing(&row) == vector[1, 0, 0, 0], 1);
  trade::destroy_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
fun matching_acceptances_lock_the_trade() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 0, A);
  trade::accept_as_for_testing(&mut row, 0, B);
  assert!(trade::state_for_testing(&row) == vector[0, 1, 1, 1], 0);
  trade::destroy_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 2606, location = aresrpg::trade)]
fun stale_acceptance_aborts() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 1, A);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg::trade)]
fun strangers_cannot_accept() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 0, @0xC);
  abort 999
}

#[test]
#[expected_failure]
fun leftover_sui_prevents_destruction() {
  let mut scenario = test_scenario::begin(A);
  let row = trade::trade_for_testing(A, B, 1, 0, scenario.ctx());
  trade::destroy_for_testing(row, scenario.ctx());
  abort 999
}
