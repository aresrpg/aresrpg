#[test_only]
module aresrpg::fight_rewards_tests;

use aresrpg::{character, fight};
use aresrpg::fight_rewards::{Self, BossVictory};
use aresrpg_rewards::{economy::{Self, Economy}, staking::{Self, StakingPool}, test_coin::TEST_COIN as KARES};
use aresrpg_rewards::combat_rewards::{Self, CombatPot};
use sui::clock;
use sui::coin::{Self, Coin};
use sui::test_scenario;

fun fixture(seeded: bool): (test_scenario::Scenario, Economy, StakingPool<KARES>, CombatPot<KARES>, clock::Clock) {
    let mut scenario = test_scenario::begin(@0xA);
    let clock = clock::create_for_testing(scenario.ctx());
    let pool = staking::pool_for_testing<KARES>(&clock, scenario.ctx());
    let pot = combat_rewards::pot_for_testing<KARES, BossVictory>(if (seeded) combat_rewards::initial_tokens() else 0, &clock, scenario.ctx());
    let economy = economy::economy_for_testing<KARES>(@0x0.to_id(), object::id(&pot), scenario.ctx());
    (scenario, economy, pool, pot, clock)
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
    economy::destroy_for_testing(offering);
    staking::destroy_for_testing(pool);
    combat_rewards::destroy_for_testing(pot);
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
    let (mut scenario, offering, pool, mut pot, clock) = fixture(false);
    let mut ordinary = fight_rewards::new();
    fight_rewards::allocate(&mut ordinary, &offering, &mut pot, vector[], &clock, scenario.ctx());
    let mut rewards = fight_rewards::boss_for_testing(200);
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xB], &clock, scenario.ctx());
    assert!(fight_rewards::ready(&rewards) && fight_rewards::amount(&rewards) == 0);
    combat_rewards::fund(&mut pot, coin::mint_for_testing<KARES>(combat_rewards::initial_tokens(), scenario.ctx()));
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[@0xB], &clock, scenario.ctx());
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens());
    economy::destroy_for_testing(offering);
    staking::destroy_for_testing(pool);
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = aresrpg::fight_rewards)]
fun boss_allocation_requires_at_least_one_authoritative_winner() {
    let (mut scenario, offering, pool, mut pot, clock) = fixture(true);
    let mut rewards = fight_rewards::boss_for_testing(200);
    fight_rewards::allocate(&mut rewards, &offering, &mut pot, vector[], &clock, scenario.ctx());
    economy::destroy_for_testing(offering);
    staking::destroy_for_testing(pool);
    combat_rewards::destroy_for_testing(pot);
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
    aresrpg::version::test_init(scenario.ctx());
    scenario.next_tx(@0xA);
    let version = scenario.take_shared<aresrpg::version::Version>();
    aresrpg::api::prepare_boss_rewards_token(&mut fight, 0, &offering, &mut pot, &version, &clock, scenario.ctx());
    test_scenario::return_shared(version);
    assert!(combat_rewards::balance(&pot) == before && combat_rewards::work(&pot) == work);
    character::destroy(fight::take_party_authority_character_for_testing(fight));
    economy::destroy_for_testing(offering);
    staking::destroy_for_testing(pool);
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun unfunded_economy_settles_bosses_without_a_coin_or_pool() {
    let mut scenario = test_scenario::begin(@0xA);
    let economy = economy::unfunded_for_testing(scenario.ctx());
    let mut rewards = fight_rewards::boss_for_testing(200);
    assert!(!fight_rewards::ready(&rewards));
    fight_rewards::unfunded(&mut rewards, &economy);
    assert!(fight_rewards::ready(&rewards) && fight_rewards::amount(&rewards) == 0);
    fight_rewards::unfunded(&mut rewards, &economy);
    assert!(fight_rewards::amount(&rewards) == 0);
    economy::destroy_for_testing(economy);
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = aresrpg::fight_rewards)]
fun funded_economy_cannot_skip_mandatory_boss_rewards() {
    let (scenario, economy, pool, pot, clock) = fixture(true);
    let mut rewards = fight_rewards::boss_for_testing(200);
    fight_rewards::unfunded(&mut rewards, &economy);
    economy::destroy_for_testing(economy);
    staking::destroy_for_testing(pool);
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}
