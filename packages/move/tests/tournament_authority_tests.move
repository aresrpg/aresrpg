// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::tournament_authority_tests;
use aresrpg::{api, character, tournament, tournament_tests::{Self as fixture}, version};
use aresrpg_seed::item_rows;
use sui::{clock, coin, random, sui::SUI, test_scenario};

public enum Failure has copy, drop {
  Format, Name, Deadline, BpsLength, BpsTotal, BpsLarge, RewardsLarge,
  RewardPlace, RewardAmount, RewardUnique, DuplicateSeat, OtherTeam, Restricted, StaleTeam,
  ForeignLeave, ExpireEarly, ClaimEarly, CancelTwice, StartEmpty, StartIncomplete, CrankOpen,
  LateDonation, LateRegistration, LongName, TeamName, TeamAllowed, RewardLarge, ClosedDonation, MissingLeave,
}

fun refusal(which: Failure) {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(3, vector[10_000, 0, 0, 0, 0]);
  let c = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  let second = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  let template = item_rows::template_for_testing(b"prize".to_string(), b"hat".to_string(), s.ctx());
  if (which == Failure::RewardLarge) { let _ = tournament::reward(&template, 1, 11); abort 999 };
  if (which == Failure::TeamName) { tournament::create_team(&mut t, b"".to_string(), vector[], &c, &clock, s.ctx()); abort 999 };
  if (which == Failure::TeamAllowed) { tournament::create_team(&mut t, b"A".to_string(), vector[object::id(&c),object::id(&c),object::id(&c),object::id(&c)], &c, &clock, s.ctx()); abort 999 };
  if (which == Failure::ClosedDonation) {
    tournament::cancel(&mut t, &admin, &version, s.ctx());
    tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(1, s.ctx()), &version, &clock); abort 999
  };
  if (which == Failure::RewardPlace) { let _ = tournament::reward(&template, 0, 1); abort 999 };
  if (which == Failure::RewardAmount) { let _ = tournament::reward(&template, 1, 0); abort 999 };
  if (which == Failure::RewardUnique) { let _ = tournament::reward(&template, 1, 2); abort 999 };
  if (which == Failure::ExpireEarly) { tournament::expire(&mut t, &version, &clock, s.ctx()); abort 999 };
  if (which == Failure::ClaimEarly) { tournament::claim_sui(&mut t, 0, 0, &version, s.ctx()); abort 999 };
  if (which == Failure::CrankOpen) { tournament::crank_unopened(&mut t, 0, &version, &clock, s.ctx()); abort 999 };
  if (which == Failure::CancelTwice) {
    tournament::cancel(&mut t, &admin, &version, s.ctx());
    tournament::cancel(&mut t, &admin, &version, s.ctx()); abort 999
  };
  if (which == Failure::StartEmpty) {
    let mut entropy = random::new_generator_from_seed_for_testing(b"start");
    clock::increment_for_testing(&mut clock, 999_000);
    tournament::start(&mut t, &mut entropy, &clock); abort 999
  };
  let mut rewards = vector[];
  if (which == Failure::RewardsLarge) {
    let mut i = 0u64;
    while (i < 11) { rewards.push_back(tournament::reward(&template, 1, 1)); i = i + 1; };
  };
  if (which == Failure::Format || which == Failure::Name || which == Failure::LongName || which == Failure::Deadline || which == Failure::BpsLength
    || which == Failure::BpsTotal || which == Failure::BpsLarge || which == Failure::RewardsLarge) {
    tournament::create(&admin, if (which == Failure::Name) b"".to_string() else if (which == Failure::LongName) b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string() else b"Cup".to_string(),
      if (which == Failure::Format) 2 else 1, if (which == Failure::Deadline) 0 else 100_000,
      if (which == Failure::BpsLength) vector[] else if (which == Failure::BpsTotal) vector[0,0,0,0,0]
        else if (which == Failure::BpsLarge) vector[10_001,0,0,0,0] else vector[10_000,0,0,0,0],
      vector[10_000,0,0,0,0], rewards, &version, &clock, s.ctx()); abort 999
  };
  tournament::create_team(&mut t, b"A".to_string(), vector[object::id(&c)], &c, &clock, s.ctx());
  if (which == Failure::MissingLeave) { tournament::leave_team(&mut t, 0, object::id(&second), &version, &clock, s.ctx()); abort 999 };
  if (which == Failure::DuplicateSeat) { tournament::join_team(&mut t, 0, 0, &c, &clock, s.ctx()); abort 999 };
  if (which == Failure::OtherTeam) { tournament::create_team(&mut t, b"B".to_string(), vector[], &second, &clock, s.ctx()); abort 999 };
  if (which == Failure::Restricted) { tournament::join_team(&mut t, 0, 0, &second, &clock, s.ctx()); abort 999 };
  if (which == Failure::ForeignLeave) { s.next_tx(@0xB); tournament::leave_team(&mut t, 0, object::id(&c), &version, &clock, s.ctx()); abort 999 };
  if (which == Failure::StaleTeam) {
    tournament::leave_team(&mut t, 0, object::id(&c), &version, &clock, s.ctx());
    tournament::create_team(&mut t, b"New".to_string(), vector[], &c, &clock, s.ctx());
    tournament::join_team(&mut t, 0, 0, &second, &clock, s.ctx()); abort 999
  };
  if (which == Failure::StartIncomplete) {
    let mut entropy = random::new_generator_from_seed_for_testing(b"start");
    clock::increment_for_testing(&mut clock, 999_000);
    tournament::start(&mut t, &mut entropy, &clock); abort 999
  };
  clock::increment_for_testing(&mut clock, 1_000_000);
  if (which == Failure::LateDonation) tournament::donate_sui(&mut t, coin::mint_for_testing<SUI>(1, s.ctx()), &version, &clock);
  if (which == Failure::LateRegistration) tournament::join_team(&mut t, 0, 0, &second, &clock, s.ctx());
  abort 999
}

