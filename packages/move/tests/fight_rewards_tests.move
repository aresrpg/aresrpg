#[test_only]
module aresrpg::fight_rewards_tests;

use aresrpg::{character, fight};
use aresrpg::fight_rewards::{Self, BossVictory};
use aresrpg_kares::{kares::{Self, KARES}, offering::{Self, Offering}, staking::StakingPool};
use aresrpg_kares::combat_rewards::{Self, CombatPot};
use sui::clock;
use sui::coin::{Self, Coin};
use sui::test_scenario;

fun fixture(seeded: bool): (test_scenario::Scenario, Offering, StakingPool, CombatPot, clock::Clock) {
    let mut scenario = test_scenario::begin(@0xA);
    let mut clock = clock::create_for_testing(scenario.ctx());
    let genesis = kares::genesis_for_testing(scenario.ctx());
    let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
    offering::setup(genesis, cap, 1, 10, 100, @0xA, @0xA, @0xA, @0xA, scenario.ctx());
    scenario.next_tx(@0xA);
    let mut offering = scenario.take_shared<Offering>();
    offering::start(&mut offering, &clock, scenario.ctx());
    let mut pool = scenario.take_shared<StakingPool>();
    let mut pot = scenario.take_shared<CombatPot>();
    if (seeded) offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    offering::authorize_combat<BossVictory>(&offering, &mut pot, scenario.ctx());
    let contribution = offering::contribution_for_testing(&mut offering, 1, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    let (tokens, refund) = offering::claim(&mut offering, &mut pool, contribution, &clock, scenario.ctx());
    coin::burn_for_testing(tokens);
    coin::burn_for_testing(refund);
    (scenario, offering, pool, pot, clock)
}

#[test]
fun one_bounty_pays_every_winner_once_and_keeps_party_rounding_in_the_pot() {
    let (mut scenario, offering, pool, mut pot, clock) = fixture(true);
    let mut rewards = fight_rewards::boss_for_testing(200);
    assert!(!fight_rewards::ready(&rewards));
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xB, @0xC, @0xD], &clock, scenario.ctx());
    let share = combat_rewards::daily_budget() / 100 / 3;
    assert!(fight_rewards::ready(&rewards) && fight_rewards::amount(&rewards) == share);
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens() - share * 3);
    let work = combat_rewards::work(&pot);
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xE], &clock, scenario.ctx());
    assert!(combat_rewards::work(&pot) == work);
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens() - share * 3);
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    test_scenario::return_shared(pot);
    clock.destroy_for_testing();
    scenario.next_tx(@0xB);
    let first = scenario.take_from_address<Coin<KARES>>(@0xB);
    let second = scenario.take_from_address<Coin<KARES>>(@0xC);
    let third = scenario.take_from_address<Coin<KARES>>(@0xD);
    assert!(first.value() == share && second.value() == share && third.value() == share);
    assert!(test_scenario::ids_for_address<Coin<KARES>>(@0xE).is_empty());
    coin::burn_for_testing(first);
    coin::burn_for_testing(second);
    coin::burn_for_testing(third);
    scenario.end();
}

#[test]
fun ordinary_fights_are_ready_without_a_currency_allocation() {
    let rewards = fight_rewards::new();
    assert!(fight_rewards::ready(&rewards));
    assert!(fight_rewards::amount(&rewards) == 0);
}

#[test]
fun empty_pot_finalizes_zero_and_later_funding_cannot_replay_it() {
    let (mut scenario, mut offering, pool, mut pot, clock) = fixture(false);
    let mut ordinary = fight_rewards::new();
    fight_rewards::allocate(&mut ordinary, &offering, &mut pot, vector[], &clock, scenario.ctx());
    let mut rewards = fight_rewards::boss_for_testing(200);
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xB], &clock, scenario.ctx());
    assert!(fight_rewards::ready(&rewards) && fight_rewards::amount(&rewards) == 0);
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xB], &clock, scenario.ctx());
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens());
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    test_scenario::return_shared(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = aresrpg::fight_rewards)]
fun boss_allocation_requires_at_least_one_authoritative_winner() {
    let (mut scenario, offering, pool, mut pot, clock) = fixture(true);
    let mut rewards = fight_rewards::boss_for_testing(200);
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[], &clock, scenario.ctx());
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    test_scenario::return_shared(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun an_unfinished_fight_cannot_allocate_a_boss_bounty() {
    let (mut scenario, offering, pool, mut pot, clock) = fixture(true);
    let character = character::test_character(b"senshi".to_string(), 1, 0, scenario.ctx());
    let mut fight = fight::party_authority_fight_for_testing(character, @0xA, false, scenario.ctx());
    let before = combat_rewards::balance(&pot);
    let work = combat_rewards::work(&pot);
    fight::prepare_boss_rewards(&mut fight, 0, &offering, &mut pot, &clock, scenario.ctx());
    assert!(combat_rewards::balance(&pot) == before && combat_rewards::work(&pot) == work);
    character::destroy(fight::take_party_authority_character_for_testing(fight));
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    test_scenario::return_shared(pot);
    clock.destroy_for_testing();
    scenario.end();
}
