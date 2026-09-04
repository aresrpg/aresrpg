// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Retry safety for actual fight creation and boundary transitions.
#[test_only]
module aresrpg::fight_randomness_tests;

use aresrpg::{api, character, fight, item, protected_policy, world};
use aresrpg_control::admin;
use aresrpg_math::combat_grid;
use aresrpg_seed::{board_catalog, item_rows, registry, world_content};
use kiosk::personal_kiosk;
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;

fun ready(fight: &mut fight::Fight, ctx: &TxContext) {
  assert!(fight::ready(fight, 1, ctx), 1);
}

#[test]
fun full_width_character_ids_create_duel_and_kolizeum_fights() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);

  let publisher = scenario.take_from_sender<Publisher>();
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let cap = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let content = world_content::create(
    &cap, &mut root, b"nauvis".to_string(), 1, scenario.ctx(),
  );
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(
    &cap, &mut root, &mut catalog, combat_grid::generate(1, 0), scenario.ctx(),
  );
  let clock = clock::create_for_testing(scenario.ctx());
  let mut challenger = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let mut gladiator = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  world::join_world(&mut challenger, &content, &clock);
  world::join_world(&mut gladiator, &content, &clock);
  let challenger_id = object::id(&challenger);
  let gladiator_id = object::id(&gladiator);
  assert!(challenger_id.to_address().to_u256() > 0xFFFFFFFFFFFFFFFFu256, 2);
  assert!(gladiator_id.to_address().to_u256() > 0xFFFFFFFFFFFFFFFFu256, 3);

  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let kiosk_cap = personal_kiosk::borrow(&personal);
  kiosk.place(kiosk_cap, challenger);
  kiosk.place(kiosk_cap, gladiator);
  let mut duel_entropy = random::new_generator_from_seed_for_testing(b"duel");
  fight::challenge(
    &protected, &mut kiosk, kiosk_cap, challenger_id, gladiator_id, 50_000, 50_000, 0,
    &catalog, &mut duel_entropy, &clock, scenario.ctx(),
  );
  let _ = fight::kolizeum_birth(
    &protected, &mut kiosk, kiosk_cap, gladiator_id, 7, 0, &catalog, &clock, scenario.ctx(),
  );
  assert!(event::events_by_type<fight::FightCreated>().length() == 2, 4);

  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  board_catalog::share_for_testing(catalog);
  world_content::share(content);
  clock::destroy_for_testing(clock);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(cap);
  scenario.end();
}

