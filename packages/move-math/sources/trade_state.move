// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure p2p trade lifecycle. The game package owns escrow and transfers; this smaller package
/// owns roles, phases, revision-pinned offer transitions, and bounded-manifest validation.
module aresrpg_math::trade_state;

const ENotAParty: u64 = 2601;
const EWrongPhase: u64 = 2602;
const EStaleOffer: u64 = 2603;
const EPricedCap: u64 = 2604;
const ECapNotFound: u64 = 2605;
const ENotDrained: u64 = 2606;
const ECapLimit: u64 = 2607;
const ENotInvitee: u64 = 2608;
const EAlreadyAccepted: u64 = 2610;
const EEmptyBalance: u64 = 2611;
const ESelfTrade: u64 = 2612;
const MAX_CAPS_PER_SIDE: u64 = 20;

public enum TradePhase has copy, drop, store { Requested, Negotiating, Settling, Cancelled }
public struct TradeState has copy, drop, store {
  a: address, b: address, phase: TradePhase, offer_revision: u64, accept_a: bool, accept_b: bool,
}

public fun new(a: address, b: address): TradeState {
  assert!(a != b, ESelfTrade);
  TradeState { a, b, phase: TradePhase::Requested, offer_revision: 0, accept_a: false, accept_b: false }
}
public fun a(state: &TradeState): address { state.a }
public fun b(state: &TradeState): address { state.b }
public fun phase(state: &TradeState): TradePhase { state.phase }
public fun offer_revision(state: &TradeState): u64 { state.offer_revision }
public fun accepts(state: &TradeState): (bool, bool) { (state.accept_a, state.accept_b) }
public fun requested(): TradePhase { TradePhase::Requested }
public fun negotiating(): TradePhase { TradePhase::Negotiating }
public fun settling(): TradePhase { TradePhase::Settling }
public fun cancelled(): TradePhase { TradePhase::Cancelled }

public fun join(state: &mut TradeState, seen: u64, sender: address) {
  assert_phase(state, TradePhase::Requested);
  assert!(sender == state.b, ENotInvitee);
  assert_revision(state, seen);
  state.phase = TradePhase::Negotiating;
  touch(state);
}
public fun assert_request_exit(state: &TradeState, seen: u64, sender: address) {
  assert_phase(state, TradePhase::Requested);
  assert_party(state, sender);
  assert_revision(state, seen);
}
public fun cancel(state: &mut TradeState, seen: u64, sender: address) {
  assert_editable(state, seen, sender);
  state.phase = TradePhase::Cancelled;
  state.offer_revision = state.offer_revision + 1;
  state.accept_a = false;
  state.accept_b = false;
}
public fun accept(state: &mut TradeState, seen: u64, sender: address) {
  assert_phase(state, TradePhase::Negotiating);
  assert_revision(state, seen);
  assert_party(state, sender);
  let side_a = is_a(state, sender);
  assert!(!(if (side_a) state.accept_a else state.accept_b), EAlreadyAccepted);
  state.accept_a = state.accept_a || side_a;
  state.accept_b = state.accept_b || !side_a;
  if (state.accept_a && state.accept_b) {
    state.phase = TradePhase::Settling;
    state.offer_revision = state.offer_revision + 1;
  };
}
public fun assert_editable(state: &TradeState, seen: u64, sender: address) {
  assert_phase(state, TradePhase::Negotiating);
  assert_revision(state, seen);
  assert_party(state, sender);
}
public fun touch(state: &mut TradeState) {
  state.offer_revision = state.offer_revision + 1;
  state.accept_a = false;
  state.accept_b = false;
}
public fun assert_party(state: &TradeState, sender: address) {
  assert!(sender == state.a || sender == state.b, ENotAParty);
}
public fun is_a(state: &TradeState, sender: address): bool { sender == state.a }
public fun assert_phase(state: &TradeState, expected: TradePhase) { assert!(state.phase == expected, EWrongPhase); }
public fun assert_terminal(state: &TradeState) {
  assert!(state.phase == TradePhase::Settling || state.phase == TradePhase::Cancelled, EWrongPhase);
}
public fun assert_revision(state: &TradeState, seen: u64) { assert!(state.offer_revision == seen, EStaleOffer); }
public fun assert_positive(amount: u64) { assert!(amount > 0, EEmptyBalance); }
public fun assert_zero_price(price: u64) { assert!(price == 0, EPricedCap); }
public fun assert_cap_room(length: u64) { assert!(length < MAX_CAPS_PER_SIDE, ECapLimit); }
public fun assert_drained(caps_a: u64, caps_b: u64) { assert!(caps_a == 0 && caps_b == 0, ENotDrained); }
public fun item_index(manifest: &vector<ID>, item: ID): u64 {
  let (found, index) = manifest.index_of(&item);
  assert!(found, ECapNotFound);
  index
}

#[test_only]
public fun state_for_testing(a: address, b: address, phase: u8, revision: u64): TradeState {
  TradeState { a, b, phase: phase_from_u8(phase), offer_revision: revision, accept_a: false, accept_b: false }
}
#[test_only]
public fun to_u8(phase: TradePhase): u64 {
  match (phase) { TradePhase::Requested => 0, TradePhase::Negotiating => 1,
    TradePhase::Settling => 2, TradePhase::Cancelled => 3 }
}
#[test_only]
fun phase_from_u8(phase: u8): TradePhase {
  if (phase == 0) TradePhase::Requested else if (phase == 1) TradePhase::Negotiating
  else if (phase == 2) TradePhase::Settling else TradePhase::Cancelled
}
