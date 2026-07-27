// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Move-side executable twins of `packages/sim/test/vectors/sweep_golden.json`. The shipped permissionless
/// entry is intentionally placement-only: all three authenticated guards must pass before auto-abandon and
/// ordinary settlement can consume the fight. BRAND LAW: assertions use only AresRPG status/event vocabulary.
#[test_only]
module aresrpg_fight::sweep_tests;

use aresrpg_fight::{
  fight::{Self, Fight},
  fight_events,
  fight_scaffold::{combatant, create_fight, mk_clock, stand_up, tsregs_for},
  participant,
  settlement::{Self as results, FightOutcome},
  turns,
  version::Version,
};
use sui::{clock, event, test_scenario::{Self as ts}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const CHAR2: address = @0xC2;
const E_NOT_SWEEPABLE: u64 = 104;
const E_NOT_EXPIRED: u64 = 105;
const E_READY_SEAT: u64 = 106;

#[test, expected_failure(abort_code = E_NOT_EXPIRED, location = aresrpg_fight::settlement)]
fun placement_before_deadline_is_live() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let fight = sc.take_shared<Fight>();
  let version = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 120_999);
  results::sweep_fight(fight, &version, &clock, sc.ctx());
  abort 0
}

#[test, expected_failure(abort_code = E_READY_SEAT, location = aresrpg_fight::settlement)]
fun placement_expired_with_ready_seat_is_live() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  participant::set_ready(fight::participants_mut(&mut fight).borrow_mut(0), true);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 121_000);
  results::sweep_fight(fight, &version, &clock, sc.ctx());
  abort 0
}

#[test, expected_failure(abort_code = E_NOT_SWEEPABLE, location = aresrpg_fight::settlement)]
fun active_fight_is_never_placement_sweepable() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::set_status_active_for_testing(&mut fight);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 999_999_999);
  results::sweep_fight(fight, &version, &clock, sc.ctx());
  abort 0
}

#[test, expected_failure(abort_code = E_NOT_SWEEPABLE, location = aresrpg_fight::settlement)]
fun terminal_fight_is_not_sweepable() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  fight::set_status_active_for_testing(&mut fight);
  turns::finish_defeat_for_testing(&mut fight);
  let version = sc.take_shared<Version>();
  let clock = mk_clock(&mut sc, 999_999_999);
  results::sweep_fight(fight, &version, &clock, sc.ctx());
  abort 0
}

#[test]
fun placement_boundary_zero_ready_sweeps_every_seat() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let version = sc.take_shared<Version>();
  let creator_id = object::id_from_address(CHAR);
  let joiner_id = object::id_from_address(CHAR2);
  assert!(aresrpg_fight::fight_registry::shard_index(creator_id) != aresrpg_fight::fight_registry::shard_index(joiner_id));
  let (mut creator_latch, mut joiner_latch) = tsregs_for(&sc, creator_id, joiner_id);
  fight::join_latched_for_testing(
    &mut fight,
    &mut joiner_latch,
    combatant(CHAR2, 100),
    option::none(),
    &version,
    sc.ctx(),
  );
  let brand = std::type_name::with_defining_ids<fight::TestBrand>();
  assert!(creator_latch.character_fight(brand, creator_id).is_some());
  assert!(joiner_latch.character_fight(brand, joiner_id).is_some());

  let clock = mk_clock(&mut sc, 121_000);
  results::sweep_fight(fight, &version, &clock, sc.ctx());
  clock::destroy_for_testing(clock);
  assert!(creator_latch.character_fight(brand, creator_id).is_some());
  assert!(joiner_latch.character_fight(brand, joiner_id).is_some());
  assert!(event::events_by_type<fight_events::Abandoned>().length() == 2);
  assert!(event::events_by_type<fight_events::Defeat>().length() == 1);
  assert!(event::events_by_type<fight_events::Swept>().length() == 1);
  assert!(event::events_by_type<fight_events::ResultMinted>().length() == 2);
  assert!(event::events_by_type<fight_events::Settled>().length() == 1);
  ts::return_shared(creator_latch);
  ts::return_shared(joiner_latch);
  ts::return_shared(version);

  sc.next_tx(OWNER);
  assert!(!ts::has_most_recent_shared<Fight>());
  let first = sc.take_from_sender<FightOutcome>();
  let second = sc.take_from_sender<FightOutcome>();
  let (creator_outcome, joiner_outcome) = if (results::character(&first) == creator_id) (first, second) else (second, first);
  assert!(results::character(&creator_outcome) == creator_id);
  assert!(results::character(&joiner_outcome) == joiner_id);
  let (mut creator_latch, mut joiner_latch) = tsregs_for(&sc, creator_id, joiner_id);
  results::release_latch(&mut creator_latch, &creator_outcome);
  results::release_latch(&mut joiner_latch, &joiner_outcome);
  assert!(creator_latch.character_fight(brand, creator_id).is_none());
  assert!(joiner_latch.character_fight(brand, joiner_id).is_none());
  ts::return_shared(creator_latch);
  ts::return_shared(joiner_latch);
  assert!(results::outcome(&creator_outcome) == fight::status_defeat());
  assert!(results::outcome(&joiner_outcome) == fight::status_defeat());
  assert!(results::final_hp(&creator_outcome) == 0);
  assert!(results::final_hp(&joiner_outcome) == 0);
  std::unit_test::destroy(creator_outcome);
  std::unit_test::destroy(joiner_outcome);
  sc.end();
}
