// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg::trade_tests;

use aresrpg::trade;
use sui::test_scenario;

const A: address = @0xA;
const B: address = @0xB;
const OUTSIDER: address = @0xC;

#[test]
fun invitee_joins_the_durable_request() {
  let mut scenario = test_scenario::begin(B);
  let mut row = trade::trade_for_testing(A, B, 0, 0, 0, 0, scenario.ctx());
  trade::join_for_testing(&mut row, 0, B);
  assert!(trade::state_for_testing(&row) == vector[1, 1, 0, 0], 0);
  trade::cancel_as_for_testing(&mut row, 1, B);
  trade::close_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
fun matching_acceptances_lock_one_exact_offer() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 1, 4, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 4, A);
  assert!(trade::state_for_testing(&row) == vector[1, 4, 1, 0], 0);
  trade::accept_as_for_testing(&mut row, 4, B);
  assert!(trade::state_for_testing(&row) == vector[2, 5, 1, 1], 1);
  trade::close_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
fun an_offer_edit_resets_both_acceptances_and_advances_revision() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 1, 8, 0, 0, scenario.ctx());
  trade::accept_as_for_testing(&mut row, 8, A);
  trade::touch_for_testing(&mut row, 8, A);
  assert!(trade::state_for_testing(&row) == vector[1, 9, 0, 0], 0);
  trade::cancel_as_for_testing(&mut row, 9, A);
  trade::close_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
fun cancellation_is_terminal_and_recoverable_after_disconnect() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 1, 3, 0, 0, scenario.ctx());
  trade::cancel_as_for_testing(&mut row, 3, A);
  assert!(trade::state_for_testing(&row) == vector[3, 4, 0, 0], 0);
  trade::close_for_testing(row, scenario.ctx());
  scenario.end();
}

#[test]
#[expected_failure(abort_code = 2603, location = aresrpg_math::trade_state)]
fun stale_offer_edit_aborts() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 1, 2, 0, 0, scenario.ctx());
  trade::touch_for_testing(&mut row, 1, A);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2602, location = aresrpg_math::trade_state)]
fun stale_accept_cannot_cross_cancellation() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 1, 2, 0, 0, scenario.ctx());
  trade::cancel_as_for_testing(&mut row, 2, A);
  trade::accept_as_for_testing(&mut row, 2, B);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2602, location = aresrpg_math::trade_state)]
fun stale_request_exit_cannot_cross_join() {
  let mut scenario = test_scenario::begin(B);
  let mut row = trade::trade_for_testing(A, B, 0, 0, 0, 0, scenario.ctx());
  trade::join_for_testing(&mut row, 0, B);
  trade::end_request_for_testing(row, 0, B, scenario.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 2608, location = aresrpg_math::trade_state)]
fun inviter_cannot_join_their_own_request() {
  let mut scenario = test_scenario::begin(A);
  let mut row = trade::trade_for_testing(A, B, 0, 0, 0, 0, scenario.ctx());
  trade::join_for_testing(&mut row, 0, A);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2611, location = aresrpg_math::trade_state)]
fun empty_sui_cannot_be_claimed_repeatedly() {
  let mut scenario = test_scenario::begin(A);
  let row = trade::trade_for_testing(A, B, 2, 4, 0, 0, scenario.ctx());
  trade::assert_claimable_sui_for_testing(&row, A);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2602, location = aresrpg_math::trade_state)]
fun negotiating_trade_cannot_use_terminal_close() {
  let mut scenario = test_scenario::begin(A);
  let row = trade::trade_for_testing(A, B, 1, 1, 0, 0, scenario.ctx());
  trade::close_for_testing(row, scenario.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_claim_terminal_sui() {
  let mut scenario = test_scenario::begin(A);
  let row = trade::trade_for_testing(A, B, 2, 4, 1, 1, scenario.ctx());
  trade::assert_claimable_sui_for_testing(&row, OUTSIDER);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_close_a_drained_trade() {
  let mut scenario = test_scenario::begin(OUTSIDER);
  let row = trade::trade_for_testing(A, B, 3, 4, 0, 0, scenario.ctx());
  trade::close_for_testing(row, scenario.ctx());
  abort 999
}
