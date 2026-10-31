// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_schedule_tests;

use aresrpg::{api, tournament, tournament_tests as fixture};
use sui::{clock, random, test_scenario};

#[test]
#[expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun qualified_event_cannot_expire() {
  let (mut s, mut t, _admin, version, mut clock) = fixture::setup(1, vector[10000,0,0,0,0]);
  test_scenario::return_shared(version);
  fixture::register(&mut t, 0, 1, &clock, &mut s);
  fixture::register(&mut t, 1, 1, &clock, &mut s);
  clock::increment_for_testing(&mut clock, 999_000);
  s.next_tx(@0xB);
  let version = s.take_shared<aresrpg::version::Version>();
  tournament::expire(&mut t, &version, &clock, s.ctx());
  abort 999
}

#[test]
#[expected_failure(abort_code = 3205, location = aresrpg::tournament)]
fun admin_cannot_start_early() {
  let (mut s, mut t, _admin, version, clock) = fixture::setup(1, vector[10000,0,0,0,0]);
  test_scenario::return_shared(version);
  fixture::register(&mut t, 0, 1, &clock, &mut s);
  fixture::register(&mut t, 1, 1, &clock, &mut s);
  s.next_tx(@0xA);
  let version = s.take_shared<aresrpg::version::Version>();
  let randomness = s.take_shared<random::Random>();
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  abort 999
}

fun public_start(delay: u64) {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(1, vector[10000,0,0,0,0]);
  test_scenario::return_shared(version);
  fixture::register(&mut t, 0, 1, &clock, &mut s);
  fixture::register(&mut t, 1, 1, &clock, &mut s);
  clock::increment_for_testing(&mut clock, 999_000 + delay);
  s.next_tx(@0xB);
  let version = s.take_shared<aresrpg::version::Version>();
  let randomness = s.take_shared<random::Random>();
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  let matches = tournament::matches_for_testing(&t);
  assert!(tournament::status_for_testing(&t) == b"in_progress".to_string(), 0);
  assert!(aresrpg_math::tournament_bracket::available_ms(&matches[0]) == clock.timestamp_ms(), 1);
  test_scenario::return_shared(randomness);
  fixture::cleanup(t, admin, version, clock, s);
}

#[test]
fun stranger_starts_at_deadline() { public_start(0); }
#[test]
fun delayed_crank_opens_a_fresh_admission_window() { public_start(600_000); }

#[test]
#[expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun cancelled_event_cannot_be_started() {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(1, vector[10000,0,0,0,0]);
  tournament::cancel(&mut t, &admin, &version, s.ctx());
  clock::increment_for_testing(&mut clock, 999_000);
  s.next_tx(@0xB);
  let randomness = s.take_shared<random::Random>();
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  abort 999
}
