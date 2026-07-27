// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CHECKPOINT tests: the proof-of-time travel math as PROPERTY tests (§5, §17.2/.3) — teleport rejected, honest
/// walk accepted, the ×1.5 mount allowance that requires the pet at BOTH ends, clock-regression refusal, the
/// teach-don't-reject `wait_seconds`, and the 500k-coordinate OVERFLOW probe (a huge distance must return a
/// verdict, never abort on arithmetic). Speed budget pinned to 1000 (×100 → 10 blocks/s) for clean numbers:
/// in 1000 ms the budget is exactly 10 blocks.
#[test_only]
module aresrpg::checkpoint_tests;

use aresrpg::{admin::{Self, AdminCap}, version::{Self, Version}, world::{Self, World}};
use std::unit_test::assert_eq;
use sui::test_scenario::{Self as ts, Scenario};

const OWNER: address = @0xA;

// ── mirrored error values ──
const ECheckpointFuture: u64 = 101; // checkpoint
const ETravelTooFar: u64 = 102; // checkpoint

/// A world with speed_budget = 1000 (×100 fixed-point → 10 blocks/s), taken shared and ready.
fun world_at_speed_1000(sc: &mut Scenario): World {
  version::test_init(sc.ctx());
  admin::test_init(sc.ctx());
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  world::create_world(&cap, &ver, 1, b"b".to_string(), sc.ctx());
  sc.next_tx(OWNER);
  let mut w = sc.take_shared<World>();
  world::set_speed_budget(&cap, &mut w, 1000, &ver, sc.ctx());
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  w
}

// ╔════════════════ [ Honest walk vs teleport ] ══════════════════════════════ ]

#[test]
fun honest_walk_accepted_teleport_rejected() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 1000, false); // at origin, t=1000ms, no pet
  // elapsed 1000 ms → budget 10 blocks. (10,0) is exactly reachable; (11,0) is one block too far.
  assert!(world::travel_ok(&w, &cp, 10, 0, 2000, false)); // honest walk to the budget edge
  assert!(!world::travel_ok(&w, &cp, 11, 0, 2000, false)); // one block past = teleport, rejected
  assert!(!world::travel_ok(&w, &cp, 5000, 5000, 2000, false)); // gross teleport, rejected
  ts::return_shared(w);
  sc.end();
}

// ╔════════════════ [ Mount ×1.5 requires the pet at BOTH ends ] ══════════════ ]

#[test]
fun pet_mount_needs_both_ends() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 1000, true); // pet WAS equipped at the checkpoint
  // (11,0): 11 blocks. no-pet budget 10 → rejected; pet budget 15 → accepted. (16,0) exceeds even the pet budget.
  assert!(!world::travel_ok(&w, &cp, 11, 0, 2000, false)); // pet only at the START end → no ×1.5
  assert!(world::travel_ok(&w, &cp, 11, 0, 2000, true)); // pet at BOTH ends → ×1.5 covers it
  assert!(!world::travel_ok(&w, &cp, 16, 0, 2000, true)); // beyond even the mounted budget
  ts::return_shared(w);
  sc.end();
}

// ╔════════════════ [ verify_travel abort forms ] ════════════════════════════ ]

#[test, expected_failure(abort_code = ETravelTooFar, location = world)]
fun verify_travel_too_far_aborts() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 1000, false);
  world::verify_travel(&w, &cp, 11, 0, 2000, false); // ETravelTooFar
  abort
}

#[test, expected_failure(abort_code = ECheckpointFuture, location = world)]
fun verify_travel_clock_regression_aborts() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 1000, false);
  world::verify_travel(&w, &cp, 0, 0, 500, false); // now(500) < cp.time(1000) → ECheckpointFuture
  abort
}

// ╔════════════════ [ wait_seconds (teach, don't reject) ] ═══════════════════ ]

#[test]
fun wait_seconds_counts_down() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 1000, false);
  // (100,0): needs 100 blocks / 10 bps = 10 s; 1 s elapsed → wait 9 s. And the move is (correctly) rejected now.
  assert_eq!(world::wait_seconds(&w, &cp, 100, 0, 2000, false), 9);
  assert!(!world::travel_ok(&w, &cp, 100, 0, 2000, false));
  // a reachable target needs no wait
  assert_eq!(world::wait_seconds(&w, &cp, 5, 0, 2000, false), 0);
  ts::return_shared(w);
  sc.end();
}

// ╔════════════════ [ 500k overflow probe — a verdict, never an abort ] ══════ ]

#[test]
fun overflow_probe_at_500k_coords() {
  let mut sc = ts::begin(OWNER);
  let w = world_at_speed_1000(&mut sc);
  let cp = world::new_checkpoint(0, 0, 0, false);
  // huge distance, tiny elapsed → rejected, but the squared math must NOT overflow/abort (it returns false)
  assert!(!world::travel_ok(&w, &cp, 499_999, 499_999, 1000, false));
  // huge distance, huge elapsed → budget saturates and ACCEPTS, still no overflow
  assert!(world::travel_ok(&w, &cp, 499_999, 499_999, 1_000_000_000_000, false));
  ts::return_shared(w);
  sc.end();
}
