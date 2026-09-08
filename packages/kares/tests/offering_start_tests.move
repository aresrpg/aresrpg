#[test_only]
module aresrpg_kares::offering_start_tests;

use aresrpg_kares::kares;
use aresrpg_kares::offering::{Self, Offering};
use aresrpg_kares::staking::{Self, StakingPool};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::test_scenario::{Self, Scenario};

const OWNER: address = @0xA;
const TREASURY: address = @0xB;

fun configured(duration: u64): (Scenario, Offering, StakingPool, Clock) {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let genesis = kares::genesis_for_testing(scenario.ctx());
    let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
    offering::setup(genesis, cap, 5, 20, duration, TREASURY, OWNER, OWNER, OWNER, scenario.ctx());
    scenario.next_tx(TREASURY);
    let offering = scenario.take_shared<Offering>();
    let pool = scenario.take_shared<StakingPool>();
    (scenario, offering, pool, clock)
}

fun finish(scenario: Scenario, offering: Offering, pool: StakingPool, clock: Clock) {
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    clock.destroy_for_testing();
    scenario.end();
}

fun starts_from_native_time(duration: u64) {
    let (mut scenario, mut offering, mut pool, mut clock) = configured(duration);
    assert!(!offering::started(&offering));
    assert!(offering::duration_ms(&offering) == duration);
    clock.increment_for_testing(10_000_000);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::started(&offering));
    assert!(offering::opens_ms(&offering) == 10_000_000);
    assert!(offering::closes_ms(&offering) == 10_000_000 + duration);
    let contribution = offering::contribution_for_testing(&mut offering, 10, &clock, scenario.ctx());
    clock.increment_for_testing(duration);
    let (tokens, refund) = offering::claim(&mut offering, &mut pool, contribution, &clock, scenario.ctx());
    assert!(tokens.value() == 400_000_000_000_000 && refund.value() == 0);
    assert!(offering::settled(&offering) && staking::is_active(&pool));
    coin::burn_for_testing(tokens);
    coin::burn_for_testing(refund);
    finish(scenario, offering, pool, clock);
}

#[test]
fun testnet_sale_lasts_fifteen_minutes_from_the_explicit_start() { starts_from_native_time(900_000) }

#[test]
fun mainnet_sale_lasts_seven_days_from_the_explicit_start() { starts_from_native_time(604_800_000) }

#[test, expected_failure(abort_code = offering::ENotTreasury)]
fun only_the_configured_treasury_can_start() {
    let (mut scenario, mut offering, pool, clock) = configured(100);
    scenario.next_tx(OWNER);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EAlreadyStarted)]
fun even_a_zero_timestamp_cannot_be_started_twice() {
    let (mut scenario, mut offering, pool, clock) = configured(100);
    offering::start(&mut offering, &clock, scenario.ctx());
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EInvalidTerms)]
fun the_start_cannot_overflow_its_final_boundary() {
    let (mut scenario, mut offering, pool, mut clock) = configured(18_446_744_073_709_551_615);
    clock.increment_for_testing(1);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotSettleable)]
fun time_alone_cannot_settle_an_unstarted_offering() {
    let (mut scenario, mut offering, mut pool, mut clock) = configured(100);
    clock.increment_for_testing(1_000_000);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EWrongPool)]
fun a_claim_cannot_finalize_into_another_staking_pool() {
    let (mut scenario, mut offering, pool, mut clock) = configured(100);
    offering::start(&mut offering, &clock, scenario.ctx());
    let contribution = offering::contribution_for_testing(&mut offering, 10, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    let mut other = staking::create(coin::mint_for_testing<kares::KARES>(200_000_000_000_000, scenario.ctx()).into_balance(), scenario.ctx());
    let (tokens, refund) = offering::claim(&mut offering, &mut other, contribution, &clock, scenario.ctx());
    coin::burn_for_testing(tokens);
    coin::burn_for_testing(refund);
    staking::destroy_for_testing(other);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotClaimable)]
fun even_a_funded_sale_cannot_return_a_contribution_in_the_same_transaction() {
    let (mut scenario, mut offering, mut pool, clock) = configured(100);
    offering::start(&mut offering, &clock, scenario.ctx());
    let contribution = offering::contribution_for_testing(&mut offering, 20, &clock, scenario.ctx());
    let (tokens, refund) = offering::claim(&mut offering, &mut pool, contribution, &clock, scenario.ctx());
    coin::burn_for_testing(tokens);
    coin::burn_for_testing(refund);
    finish(scenario, offering, pool, clock);
}
