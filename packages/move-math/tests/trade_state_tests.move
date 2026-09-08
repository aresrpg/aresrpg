// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

#[test_only]
module aresrpg_math::trade_state_tests;

use aresrpg_math::trade_state;

const A: address = @0xA;
const B: address = @0xB;
const OUTSIDER: address = @0xC;

#[test]
fun request_join_edit_and_cancel_keep_roles_and_revisions() {
  let mut state = trade_state::new(A, B);
  assert!(trade_state::phase(&state) == trade_state::requested(), 0);
  trade_state::assert_request_exit(&state, 0, A);
  trade_state::assert_request_exit(&state, 0, B);
  trade_state::join(&mut state, 0, B);
  assert!(trade_state::phase(&state) == trade_state::negotiating(), 1);
  assert!(trade_state::offer_revision(&state) == 1, 2);
  trade_state::accept(&mut state, 1, B);
  trade_state::touch(&mut state);
  let (a, b) = trade_state::accepts(&state);
  assert!(!a && !b, 3);
  trade_state::cancel(&mut state, 2, A);
  trade_state::assert_terminal(&state);
  assert!(trade_state::phase(&state) == trade_state::cancelled(), 4);
  assert!(trade_state::offer_revision(&state) == 3, 5);
  let (a, b) = trade_state::accepts(&state);
  assert!(!a && !b, 6);
}

#[test]
fun settlement_requires_both_parties_and_drained_escrow() {
  let mut state = trade_state::new(A, B);
  trade_state::join(&mut state, 0, B);
  trade_state::accept(&mut state, 1, B);
  trade_state::accept(&mut state, 1, A);
  trade_state::assert_terminal(&state);
  assert!(trade_state::phase(&state) == trade_state::settling(), 1);
  trade_state::assert_positive(1);
  trade_state::assert_zero_price(0);
  trade_state::assert_cap_room(19);
  let first = sui::object::id_from_address(@0x10);
  let second = sui::object::id_from_address(@0x20);
  assert!(trade_state::item_index(&vector[first, second], second) == 1, 2);
  trade_state::assert_drained(0, 0);
}

#[test, expected_failure(abort_code = 2612, location = aresrpg_math::trade_state)]
fun self_trade_is_refused() { let _ = trade_state::new(A, A); }

#[test, expected_failure(abort_code = 2608, location = aresrpg_math::trade_state)]
fun initiator_cannot_accept_own_invitation() {
  let mut state = trade_state::new(A, B);
  trade_state::join(&mut state, 0, A);
}

#[test, expected_failure(abort_code = 2610, location = aresrpg_math::trade_state)]
fun repeated_acceptance_cannot_settle_alone() {
  let mut state = trade_state::new(A, B);
  trade_state::join(&mut state, 0, B);
  trade_state::accept(&mut state, 1, A);
  trade_state::accept(&mut state, 1, A);
}

#[test, expected_failure(abort_code = 2603, location = aresrpg_math::trade_state)]
fun editing_invalidates_the_other_partys_signed_acceptance() {
  let mut state = trade_state::new(A, B);
  trade_state::join(&mut state, 0, B);
  trade_state::accept(&mut state, 1, A);
  trade_state::touch(&mut state);
  trade_state::accept(&mut state, 1, B);
}

#[test, expected_failure(abort_code = 2602, location = aresrpg_math::trade_state)]
fun negotiating_is_not_terminal() {
  let mut state = trade_state::new(A, B);
  trade_state::join(&mut state, 0, B);
  trade_state::assert_terminal(&state);
}

#[test, expected_failure(abort_code = 2604, location = aresrpg_math::trade_state)]
fun priced_cap_cannot_enter_free_exchange() { trade_state::assert_zero_price(1); }

#[test, expected_failure(abort_code = 2605, location = aresrpg_math::trade_state)]
fun missing_manifest_item_is_refused() {
  trade_state::item_index(&vector[], sui::object::id_from_address(@0x10));
}

#[test, expected_failure(abort_code = 2606, location = aresrpg_math::trade_state)]
fun initiator_escrow_must_be_drained() { trade_state::assert_drained(1, 0); }

#[test, expected_failure(abort_code = 2606, location = aresrpg_math::trade_state)]
fun invitee_escrow_must_be_drained() { trade_state::assert_drained(0, 1); }

#[test, expected_failure(abort_code = 2607, location = aresrpg_math::trade_state)]
fun twenty_caps_fill_one_side() { trade_state::assert_cap_room(20); }

#[test, expected_failure(abort_code = 2611, location = aresrpg_math::trade_state)]
fun zero_balance_cannot_change_an_offer() { trade_state::assert_positive(0); }

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