#[test]
fun leave_reuses_empty_slots_without_reserving_strangers() {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(3, vector[10_000,0,0,0,0]);
  let c = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  let second = character::test_character(b"senshi".to_string(), 1, 0, s.ctx());
  tournament::create_team(&mut t, b"Old".to_string(), vector[], &c, &clock, s.ctx());
  tournament::join_team(&mut t, 0, 0, &second, &clock, s.ctx());
  tournament::leave_team(&mut t, 0, object::id(&second), &version, &clock, s.ctx());
  tournament::leave_team(&mut t, 0, object::id(&c), &version, &clock, s.ctx());
  tournament::create_team(&mut t, b"New".to_string(), vector[], &c, &clock, s.ctx());
  tournament::join_team(&mut t, 0, 1, &second, &clock, s.ctx());
  clock::increment_for_testing(&mut clock, 1_000_000);
  s.next_tx(@0xB);
  tournament::expire(&mut t, &version, &clock, s.ctx());
  assert!(tournament::status_for_testing(&t) == b"cancelled".to_string(), 0);
  character::destroy(c); character::destroy(second);
  fixture::cleanup(t, admin, version, clock, s);
}

#[test]
fun maximum_roster_starts_with_bounded_work() {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(6, vector[10_000,0,0,0,0]);
  test_scenario::return_shared(version);
  let mut team = 0;
  while (team < 64) { fixture::register(&mut t, team, 6, &clock, &mut s); team = team + 1; };
  s.next_tx(@0xA);
  let version = s.take_shared<version::Version>();
  let randomness = s.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 999_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  assert!(tournament::matches_for_testing(&t).length() == 64, 0);
  test_scenario::return_shared(randomness);
  fixture::cleanup(t, admin, version, clock, s);
}

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_format() { refusal(Failure::Format); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_name() { refusal(Failure::Name); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_deadline() { refusal(Failure::Deadline); }

#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun refuses_bps_length() { refusal(Failure::BpsLength); }

#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun refuses_bps_total() { refusal(Failure::BpsTotal); }

#[test, expected_failure(abort_code = 3303, location = aresrpg_math::tournament_bracket)]
fun refuses_bps_large() { refusal(Failure::BpsLarge); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_rewards_large() { refusal(Failure::RewardsLarge); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_reward_place() { refusal(Failure::RewardPlace); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_reward_amount() { refusal(Failure::RewardAmount); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_reward_unique() { refusal(Failure::RewardUnique); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_duplicate_seat() { refusal(Failure::DuplicateSeat); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_other_team() { refusal(Failure::OtherTeam); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_restricted() { refusal(Failure::Restricted); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_stale_team() { refusal(Failure::StaleTeam); }

#[test, expected_failure(abort_code = 3203, location = aresrpg::tournament)]
fun refuses_foreign_leave() { refusal(Failure::ForeignLeave); }

#[test, expected_failure(abort_code = 3205, location = aresrpg::tournament)]
fun refuses_expire_early() { refusal(Failure::ExpireEarly); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_claim_early() { refusal(Failure::ClaimEarly); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_cancel_twice() { refusal(Failure::CancelTwice); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_start_empty() { refusal(Failure::StartEmpty); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_start_incomplete() { refusal(Failure::StartIncomplete); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_crank_open() { refusal(Failure::CrankOpen); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_late_donation() { refusal(Failure::LateDonation); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_late_registration() { refusal(Failure::LateRegistration); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_long_name() { refusal(Failure::LongName); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_team_name() { refusal(Failure::TeamName); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_team_allowed() { refusal(Failure::TeamAllowed); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun refuses_reward_large() { refusal(Failure::RewardLarge); }

#[test, expected_failure(abort_code = 3202, location = aresrpg::tournament)]
fun refuses_closed_donation() { refusal(Failure::ClosedDonation); }

#[test, expected_failure(vector_error, minor_status = 1, location = aresrpg::tournament)]
fun unregistered_character_cannot_remove_a_seat() { refusal(Failure::MissingLeave); }

#[test, expected_failure(abort_code = 3201, location = aresrpg::tournament)]
fun team_capacity_is_a_real_bound() {
  let (mut s, mut t, _admin, version, clock) = fixture::setup(1, vector[10_000,0,0,0,0]);
  test_scenario::return_shared(version);
  let mut team = 0;
  while (team < 64) { fixture::register(&mut t, team, 1, &clock, &mut s); team = team + 1; };
  fixture::register(&mut t, 64, 1, &clock, &mut s);
  abort 999
}

#[test]
fun bronze_prizes_require_four_teams_and_unresolved_rounds_stay_pending() {
  let (mut s, mut t, admin, version, mut clock) = fixture::setup(1, vector[9000,0,1000,0,0]);
  test_scenario::return_shared(version);
  let mut team = 0;
  while (team < 4) { fixture::register(&mut t, team, 1, &clock, &mut s); team = team + 1; };
  s.next_tx(@0xA);
  let version = s.take_shared<version::Version>();
  let randomness = s.take_shared<random::Random>();
  clock::increment_for_testing(&mut clock, 999_000);
  api::start_tournament(&mut t, &randomness, &version, &clock, s.ctx());
  assert!(aresrpg_math::tournament_bracket::state(&tournament::matches_for_testing(&t)[0]) == 0, 0);
  test_scenario::return_shared(randomness);
  fixture::cleanup(t, admin, version, clock, s);
}
