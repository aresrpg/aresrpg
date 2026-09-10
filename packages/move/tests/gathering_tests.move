// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
#[test_only]
module aresrpg::gathering_tests;

use aresrpg::{api, character, equipment, gathering, item, fight, progression, protected_policy, version, world, zone};
use aresrpg_control::admin;
use aresrpg_math::{combat_grid, item_stats, job_xp, mob_data, world_map};
use aresrpg_combat::combat;
use kiosk::personal_kiosk;
use aresrpg_seed::{board_catalog, item_rows, mob_rows, registry, world_content};
use sui::{clock, event, kiosk, package::Publisher, random, test_scenario, transfer_policy};

const OWNER: address = @0xA11CE;
public enum Variant has copy, drop { None, Root, Tool, Template, Rare, Tier, World, Protector, NoVerdict, NoFiredVerdict, NoBonuses }

// Pinned deterministic inputs exercise all harvest outcomes without replacing the native RNG.
fun harvest(seed: u64, quantity: u32, rare: bool, ambush: bool, variant: Variant) {
  let mut scenario = test_scenario::begin(OWNER);
  item::test_init(scenario.ctx());
  version::test_init(scenario.ctx());
  let admin = admin::cap_for_testing(scenario.ctx());
  let mut root = registry::registry_for_testing(scenario.ctx());
  let shift = item_stats::shift();
  mob_rows::add_mob(&admin, &mut root, mob_data::new_mob_data(
    b"Protector".to_string(), if (variant == Variant::Protector) b"wrong".to_string() else b"protector".to_string(),
    b"earth".to_string(), 1, 1, 10, 6, 0, 0, 0, shift, shift, shift, shift, vector[], vector[], 1, false), scenario.ctx());
  scenario.next_tx(OWNER);
  let version = scenario.take_shared<version::Version>();
  let publisher = scenario.take_from_sender<Publisher>();
  let (policy, policy_cap) = transfer_policy::new<item::Item>(&publisher, scenario.ctx());
  let (character_policy, character_policy_cap) = transfer_policy::new<character::Character>(&publisher, scenario.ctx());
  let protected = protected_policy::for_testing<character::Character>(&publisher, scenario.ctx());
  publisher.burn();
  let mob = scenario.take_shared<mob_rows::MobTemplate>();
  let mut catalog = board_catalog::catalog_for_testing(scenario.ctx());
  board_catalog::add_board(&admin, &mut root, &mut catalog, combat_grid::grid_spec(20, 19,
    vector[0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFF, 0x0FFFFFFFFFFFFFFF],
    vector[], vector[], vector[100, 101, 102, 103, 104, 105], vector[106, 107, 108, 109, 110, 111]), scenario.ctx());
  let mut content = world_content::create(&admin, &mut root, b"nauvis".to_string(), 1, scenario.ctx());
  world_content::set_resources(&admin, &mut root, &mut content,
    vector[world_map::new_resource_row(b"wheat".to_string(), b"FARMER".to_string(), if (variant == Variant::Tier) 2 else 1,
      if (variant == Variant::NoBonuses) b"".to_string() else b"protector".to_string(),
      if (variant == Variant::NoBonuses) b"".to_string() else b"rare_wheat".to_string(), vector[0], vector[])], scenario.ctx());
  let wheat = item_rows::template_for_testing(b"wheat".to_string(), b"resource".to_string(), scenario.ctx());
  let rare_wheat = item_rows::template_for_testing(b"rare_wheat".to_string(), b"resource".to_string(), scenario.ctx());
  let mut tool = item_rows::template_for_testing(b"sickle".to_string(), b"tool_farmer".to_string(), scenario.ctx());
  // Character and tool outlevel the job; only job XP may select harvest tier, yield, and delay.
  item_rows::overwrite_item(&admin, &mut root, &mut tool, b"Sickle".to_string(), 60, vector[], scenario.ctx());
  let mut setup = random::new_generator_from_seed_for_testing(b"gather-setup");
  let mut character = character::test_character(b"senshi".to_string(), 60, 0, scenario.ctx());
  let mut clock = clock::create_for_testing(scenario.ctx());
  world::join_world(&mut character, &content, &clock);
  if (variant != Variant::Tool) equipment::equip(&mut character, b"tool".to_string(), item::mint(&tool, 1, &mut setup, scenario.ctx()));
  if (variant == Variant::World) {
    let other = world_content::create(&admin, &mut root, b"other".to_string(), 1, scenario.ctx());
    world::join_world(&mut character, &other, &clock);
    world_content::share(other);
  };
  assert!(!gathering::has_fired_verdict(&character), 0);
  let id = object::id(&character);
  let (mut kiosk, owner_cap) = kiosk::new(scenario.ctx());
  let personal = personal_kiosk::new(&mut kiosk, owner_cap, scenario.ctx());
  let cap = personal_kiosk::borrow(&personal);
  kiosk.place(cap, character);
  let stack = item::mint(&wheat, 5, &mut setup, scenario.ctx());
  let stack_id = object::id(&stack);
  kiosk.place(cap, stack);
  let rare_stack = item::mint(&rare_wheat, 5, &mut setup, scenario.ctx());
  let rare_id = object::id(&rare_stack);
  kiosk.place(cap, rare_stack);
  let mut zone = zone::for_testing(b"nauvis".to_string(), 97, 97, 17, scenario.ctx());
  let nodes = zone::resource_pack_at(&zone, &content, 0).pack_nodes();
  clock::increment_for_testing(&mut clock, 1_000_000);
  progression::set_hp(kiosk.borrow_mut<character::Character>(cap, id), 5, &clock);
  if (variant == Variant::NoVerdict) api::resolve_ambush(&protected, &mut kiosk, cap, id, &mob, &catalog, &version, &clock, scenario.ctx());
  let mut entropy = random::new_generator_from_seed_for_testing(std::bcs::to_bytes(&seed));
  gathering::gather(&mut zone, &content, &mut kiosk, cap, id, 0,
    if (variant == Variant::Template) &rare_wheat else &wheat,
    if (variant == Variant::Rare) &wheat else &rare_wheat,
    option::some(stack_id), option::some(rare_id), &policy, &mut entropy, &clock, scenario.ctx());
  assert!(item::amount(kiosk.borrow<item::Item>(cap, stack_id)) == 5 + quantity, 1);
  assert!(item::amount(kiosk.borrow<item::Item>(cap, rare_id)) == if (rare) 6 else 5, 2);
  assert!(zone::resource_pack_at(&zone, &content, 0).pack_nodes() == nodes - 1, 3);
  assert!(event::events_by_type<gathering::ResourceGathered>().length() == 1, 4);
  assert!(event::events_by_type<gathering::RareGathered>().length() == if (rare) 1 else 0, 5);
  let character: &character::Character = kiosk.borrow(cap, id);
  assert!(progression::job_xp_of(character, b"FARMER".to_string()) == job_xp::gather_xp(1), 6);
  assert!(gathering::has_fired_verdict(character) == ambush && world::is_rooted(character, &clock), 7);
  if (variant == Variant::Root) gathering::gather(&mut zone, &content, &mut kiosk, cap, id, 0, &wheat, &rare_wheat,
    option::some(stack_id), option::some(rare_id), &policy, &mut entropy, &clock, scenario.ctx());
  clock::increment_for_testing(&mut clock, job_xp::gather_time_ms(1));
  assert!(world::is_rooted(kiosk.borrow<character::Character>(cap, id), &clock) == ambush, 8);
  if (ambush || variant == Variant::NoFiredVerdict) {
    clock::increment_for_testing(&mut clock, 60_000);
    assert!(world::is_rooted(kiosk.borrow<character::Character>(cap, id), &clock) == ambush, 9);
    api::resolve_ambush(&protected, &mut kiosk, cap, id, &mob, &catalog, &version, &clock, scenario.ctx());
    assert!(!kiosk.has_item(id), 10);

  } else {
    let mut next = random::new_generator_from_seed_for_testing(std::bcs::to_bytes(&0u64));
    gathering::gather(&mut zone, &content, &mut kiosk, cap, id, 0, &wheat, &rare_wheat,
      option::some(stack_id), option::some(rare_id), &policy, &mut next, &clock, scenario.ctx());
    assert!(item::amount(kiosk.borrow<item::Item>(cap, stack_id)) == 7 + quantity, 15);
    assert!(progression::job_xp_of(kiosk.borrow<character::Character>(cap, id), b"FARMER".to_string()) == 2 * job_xp::gather_xp(1), 16);
  };
  test_scenario::return_shared(version);
  test_scenario::return_shared(mob);
  world_content::share(content);
  board_catalog::share_for_testing(catalog);
  if (ambush) {
    scenario.next_tx(OWNER);
    let mut fight = scenario.take_shared<fight::Fight>();
    assert!(fight::fighter_character(&fight, 0) == id && fight::side_players(&fight, 0) == 1, 11);
    assert!(combat::fighter_hp(fight::combat_for_testing(&fight), 0) == 5, 12);
    assert!(!gathering::has_fired_verdict(fight::fighter_character_ref(&fight, 0)), 13);
    fight::forfeit(&mut fight, 0, &mut kiosk, cap, &character_policy, &mut entropy, &clock, scenario.ctx());
    fight::close(fight, scenario.ctx());
    assert!(kiosk.has_item(id), 14);
  };
  transfer::public_transfer(kiosk, OWNER);
  personal_kiosk::transfer_to_sender(personal, scenario.ctx());
  protected_policy::destroy_for_testing(protected, scenario.ctx());
  transfer_policy::destroy_and_withdraw(character_policy, character_policy_cap, scenario.ctx()).into_balance().destroy_zero();
  item_rows::destroy_for_testing(wheat);
  item_rows::destroy_for_testing(rare_wheat);
  item_rows::destroy_for_testing(tool);
  zone::destroy_for_testing(zone);
  registry::destroy_for_testing(root);
  admin::destroy_for_testing(admin);
  clock::destroy_for_testing(clock);
  transfer_policy::destroy_and_withdraw(policy, policy_cap, scenario.ctx()).into_balance().destroy_zero();
  scenario.end();
}

