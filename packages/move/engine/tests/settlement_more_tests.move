// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Coverage for `settlement`'s zero-covered `FightOutcome` getters (brand, fight_id, team, winner_team, world) — the
/// existing settlement tests in fight_tests.move only assert outcome/character/final_hp/xp_share.
#[test_only]
module aresrpg_fight::settlement_more_tests;

use aresrpg_fight::{
  actions,
  fight::{Self, Fight},
  mob,
  participant,
  settlement::{Self as results, FightOutcome},
  turns,
  version::Version,
};
use aresrpg_fight::fight_scaffold::{create_fight, mk_clock, stand_up};
use sui::{clock, test_scenario::{Self as ts, Scenario}};

const OWNER: address = @0xA;
const CHAR: address = @0xC0;
const WORLD: address = @0x704D;

#[test]
fun outcome_getters_cover_brand_fight_world_team_winner() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  create_fight(&mut sc, 50, 1, 0, 1000, true, option::none());
  sc.next_tx(OWNER);
  let mut fight = sc.take_shared<Fight>();
  let ver = sc.take_shared<Version>();
  win_the_fight(&mut sc, &mut fight, &ver);
  let fid_before = fight::id(&fight);
  results::settle_and_destroy(fight, &ver, sc.ctx());
  ts::return_shared(ver);

  sc.next_tx(OWNER);
  let result = sc.take_from_sender<FightOutcome>();
  assert!(results::team(&result) == 0);
  assert!(results::winner_team(&result) == option::some(0));
  assert!(results::world(&result) == object::id_from_address(WORLD));
  assert!(results::fight_id(&result) == fid_before);
  assert!(results::brand(&result) == std::type_name::with_defining_ids<fight::TestBrand>());
  sc.return_to_sender(result);
  sc.end();
}

/// Place the creator, force it adjacent to the mob, and weapon-strike once — mirrors fight_tests.move's private
/// `win_the_fight`: the low-hp mob dies -> VICTORY.
fun win_the_fight(sc: &mut Scenario, fight: &mut Fight, ver: &Version) {
  let cell0 = participant::cell(fight::participants(fight).borrow(0));
  let clock = mk_clock(sc, 1000);
  turns::place_for_testing(fight, object::id_from_address(CHAR), cell0, ver, &clock, OWNER);
  clock::destroy_for_testing(clock);
  participant::set_cell(fight::participants_mut(fight).borrow_mut(0), 100);
  mob::set_cell(fight::mobs_mut(fight).borrow_mut(0), 101);
  actions::weapon_for_testing(fight, object::id_from_address(CHAR), 101, ver, 1000, OWNER);
}