#[test]
fun start_executes_committed_entropy_before_fresh_entropy() {
  let mut scenario = test_scenario::begin(OWNER);
  let clock = clock::create_for_testing(scenario.ctx());
  let mut first = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  let mut retry = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  ready(&mut first, scenario.ctx());
  ready(&mut retry, scenario.ctx());
  let mut future_a = random::new_generator_from_seed_for_testing(b"future-a");
  let mut future_b = random::new_generator_from_seed_for_testing(b"future-b");
  fight::start(&mut first, &mut future_a, &clock);
  fight::start(&mut retry, &mut future_b, &clock);

  let events = event::events_by_type<fight::TurnSeedUsed>();
  assert!(events.length() == 2, 5);
  assert!(fight::turn_seed_for_testing(&events[0]) == fight::turn_seed_for_testing(&events[1]), 6);
  assert!(fight::next_turn_entropy_for_testing(&first) != fight::next_turn_entropy_for_testing(&retry), 7);

  fight::destroy_retry_boundary_for_testing(first);
  fight::destroy_retry_boundary_for_testing(retry);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun end_turn_retries_the_same_committed_mob_wave() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut clock = clock::create_for_testing(scenario.ctx());
  let mut first = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  let mut retry = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  ready(&mut first, scenario.ctx());
  ready(&mut retry, scenario.ctx());
  let mut same_a = random::new_generator_from_seed_for_testing(b"same-future");
  let mut same_b = random::new_generator_from_seed_for_testing(b"same-future");
  fight::start(&mut first, &mut same_a, &clock);
  fight::start(&mut retry, &mut same_b, &clock);
  clock::increment_for_testing(&mut clock, 6_000);
  let mut future_a = random::new_generator_from_seed_for_testing(b"end-future-a");
  let mut future_b = random::new_generator_from_seed_for_testing(b"end-future-b");
  fight::end_turn(&mut first, &mut future_a, &clock, scenario.ctx());
  fight::end_turn(&mut retry, &mut future_b, &clock, scenario.ctx());

  let events = event::events_by_type<fight::TurnSeedUsed>();
  assert!(events.length() == 4, 8);
  assert!(fight::turn_seed_for_testing(&events[2]) == fight::turn_seed_for_testing(&events[3]), 9);
  assert!(fight::next_turn_entropy_for_testing(&first) != fight::next_turn_entropy_for_testing(&retry), 10);

  fight::destroy_retry_boundary_for_testing(first);
  fight::destroy_retry_boundary_for_testing(retry);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun crank_retries_the_same_committed_mob_wave() {
  let mut scenario = test_scenario::begin(OWNER);
  let mut clock = clock::create_for_testing(scenario.ctx());
  let mut first = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  let mut retry = fight::retry_boundary_fight_for_testing(7, scenario.ctx());
  ready(&mut first, scenario.ctx());
  ready(&mut retry, scenario.ctx());
  let mut same_a = random::new_generator_from_seed_for_testing(b"same-future");
  let mut same_b = random::new_generator_from_seed_for_testing(b"same-future");
  fight::start(&mut first, &mut same_a, &clock);
  fight::start(&mut retry, &mut same_b, &clock);
  clock::increment_for_testing(&mut clock, 48_000);
  let mut future_a = random::new_generator_from_seed_for_testing(b"crank-future-a");
  let mut future_b = random::new_generator_from_seed_for_testing(b"crank-future-b");
  fight::crank(&mut first, &mut future_a, &clock);
  fight::crank(&mut retry, &mut future_b, &clock);

  let events = event::events_by_type<fight::TurnSeedUsed>();
  assert!(events.length() == 4, 11);
  assert!(fight::turn_seed_for_testing(&events[2]) == fight::turn_seed_for_testing(&events[3]), 12);
  assert!(fight::next_turn_entropy_for_testing(&first) != fight::next_turn_entropy_for_testing(&retry), 13);

  fight::destroy_retry_boundary_for_testing(first);
  fight::destroy_retry_boundary_for_testing(retry);
  clock::destroy_for_testing(clock);
  scenario.end();
}

#[test]
fun settlement_uses_committed_loot_entropy_not_its_fresh_generator() {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  scenario.next_tx(OWNER);
  let publisher = scenario.take_from_sender<Publisher>();
  let (character_policy, character_policy_cap) =
    transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let (item_policy, item_policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  publisher.burn();
  let (mut kiosk, kiosk_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, kiosk_cap, scenario.ctx());
  let kiosk_cap = personal_kiosk::borrow(&personal);
  let first_character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
  let retry_character = character::test_character(b"shugo".to_string(), 1, 0, scenario.ctx());
  let mut first = fight::retry_loot_fight_for_testing(first_character, 7, scenario.ctx());
  let mut retry = fight::retry_loot_fight_for_testing(retry_character, 7, scenario.ctx());
  let template = item_rows::template_for_testing(
    b"retry_fang".to_string(), b"hat".to_string(), scenario.ctx(),
  );
  let clock = clock::create_for_testing(scenario.ctx());
  let mut item_entropy_a = random::new_generator_from_seed_for_testing(b"item-stats-a");
  let mut item_entropy_b = random::new_generator_from_seed_for_testing(b"item-stats-b");
  fight::settle(
    &mut first, 0, &mut kiosk, kiosk_cap, &character_policy, &item_policy,
    vector[api::prepare_fight_loot(&template, option::none())], &mut item_entropy_a,
    &clock, scenario.ctx(),
  );
  fight::settle(
    &mut retry, 0, &mut kiosk, kiosk_cap, &character_policy, &item_policy,
    vector[api::prepare_fight_loot(&template, option::none())], &mut item_entropy_b,
    &clock, scenario.ctx(),
  );

  let drops = event::events_by_type<fight::DropsRolled>();
  assert!(drops.length() == 2, 14);
  assert!(fight::drops_quantity_for_testing(&drops[0]) == fight::drops_quantity_for_testing(&drops[1]), 15);

  fight::destroy_retry_boundary_for_testing(first);
  fight::destroy_retry_boundary_for_testing(retry);
  item_rows::destroy_for_testing(template);
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  transfer_policy::destroy_and_withdraw(character_policy, character_policy_cap, scenario.ctx())
    .into_balance().destroy_zero();
  transfer_policy::destroy_and_withdraw(item_policy, item_policy_cap, scenario.ctx())
    .into_balance().destroy_zero();
  clock::destroy_for_testing(clock);
  scenario.end();
}
