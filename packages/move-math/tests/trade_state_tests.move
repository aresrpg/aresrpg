// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::trade_state_tests;

use aresrpg_math::trade_state;

const A: address = @0xA;
const B: address = @0xB;
const OUTSIDER: address = @0xC;

#[test]
fun both_acceptances_settle_one_revision() {
  let mut state = trade_state::state_for_testing(A, B, 1, 4);
  trade_state::accept(&mut state, 4, A);
  trade_state::accept(&mut state, 4, B);
  let (a, b) = trade_state::accepts(&state);
  assert!(trade_state::to_u8(trade_state::phase(&state)) == 2, 0);
  assert!(trade_state::offer_revision(&state) == 5 && a && b, 1);
}

#[test]
fun offer_touch_resets_acceptance_and_advances_revision() {
  let mut state = trade_state::state_for_testing(A, B, 1, 7);
  trade_state::accept(&mut state, 7, A);
  trade_state::touch(&mut state);
  let (a, b) = trade_state::accepts(&state);
  assert!(trade_state::offer_revision(&state) == 8 && !a && !b, 0);
}

#[test]
#[expected_failure(abort_code = 2603, location = aresrpg_math::trade_state)]
fun stale_edit_is_refused() {
  let state = trade_state::state_for_testing(A, B, 1, 2);
  trade_state::assert_editable(&state, 1, A);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2602, location = aresrpg_math::trade_state)]
fun acceptance_cannot_cross_cancellation() {
  let mut state = trade_state::state_for_testing(A, B, 1, 2);
  trade_state::cancel(&mut state, 2, A);
  trade_state::accept(&mut state, 2, B);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_edit_an_offer() {
  let state = trade_state::state_for_testing(A, B, 1, 2);
  trade_state::assert_editable(&state, 2, OUTSIDER);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_accept_an_offer() {
  let mut state = trade_state::state_for_testing(A, B, 1, 2);
  trade_state::accept(&mut state, 2, OUTSIDER);
  abort 999
}

#[test]
#[expected_failure(abort_code = 2601, location = aresrpg_math::trade_state)]
fun an_outsider_cannot_end_a_request() {
  let state = trade_state::state_for_testing(A, B, 0, 0);
  trade_state::assert_request_exit(&state, 0, OUTSIDER);
  abort 999
}