#[test]
fun quiet_harvest_consumes_one_node_banks_xp_and_unroots_at_the_deadline() { harvest(0, 2, false, false, Variant::None); }
#[test]
fun protector_verdict_retains_the_harvest_and_survives_the_normal_deadline() { harvest(29, 1, false, true, Variant::None); }
#[test]
fun golden_harvest_adds_one_rare_unit_without_replacing_the_base_yield() { harvest(268, 2, true, false, Variant::None); }
#[test, expected_failure(abort_code = 305, location = aresrpg::world)]
fun an_immediate_second_harvest_cannot_bypass_the_root() { harvest(0, 2, false, false, Variant::Root); }

#[test, expected_failure(abort_code = 2203, location = aresrpg::gathering)]
fun harvesting_requires_the_job_tool() { harvest(0, 2, false, false, Variant::Tool); }
#[test, expected_failure(abort_code = 2202, location = aresrpg::gathering)]
fun the_pack_cannot_mint_a_substitute_resource() { harvest(0, 2, false, false, Variant::Template); }
#[test, expected_failure(abort_code = 2205, location = aresrpg::gathering)]
fun a_wrong_rare_template_refuses_even_when_the_jackpot_does_not_fire() { harvest(0, 2, false, false, Variant::Rare); }
#[test, expected_failure(abort_code = 2204, location = aresrpg::gathering)]
fun a_tool_does_not_bypass_the_job_tier_gate() { harvest(0, 2, false, false, Variant::Tier); }
#[test, expected_failure(abort_code = 2201, location = aresrpg::gathering)]
fun a_character_cannot_harvest_another_world() { harvest(0, 2, false, false, Variant::World); }
#[test, expected_failure(abort_code = 2206, location = aresrpg::gathering)]
fun the_committed_protector_cannot_be_substituted() { harvest(29, 1, false, true, Variant::Protector); }
#[test, expected_failure(abort_code = 2207, location = aresrpg::gathering)]
fun an_ungathered_character_has_no_ambush_to_resolve() { harvest(0, 2, false, false, Variant::NoVerdict); }
#[test, expected_failure(abort_code = 2207, location = aresrpg::gathering)]
fun a_quiet_verdict_cannot_be_upgraded_into_a_protector() { harvest(0, 2, false, false, Variant::NoFiredVerdict); }

#[test]
fun a_plain_resource_cannot_create_an_unauthored_bonus_or_protector() { harvest(29, 1, false, false, Variant::NoBonuses); }
