// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// KOLIZEUM abuse tests — the money-attack sad paths beyond the core suite (`kolizeum_tests`, whose harness this
/// file reuses via its public helpers). Two families:
///   • REFUND ABUSE — a pledger cannot drain the pot by exiting twice (double-refund), and no refund path (exit
///     OR creator-cancel) survives past START (once STARTED the pledge is a committed stake, §17.9);
///   • SETTLE GUARDS — the pot pays out EQUALLY per head (never pro-rata by pledge), exactly ONCE, only to a
///     valid side of a STARTED lobby: a 3-winner uneven split (remainder to the first winner by join order),
///     plus invalid-side / before-start / double-settle aborts (no illegitimate or duplicate payout, §17.9).
#[test_only]
module aresrpg_kolizeum::kolizeum_abuse_tests;

use aresrpg_kolizeum::kolizeum::{Self, Kolizeum};
use aresrpg::version::Version;
use aresrpg_kolizeum::kolizeum_tests::{stand_up, create_public, join_ok, join_lvl, do_exit, assert_received, assert_treasury_got};
use std::unit_test::assert_eq;
use sui::test_scenario as ts;

const OWNER: address = @0xA;
const CREATOR: address = @0xC0;
const P1: address = @0xC1;
const P2: address = @0xC2;
const P3: address = @0xC3;
const P4: address = @0xC4;

const LVL: u64 = 20; // matches the shared harness's in-gate level
const PLEDGE: u64 = 1_000; // matches the shared harness's per-seat pledge (join_ok pays this)

// ── mirrored error values (`location = kolizeum`) ──
const ENotOpen: u64 = 105;
const ENotParticipant: u64 = 110;
const ENotStarted: u64 = 112;
const EBadSide: u64 = 113;

// ╔════════════════ [ Refund abuse — double-refund + refund-after-start ] ═════ ]

#[test, expected_failure(abort_code = ENotParticipant, location = kolizeum)]
fun double_exit_refund_aborts() {
  // A pledger cannot drain the pot by exiting twice: the first exit removes the seat, the second finds none.
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);
  join_ok(&mut sc, P2); // pot = 3 × PLEDGE
  do_exit(&mut sc, P1); // first exit: refunded PLEDGE, seat removed
  do_exit(&mut sc, P1); // second exit: no seat → ENotParticipant (no double-refund)
  abort
}

#[test, expected_failure(abort_code = ENotOpen, location = kolizeum)]
fun exit_after_start_aborts() {
  // Once STARTED the pot is committed — no refund escape hatch (the pledge is now a live stake).
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k); // OPEN → STARTED
  ts::return_shared(k);

  do_exit(&mut sc, P1); // STARTED → not OPEN → ENotOpen
  abort
}

#[test, expected_failure(abort_code = ENotOpen, location = kolizeum)]
fun cancel_after_start_aborts() {
  // The creator cannot cancel-refund out of a running fight (clawing the pot back to dodge a loss).
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 3, PLEDGE, 100, PLEDGE);
  join_ok(&mut sc, P1);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k);
  ts::return_shared(k);

  sc.next_tx(CREATOR);
  let mut k = sc.take_shared<Kolizeum>();
  let ver = sc.take_shared<Version>();
  kolizeum::cancel(&mut k, &ver, sc.ctx()); // STARTED → not OPEN → ENotOpen
  abort
}

// ╔════════════════ [ Settle — EQUAL split (never pro-rata), 3 winners ] ══════ ]

#[test]
fun settle_three_winners_split_equally_remainder_to_first() {
  // §17.9: after the 10% platform cut to @treasury, the 90% NET passes to the winning side split EQUALLY per head —
  // NEVER weighted by pledge — with the integer remainder riding the FIRST winner by join order.
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  // 5 seats, pledge 5 → pot 25. Auto-balance: A=[creator(0),P2(2),P4(4)], B=[P1(1),P3(3)]. Side A (3) wins.
  create_public(&mut sc, CREATOR, 3, 5, 100, 5);
  join_lvl(&mut sc, P1, LVL, 5); // → B
  join_lvl(&mut sc, P2, LVL, 5); // → A
  join_lvl(&mut sc, P3, LVL, 5); // → B
  join_lvl(&mut sc, P4, LVL, 5); // → A

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  assert_eq!(kolizeum::side_a_size(&k), 3);
  assert_eq!(kolizeum::pot_value(&k), 25);
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // side A (3 winners) wins
  assert_eq!(kolizeum::status(&k), kolizeum::status_settled());
  assert_eq!(kolizeum::pot_value(&k), 0); // pot fully drained
  ts::return_shared(k);

  // pot 25 → fee floor(25×10%)=2 → @treasury; winners split the 23 net. 23 / 3 = 7 each, remainder 2 → the FIRST
  // winner by join order (CREATOR, join_order 0) gets 9. Equal, not pro-rata; the two losers (P1, P3) receive
  // NOTHING (proven by the pot draining to exactly zero above). 9 + 7 + 7 + 2 cut == 25 — money conserved.
  assert_received(&mut sc, CREATOR, 9);
  assert_received(&mut sc, P2, 7);
  assert_received(&mut sc, P4, 7);
  assert_treasury_got(&mut sc, 2);
  sc.end();
}

// ╔════════════════ [ Settle — illegitimate / duplicate payout guards ] ═══════ ]

#[test, expected_failure(abort_code = EBadSide, location = kolizeum)]
fun settle_invalid_side_aborts() {
  // A "winning side" that is neither A nor B cannot extract the pot.
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, 5, sc.ctx()); // side 5 ∉ {0,1} → EBadSide
  abort
}

#[test, expected_failure(abort_code = ENotStarted, location = kolizeum)]
fun settle_before_start_aborts() {
  // The pot cannot be paid out while the lobby is still OPEN (no fight has run).
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE); // OPEN, never started

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // OPEN → ENotStarted
  abort
}

#[test, expected_failure(abort_code = ENotStarted, location = kolizeum)]
fun double_settle_aborts() {
  // The pot pays out exactly ONCE: the first settle flips STARTED → SETTLED, the second finds no STARTED.
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_public(&mut sc, CREATOR, 1, PLEDGE, 100, PLEDGE);

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::start_for_testing(&mut k);
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // pays the creator (net of cut), status → SETTLED
  ts::return_shared(k);
  assert_received(&mut sc, CREATOR, PLEDGE - kolizeum::platform_cut_of(PLEDGE)); // creator NETS 90% (10% → @treasury)

  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kolizeum>();
  kolizeum::settle_for_testing(&mut k, kolizeum::side_a(), sc.ctx()); // SETTLED → ENotStarted (no second payout)
  abort
}
