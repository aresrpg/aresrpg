// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::fight_coverage_tests;
use aresrpg::{api, version, character, equipment, fight, friends::FriendRegistry, item, party, protected_policy, world};
use aresrpg_combat::combat;
use aresrpg_control::admin;
use aresrpg_kares::{kares, offering, combat_rewards};
use aresrpg_math::{combat_grid, item_damages, spell_effect};
use aresrpg_seed::{board_catalog, item_rows, registry, spell_rows, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

public enum Case has copy, drop {
  Cast, ApiStart, ApiReadyPartial, ApiCrank, AtomicLast, BatchSuccess, WrongClass, Unlearned, Weapon, Move, WrongActor, ForeignSender, MissingActor, MissingReady, MissingRef,
  JoinBadTeam, JoinBadAccess, JoinFull, JoinHistoryFull, JoinStarted, JoinRepeated, JoinForeignWorld,
  GroupJoin, GroupPublic, GroupMissingOpener, GroupMissingJoiner, GroupEmpty, GroupSideB,
  ManagedClose, ManagedStart, ManagedSettle, ManagedJoin, ManagedForfeit, NotManaged, ChallengeAccess, KolizeumAccess,
  ReadyFinal, SealTwice, BatchEmpty, BatchLengths, BatchShortPlan, BatchLeftover, BatchDuplicate,
}

public struct Fixture {
  scenario: test_scenario::Scenario,
  version: version::Version,
  randomness: random::Random,
  fight: fight::Fight,
  kiosk: kiosk::Kiosk,
  personal: personal_kiosk::PersonalKioskCap,
  protected: protected_policy::AresRPG_TransferPolicy<character::Character>,
  character_policy: transfer_policy::TransferPolicy<character::Character>,
  character_policy_cap: transfer_policy::TransferPolicyCap<character::Character>,
  item_policy: transfer_policy::TransferPolicy<item::Item>,
  item_policy_cap: transfer_policy::TransferPolicyCap<item::Item>,
  clock: clock::Clock,
  spell: spell_rows::SpellTemplate,
  catalog: board_catalog::BoardCatalog,
  content: world_content::WorldContent,
  party: party::Party,
  friends: FriendRegistry,
  ids: vector<ID>,
}

fun board(): combat_grid::GridSpec {
  combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[100, 101, 102, 103, 104, 105], vector[106, 107, 108, 109, 110, 111])
}

fun managed(case: Case): bool {
  case == Case::ManagedClose || case == Case::ManagedStart || case == Case::ManagedSettle
    || case == Case::ManagedJoin || case == Case::ManagedForfeit
}

