#[test_only]
module aresrpg_kares::combat_rewards_tests;

use aresrpg_kares::combat_rewards::{Self, CombatPot};
use sui::{clock::{Self, Clock}, coin, test_scenario::{Self, Scenario}};

public struct Victory has drop {}
public struct ForeignVictory has drop {}
const DAY: u64 = 86_400_000;
const UNIT: u64 = 1_000_000_000;

fun fixture(): (Scenario, CombatPot, Clock) {
    let mut scenario = test_scenario::begin(@0xA);
    let mut pot = combat_rewards::create(scenario.ctx());
    combat_rewards::fund(&mut pot, coin::mint_for_testing(combat_rewards::initial_tokens(), scenario.ctx()));
    let clock = clock::create_for_testing(scenario.ctx());
    (scenario, pot, clock)
}

fun payout(pot: &mut CombatPot, weight: u64, winners: u64, clock: &Clock, scenario: &mut Scenario): u64 {
    let coin = combat_rewards::take(pot, Victory {}, weight, winners, 0, clock, scenario.ctx()).into_coin(scenario.ctx());
    let value = coin.value();
    coin::burn_for_testing(coin);
    value
}

fun finish(scenario: Scenario, pot: CombatPot, clock: Clock) {
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun only_authorized_work_pays_and_party_size_cannot_multiply_it() {
    let (mut scenario, mut pot, clock) = fixture();
    assert!(payout(&mut pot, 200, 1, &clock, &mut scenario) == 0);
    combat_rewards::authorize<Victory>(&mut pot);
    let foreign = combat_rewards::take(&mut pot, ForeignVictory {}, 200, 1, 0, &clock, scenario.ctx());
    foreign.destroy_zero();
    assert!(payout(&mut pot, 0, 1, &clock, &mut scenario) == 0);
    assert!(payout(&mut pot, 200, 0, &clock, &mut scenario) == 0);
    let single = payout(&mut pot, 200, 1, &clock, &mut scenario);
    let party = payout(&mut pot, 200, 6, &clock, &mut scenario);
    assert!(single == combat_rewards::daily_budget() / 100);
    assert!(party == (single / 6) * 6);
    assert!(combat_rewards::spent(&pot) == single + party);
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens() - single - party);
    assert!(combat_rewards::work(&pot) == 400);
    finish(scenario, pot, clock);
}

#[test]
fun deposits_and_authority_rotation_never_refill_an_exhausted_day() {
    let (mut scenario, mut pot, mut clock) = fixture();
    combat_rewards::authorize<Victory>(&mut pot);
    let budget = combat_rewards::daily_budget();
    assert!(payout(&mut pot, 20_000, 1, &clock, &mut scenario) == budget);
    combat_rewards::fund(&mut pot, coin::mint_for_testing(10_000 * UNIT, scenario.ctx()));
    combat_rewards::authorize<ForeignVictory>(&mut pot);
    combat_rewards::authorize<Victory>(&mut pot);
    assert!(payout(&mut pot, 180_000, 1, &clock, &mut scenario) == 0);
    assert!(combat_rewards::work(&pot) == 200_000);
    assert!(combat_rewards::quota(&pot) == 20_000);
    assert!(combat_rewards::balance(&pot) == 110_000 * UNIT - budget);
    // One hundred quiet days do not become one hundred budgets of catch-up.
    clock.set_for_testing(100 * DAY);
    assert!(payout(&mut pot, 20_000, 1, &clock, &mut scenario) == budget);
    finish(scenario, pot, clock);
}

#[test]
fun epoch_adjustment_measures_all_work_and_normalizes_real_elapsed_time() {
    let (mut scenario, mut pot, mut clock) = fixture();
    combat_rewards::authorize<Victory>(&mut pot);
    payout(&mut pot, 200_000, 1, &clock, &mut scenario);
    scenario.later_epoch(DAY, @0xA);
    clock.set_for_testing(DAY);
    let reward = payout(&mut pot, 200, 1, &clock, &mut scenario);
    assert!(combat_rewards::quota(&pot) == 110_000);
    assert!(reward == combat_rewards::daily_budget() * 200 / 110_000);
    assert!(combat_rewards::work(&pot) == 200);
    // Ten elapsed days, including unobserved epochs, dilute activity rather than accruing debt.
    scenario.later_epoch(10 * DAY, @0xA);
    clock.set_for_testing(11 * DAY);
    payout(&mut pot, 200, 1, &clock, &mut scenario);
    assert!(combat_rewards::quota(&pot) == 55_010);
    scenario.later_epoch(DAY, @0xA);
    clock.set_for_testing(12 * DAY);
    payout(&mut pot, 200, 1, &clock, &mut scenario);
    scenario.later_epoch(DAY, @0xA);
    clock.set_for_testing(13 * DAY);
    payout(&mut pot, 200, 1, &clock, &mut scenario);
    assert!(combat_rewards::quota(&pot) == 20_000);
    finish(scenario, pot, clock);
}

#[test]
fun five_years_exhaust_only_the_initial_funding_and_topups_extend_runway() {
    let (mut scenario, mut pot, mut clock) = fixture();
    combat_rewards::authorize<Victory>(&mut pot);
    let mut total = 0;
    let mut day = 0;
    while (day < 1_826) {
        clock.set_for_testing(day * DAY);
        total = total + payout(&mut pot, 20_000, 1, &clock, &mut scenario);
        day = day + 1;
    };
    assert!(total == combat_rewards::initial_tokens());
    assert!(combat_rewards::balance(&pot) == 0);
    clock.set_for_testing(day * DAY);
    assert!(payout(&mut pot, 200, 1, &clock, &mut scenario) == 0);
    combat_rewards::fund(&mut pot, coin::mint_for_testing(UNIT, scenario.ctx()));
    assert!(payout(&mut pot, 200, 1, &clock, &mut scenario) == combat_rewards::daily_budget() / 100);
    finish(scenario, pot, clock);
}