fun fixture(case: Case): Fixture {
  let mut scenario = test_scenario::begin(@0x0);
  random::create_for_testing(scenario.ctx());
  scenario.next_tx(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  let (character_policy, character_policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  publisher.burn();
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(&cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  let other_content = world_content::create(&cap, &mut root, b"incarnam".to_string(), 1, scenario.ctx());
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&cap, &mut root, &mut catalog, board(), scenario.ctx());
  let level = spell_effect::new_spell_level(1, 0, 40, false, false, false, false, 0, 0, 0, 0,
    vector[spell_effect::new_effect(0, b"earth".to_string(), 1000, 1000, 0, 0, 1, 10000, 0, 0)], vector[]);
  spell_rows::add_spell(&cap, &mut root, b"coverage_strike".to_string(),
    if (case == Case::WrongClass) b"shugo".to_string() else b"senshi".to_string(),
    if (case == Case::Unlearned) 2 else 1, vector::tabulate!(6, |_| level), scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  clock::set_for_testing(&mut clock, 1);
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let kiosk_cap = personal_kiosk::borrow(&personal);
  let mut ids = vector[];
  let mut index = 0u64;
  while (index < 8) {
    let mut character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    world::join_world(&mut character, if (case == Case::JoinForeignWorld && index == 2) &other_content else &content, &clock);
    if (index == 0 && case == Case::Weapon) {
      let mut template = item_rows::template_for_testing(b"coverage_sword".to_string(), b"sword".to_string(), scenario.ctx());
      item_rows::set_damages(&cap, &mut root, &mut template,
        vector[item_damages::new(1000, 1000, b"damage".to_string(), b"earth".to_string())], scenario.ctx());
      let mut entropy = random::new_generator_from_seed_for_testing(b"weapon");
      equipment::equip(&mut character, b"weapon".to_string(), item::mint(&template, 1, &mut entropy, scenario.ctx()));
      item_rows::destroy_for_testing(template);
    };
    ids.push_back(object::id(&character));
    kiosk.place(kiosk_cap, character);
    index = index + 1;
  };
  let mut friends = party::registry_for_testing(scenario.ctx());
  let mut party = party::inviting_for_testing(&mut friends, kiosk.borrow<character::Character>(kiosk_cap, ids[if (case == Case::GroupSideB) 1 else 0]), ids[2], scenario.ctx());
  party::accept(&mut friends, &mut party, ids[2]);
  let access = if (case == Case::ChallengeAccess) 2 else if (case == Case::GroupJoin || case == Case::GroupMissingOpener || case == Case::GroupMissingJoiner) 1 else 0;
  let randomness = scenario.take_shared<random::Random>();
  let version = scenario.take_shared<version::Version>();
  if (case == Case::KolizeumAccess) {
    let _id = fight::kolizeum_birth(&protected, &mut kiosk, kiosk_cap, ids[0], 7, 2, &catalog, &clock, scenario.ctx());
    abort 999
  };
  if (managed(case) || case == Case::GroupSideB) {
    let _id = fight::kolizeum_birth(&protected, &mut kiosk, kiosk_cap, ids[0], 7, 0, &catalog, &clock, scenario.ctx());
  } else {
    api::challenge_duel(&mut kiosk, &personal, ids[0], ids[1], 50000, 50000, access,
      &protected, &catalog, &randomness, &version, &clock, scenario.ctx());
  };
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(version);
  world_content::share(other_content);
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.next_tx(OWNER);
  let fight = scenario.take_shared<fight::Fight>();
  let version = scenario.take_shared<version::Version>();
  let randomness = scenario.take_shared<random::Random>();
  let spell = scenario.take_shared<spell_rows::SpellTemplate>();
  let content = scenario.take_shared<world_content::WorldContent>();
  let catalog = scenario.take_shared<board_catalog::BoardCatalog>();
  Fixture { scenario, version, randomness, fight, kiosk, personal, protected, character_policy, character_policy_cap,
    item_policy, item_policy_cap, clock, spell, content, catalog, party, friends, ids }
}

fun join(f: &mut Fixture, index: u64, team: u8, access: u8) {
  let Fixture { fight, protected, kiosk, personal, ids, clock, scenario, .. } = f;
  fight::join(fight, protected, kiosk, personal_kiosk::borrow(personal),
    ids[index], team, access, true, clock, scenario.ctx());
}

fun start(f: &mut Fixture) {
  let Fixture { fight, scenario, clock, version, randomness, .. } = f;
  let count = combat::fighter_count(fight::combat_for_testing(fight));
  let mut seat = 0;
  while (seat + 1 < count) {
    api::ready_fight(fight, seat, version, scenario.ctx());
    seat = seat + 1;
  };
  api::ready_and_start_fight(fight, seat, randomness, version, clock, scenario.ctx());
}

fun finish(f: Fixture, atomic: bool) {
  let Fixture { mut scenario, version, randomness, mut fight, mut kiosk, personal, protected, character_policy,
    character_policy_cap, item_policy, item_policy_cap, clock, spell, catalog, content,
    mut party, mut friends, ids } = f;
  if (atomic) {
    api::settle_last_fight(fight, vector[0, 1], vector[0, 0], vector[], &mut kiosk, &personal,
      &character_policy, &item_policy, &randomness, &version, &clock, scenario.ctx());
  } else {
    let count = combat::fighter_count(fight::combat_for_testing(&fight));
    let cap = personal_kiosk::borrow(&personal);
    let mut seat = 0;
    while (seat < count) {
      if (!combat::fighter_settled(fight::combat_for_testing(&fight), seat)) {
        if (combat::ended(fight::combat_for_testing(&fight))) {
          fight::settle_pvp(&mut fight, seat, &mut kiosk, cap, &character_policy, &clock, scenario.ctx());
        } else if (fight::fight_world(&fight) == b"kolizeum".to_string()) {
          fight::forfeit(&mut fight, seat, &mut kiosk, cap, &character_policy, &clock, scenario.ctx());
        } else {
          api::forfeit_fight(&mut fight, seat, &mut kiosk, cap, &character_policy, &version, &clock, scenario.ctx());
        };
      };
      seat = seat + 1;
    };
    if (fight::fight_world(&fight) == b"kolizeum".to_string()) fight::close(fight, scenario.ctx())
    else api::close_fight(fight, &version, scenario.ctx());
  };
  ids.do_ref!(|id| assert!(kiosk.has_item(*id), 90));
  party::leave(&mut friends, &mut party, ids[2]);
  let leader = if (party::is_member(&party, ids[0])) ids[0] else ids[1];
  party::disband(&mut friends, party, leader);
  party::destroy_registry_for_testing(friends);
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer_policy::destroy_and_withdraw(character_policy, character_policy_cap, scenario.ctx()).destroy_zero();
  transfer_policy::destroy_and_withdraw(item_policy, item_policy_cap, scenario.ctx()).destroy_zero();
  clock::destroy_for_testing(clock);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(spell);
  test_scenario::return_shared(content);
  test_scenario::return_shared(catalog);
  scenario.end();
}

fun group_join(f: &mut Fixture, case: Case) {
  let Fixture { friends, party, ids, fight, protected, kiosk, personal, clock, scenario, version, .. } = f;
  if (case == Case::GroupMissingOpener) party::leave(friends, party, ids[0]);
  api::join_fight_grouped(fight, kiosk, personal_kiosk::borrow(personal),
    ids[if (case == Case::GroupMissingJoiner) 3 else 2], if (case == Case::GroupEmpty) 1 else 0,
    party, protected, version, clock, scenario.ctx());
  assert!(fight::side_players(fight, 0) == 2, 0);
}

fun act(f: &mut Fixture, case: Case) {
  let Fixture { fight, spell, scenario, version, .. } = f;
  if (case == Case::ForeignSender) { scenario.next_tx(@0xBAD); };
  if (case == Case::Move) {
    api::move_fighter(fight, vector[120], version, scenario.ctx());
    assert!(combat::fighter_cell(fight::combat_for_testing(fight), 0) == 120, 1);
  } else if (case == Case::Weapon) {
    api::weapon_strike(fight, 0, 106, version, scenario.ctx());
    assert!(fight::fighter_won(fight, 0), 2);
  } else {
    api::cast_spell(fight, if (case == Case::WrongActor) 1 else if (case == Case::MissingActor) 999 else 0,
      spell, 106, version, scenario.ctx());
    assert!(fight::fighter_won(fight, 0), 3);
  };
}

fun repeat_join(f: &mut Fixture) {
  join(f, 2, 0, 0);
  {
    let Fixture { fight, kiosk, personal, character_policy, clock, scenario, .. } = f;
    fight::forfeit(fight, 0, kiosk, personal_kiosk::borrow(personal), character_policy, clock, scenario.ctx());
  };
  join(f, 0, 0, 0);
}

fun seal_and_batch(f: &mut Fixture, case: Case) {
  let Fixture { fight, kiosk, personal, character_policy, item_policy, clock, scenario, randomness, version, .. } = f;
  api::end_fight_turn(fight, randomness, version, clock, scenario.ctx());
  if (case == Case::AtomicLast) return;
  if (case == Case::SealTwice) api::end_fight_turn(fight, randomness, version, clock, scenario.ctx());
  let fighters = if (case == Case::BatchEmpty) vector[] else if (case == Case::BatchDuplicate) vector[0, 0]
    else if (case == Case::BatchLengths || case == Case::BatchSuccess) vector[0, 1] else vector[0];
  let lengths = if (case == Case::BatchDuplicate || case == Case::BatchSuccess) vector[0, 0]
    else if (case == Case::BatchShortPlan) vector[1] else vector[0];
  let plan = if (case == Case::BatchLeftover) {
    let template = item_rows::template_for_testing(b"unused".to_string(), b"hat".to_string(), scenario.ctx());
    let plan = vector[item::prepare_plan(&template, option::none())];
    item_rows::destroy_for_testing(template);
    plan
  } else vector[];
  api::settle_fight(fight, fighters, lengths, plan, kiosk, personal,
    character_policy, item_policy, randomness, version, clock, scenario.ctx());
}

fun group_side_b(f: &mut Fixture) {
  let Fixture { fight, protected, kiosk, personal, ids, party, clock, scenario, .. } = f;
  let cap = personal_kiosk::borrow(personal);
  fight::join(fight, protected, kiosk, cap, ids[1], 1, 1, false, clock, scenario.ctx());
  fight::join_grouped(fight, protected, kiosk, cap, ids[2], 1, party, false, clock, scenario.ctx());
  assert!(fight::side_players(fight, 1) == 2 && fight::fighter_character(fight, 2) == ids[2], 30);
}

fun run(case: Case) {
  let mut f = fixture(case);
  if (managed(case) || case == Case::NotManaged) {
    let fight = &f.fight;
    if (case == Case::ManagedClose) fight::assert_close_door_open(fight);
    if (case == Case::ManagedStart) fight::assert_start_door_open(fight);
    if (case == Case::ManagedSettle) fight::assert_settle_door_open(fight);
    if (case == Case::ManagedJoin) fight::assert_join_door_open(fight);
    if (case == Case::ManagedForfeit) fight::assert_forfeit_door_open(fight);
    if (case == Case::NotManaged) fight::assert_kolizeum_controlled(fight);
    abort 999
  };
  if (case == Case::GroupSideB) {
    group_side_b(&mut f);
    finish(f, false);
    return
  };
  if (case == Case::GroupEmpty) { group_join(&mut f, case); abort 999 };
  join(&mut f, 1, 1, 0);
  if (case == Case::JoinBadTeam) join(&mut f, 2, 2, 0);
  if (case == Case::JoinBadAccess) join(&mut f, 2, 0, 2);
  if (case == Case::JoinForeignWorld) join(&mut f, 2, 0, 0);
  if (case == Case::JoinRepeated) repeat_join(&mut f);
  if (case == Case::JoinHistoryFull) {
    let mut index = 2;
    while (index < 7) { join(&mut f, index, 0, 0); index = index + 1; };
    let Fixture { fight, kiosk, personal, character_policy, version, clock, scenario, ids, .. } = &mut f;
    api::forfeit_fight(fight, 2, kiosk, personal_kiosk::borrow(personal), character_policy, version, clock, scenario.ctx());
    assert!(kiosk.has_item(ids[2]), 40);
    join(&mut f, 7, 0, 0);
    abort 999
  };
  if (case == Case::JoinFull) {
    let mut index = 2;
    while (index < 8) { join(&mut f, index, 0, 0); index = index + 1; };
  };
  if (case == Case::GroupJoin || case == Case::GroupMissingOpener || case == Case::GroupMissingJoiner || case == Case::GroupPublic) {
    group_join(&mut f, case);
    finish(f, false);
    return
  };
  {
    let Fixture { fight, scenario, .. } = &mut f;
    if (case == Case::MissingReady) { let _ = fight::ready(fight, 999, scenario.ctx()); };
    if (case == Case::MissingRef) { let _ = fight::fighter_character_ref(fight, 999); };
    if (case == Case::ReadyFinal) {
      fight::ready_non_final(fight, 0, scenario.ctx());
      fight::ready_non_final(fight, 1, scenario.ctx());
    };
    if (case == Case::Weapon) fight::place(fight, 0, 105, scenario.ctx());
  };
  if (case == Case::ApiStart) {
    let Fixture { fight, clock, randomness, version, scenario, .. } = &mut f;
    clock::set_for_testing(clock, 60001);
    api::start_fight(fight, randomness, version, clock, scenario.ctx());
  } else {
    if (case == Case::ApiReadyPartial) {
      let Fixture { fight, clock, randomness, version, scenario, .. } = &mut f;
      api::ready_and_start_fight(fight, 0, randomness, version, clock, scenario.ctx());
      assert!(fight::in_placement(fight), 10);
    };
    start(&mut f);
  };
  if (case == Case::ApiCrank) {
    {
      let Fixture { fight, clock, randomness, version, scenario, .. } = &mut f;
      clock::set_for_testing(clock, 45001);
      api::crank_fight(fight, randomness, version, clock, scenario.ctx());
      assert!(combat::active_fighter(fight::combat_for_testing(fight)) == 1, 11);
    };
    finish(f, false);
    return
  };
  if (case == Case::JoinStarted) join(&mut f, 2, 0, 0);
  act(&mut f, case);
  if (case == Case::SealTwice || case == Case::BatchEmpty || case == Case::BatchLengths || case == Case::BatchShortPlan
    || case == Case::BatchLeftover || case == Case::BatchDuplicate || case == Case::BatchSuccess || case == Case::AtomicLast) seal_and_batch(&mut f, case);
  finish(f, case == Case::AtomicLast);
}

#[test]
fun a_live_spell_template_cast_ends_combat_and_returns_both_characters() { run(Case::Cast) }
#[test]
fun equipped_weapon_damage_flows_through_the_core_strike_owner() { run(Case::Weapon) }
#[test]
fun an_owned_move_commits_the_live_character_position() { run(Case::Move) }
#[test]
fun party_members_join_the_grouped_side_with_real_custody() { run(Case::GroupJoin) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun another_class_cannot_cast_a_foreign_spell() { run(Case::WrongClass) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun an_unlearned_spell_cannot_be_cast() { run(Case::Unlearned) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun another_seat_cannot_cast_out_of_turn() { run(Case::WrongActor) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_foreign_sender_cannot_cast_for_the_active_seat() { run(Case::ForeignSender) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun a_missing_seat_cannot_cast() { run(Case::MissingActor) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun joining_refuses_an_unknown_team() { run(Case::JoinBadTeam) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun joining_refuses_an_unknown_side_access_mode() { run(Case::JoinBadAccess) }
#[test, expected_failure(abort_code = 1707, location = aresrpg::fight)]
fun joining_refuses_a_seventh_live_fighter_on_one_side() { run(Case::JoinFull) }
#[test, expected_failure(abort_code = 1706, location = aresrpg::fight)]
fun started_fights_refuse_new_participants() { run(Case::JoinStarted) }
#[test, expected_failure(abort_code = 1727, location = aresrpg::fight)]
fun grouped_join_refuses_a_public_side() { run(Case::GroupPublic) }
#[test, expected_failure(abort_code = 1727, location = aresrpg::fight)]
fun grouped_join_requires_the_opener_to_remain_in_the_party() { run(Case::GroupMissingOpener) }
#[test, expected_failure(abort_code = 1727, location = aresrpg::fight)]
fun grouped_join_requires_the_joining_character_to_be_a_member() { run(Case::GroupMissingJoiner) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun a_nonfinal_ready_door_cannot_become_final() { run(Case::ReadyFinal) }

#[test, expected_failure(abort_code = 1714, location = aresrpg::fight)]
fun a_forfeited_character_cannot_rejoin_the_same_fight() { run(Case::JoinRepeated) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun readiness_rejects_a_missing_authority_seat() { run(Case::MissingReady) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun character_reads_reject_a_missing_authority_seat() { run(Case::MissingRef) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun terminal_loot_entropy_can_be_sealed_only_once() { run(Case::SealTwice) }
#[test, expected_failure(abort_code = 1731, location = aresrpg::fight)]
fun settlement_batch_requires_at_least_one_seat() { run(Case::BatchEmpty) }
#[test, expected_failure(abort_code = 1731, location = aresrpg::fight)]
fun settlement_batch_requires_one_plan_length_per_seat() { run(Case::BatchLengths) }
#[test, expected_failure(abort_code = 1731, location = aresrpg::fight)]
fun settlement_batch_cannot_pop_more_plans_than_supplied() { run(Case::BatchShortPlan) }
#[test, expected_failure(abort_code = 1731, location = aresrpg::fight)]
fun settlement_batch_refuses_unassigned_trailing_plans() { run(Case::BatchLeftover) }
#[test, expected_failure(abort_code = 1708, location = aresrpg::fight)]
fun duplicate_batch_seats_cannot_settle_character_custody_twice() { run(Case::BatchDuplicate) }

#[test]
fun native_start_entry_uses_the_force_start_clock() { run(Case::ApiStart) }
#[test]
fun native_ready_entry_starts_only_when_the_final_player_readies() { run(Case::ApiReadyPartial) }
#[test]
fun native_crank_entry_advances_an_expired_turn() { run(Case::ApiCrank) }
#[test]
fun native_settlement_entry_returns_both_same_kiosk_characters() { run(Case::BatchSuccess) }
#[test]
fun native_final_settlement_entry_also_reclaims_the_fight() { run(Case::AtomicLast) }

#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun a_grouped_join_requires_an_existing_side_participant() { run(Case::GroupEmpty) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun challenge_creation_rejects_an_unknown_access_mode() { run(Case::ChallengeAccess) }
#[test, expected_failure(abort_code = 1726, location = aresrpg::fight)]
fun kolizeum_creation_rejects_an_unknown_access_mode() { run(Case::KolizeumAccess) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun managed_fights_refuse_the_ordinary_close_door() { run(Case::ManagedClose) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun managed_fights_refuse_the_ordinary_start_door() { run(Case::ManagedStart) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun managed_fights_refuse_the_ordinary_settlement_door() { run(Case::ManagedSettle) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun managed_fights_refuse_the_ordinary_join_door() { run(Case::ManagedJoin) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun managed_fights_refuse_the_ordinary_forfeit_door() { run(Case::ManagedForfeit) }
#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun ordinary_fights_cannot_impersonate_kolizeum_control() { run(Case::NotManaged) }

#[test]
fun grouped_side_b_uses_its_own_opener_membership_and_custody() { run(Case::GroupSideB) }
#[test, expected_failure(abort_code = 1701, location = aresrpg::fight)]
fun an_ordinary_join_refuses_a_character_from_another_world() { run(Case::JoinForeignWorld) }
#[test, expected_failure(abort_code = 1731, location = aresrpg::fight)]
fun a_final_settlement_requires_at_least_one_named_participant() {
  let mut f = fixture(Case::Cast);
  {
    let Fixture { fight, scenario, .. } = &mut f;
    fight::assert_last_settlers(fight, &vector[], scenario.ctx());
  };
  finish(f, false);
}

#[test, expected_failure(abort_code = 1730, location = aresrpg::fight)]
fun a_victory_must_seal_its_terminal_entropy_before_reward_preparation() {
  let mut f = fixture(Case::Cast);
  join(&mut f, 1, 1, 0);
  start(&mut f);
  act(&mut f, Case::Cast);
  let Fixture { mut scenario, fight, clock, version, randomness, spell, content, catalog,
    kiosk: _kiosk, personal: _personal, protected: _protected, character_policy: _character_policy,
    character_policy_cap: _character_policy_cap, item_policy: _item_policy, item_policy_cap: _item_policy_cap,
    party: _party, friends: _friends, ids: _ids } = f;
  test_scenario::return_shared(fight);
  test_scenario::return_shared(version);
  test_scenario::return_shared(randomness);
  test_scenario::return_shared(spell);
  test_scenario::return_shared(content);
  test_scenario::return_shared(catalog);
  let genesis = kares::genesis_for_testing(scenario.ctx());
  let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
  offering::setup(genesis, cap, 1, 10, 100, OWNER, OWNER, OWNER, OWNER, scenario.ctx());
  scenario.next_tx(OWNER);
  let mut fight = scenario.take_shared<fight::Fight>();
  let offering = scenario.take_shared<offering::Offering>();
  let mut pot = scenario.take_shared<combat_rewards::CombatPot>();
  fight::prepare_boss_rewards(&mut fight, 0, &offering, &mut pot, &clock, scenario.ctx());
  abort 999
}

#[test, expected_failure(abort_code = 1707, location = aresrpg::fight)]
fun forfeiting_does_not_reopen_a_six_admission_side() { run(Case::JoinHistoryFull); }
