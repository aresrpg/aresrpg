#[test_only]
module aresrpg_kares::offering_restart_tests;

use aresrpg_kares::kares::{Self, KARES};
use aresrpg_kares::offering::{Self, Contribution, Offering};
use aresrpg_kares::staking::{Self, StakingPool};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};

const OWNER: address = @0xA;
const TREASURY: address = @0xB;
const LIQUIDITY: address = @0xC;
const SALE: u64 = 400_000_000_000_000;
const WEEK: u64 = 604_800_000;

fun fixture(duration: u64): (Scenario, Offering, StakingPool, Clock) {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let genesis = kares::genesis_for_testing(scenario.ctx());
    let cap = sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx());
    offering::setup(genesis, cap, 50, 200, duration, TREASURY, LIQUIDITY, OWNER, OWNER, scenario.ctx());
    scenario.next_tx(TREASURY);
    let mut offering = scenario.take_shared<Offering>();
    let pool = scenario.take_shared<StakingPool>();
    offering::start(&mut offering, &clock, scenario.ctx());
    (scenario, offering, pool, clock)
}

fun finish(scenario: Scenario, offering: Offering, pool: StakingPool, clock: Clock) {
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    clock.destroy_for_testing();
    scenario.end();
}

fun claim_values(
    offering: &mut Offering, pool: &mut StakingPool, position: Contribution, clock: &Clock, ctx: &mut TxContext,
): (u64, u64) {
    let (tokens, refund) = offering::claim(offering, pool, position, clock, ctx);
    let (token_value, refund_value) = (tokens.value(), refund.value());
    coin::burn_for_testing(tokens);
    coin::burn_for_testing(refund);
    (token_value, refund_value)
}

#[test]
fun partial_refunds_roll_into_a_fresh_week_and_settle_once() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(WEEK);
    let refunded = offering::contribution_for_testing(&mut offering, 20, &clock, scenario.ctx());
    let mut retained = offering::contribution_for_testing(&mut offering, 25, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK + 1_000_000);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, refunded, &clock, scenario.ctx());
    assert!(tokens == 0 && refund == 20);
    assert!(offering::total_deposited(&offering) == 45 && offering::deposits(&offering) == 25);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::opens_ms(&offering) == WEEK + 1_000_000);
    assert!(offering::closes_ms(&offering) == 2 * WEEK + 1_000_000);
    assert!(offering::total_deposited(&offering) == 25);
    assert!(!offering::settled(&offering) && !staking::is_active(&pool));
    assert!(offering::community_claimable(&offering, &clock) == 0);
    offering::add_contribution(&mut offering, &mut retained, coin::mint_for_testing<SUI>(25, scenario.ctx()), &clock);
    let fresh = offering::contribution_for_testing(&mut offering, 250, &clock, scenario.ctx());
    assert!(offering::contribution_amount(&retained) == 50);
    assert!(offering::total_deposited(&offering) == 300 && offering::deposits(&offering) == 300);
    clock.increment_for_testing(WEEK);
    let (new_tokens, new_refund) = claim_values(&mut offering, &mut pool, fresh, &clock, scenario.ctx());
    assert!(offering::settled(&offering) && staking::is_active(&pool));
    assert!(offering::settled_ms(&offering) == 2 * WEEK + 1_000_000);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    let (old_tokens, old_refund) = claim_values(&mut offering, &mut pool, retained, &clock, scenario.ctx());
    assert!(old_tokens == ((50u128 * (SALE as u128)) / 300) as u64 && old_refund == 16);
    assert!(new_tokens == ((250u128 * (SALE as u128)) / 300) as u64 && new_refund == 83);
    assert!(old_tokens + new_tokens + offering::sale_tokens(&offering) == SALE);
    assert!(offering::deposits(&offering) == 1 && offering::accepted(&offering) == 200);
    assert!(offering::total_deposited(&offering) == 300);
    scenario.next_tx(TREASURY);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(TREASURY).length() == 1);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(LIQUIDITY).length() == 1);
    assert!(test_scenario::ids_for_address<Coin<KARES>>(LIQUIDITY).length() == 1);
    let treasury = scenario.take_from_address<Coin<SUI>>(TREASURY);
    let liquidity = scenario.take_from_address<Coin<SUI>>(LIQUIDITY);
    let liquidity_tokens = scenario.take_from_address<Coin<KARES>>(LIQUIDITY);
    assert!(treasury.value() == 120 && liquidity.value() == 80);
    assert!(liquidity_tokens.value() == 160_000_000_000_000);
    coin::burn_for_testing(treasury);
    coin::burn_for_testing(liquidity);
    coin::burn_for_testing(liquidity_tokens);
    finish(scenario, offering, pool, clock);
}

#[test]
fun fully_refunded_sale_restarts_from_zero_at_the_exact_close() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(WEEK);
    let first = offering::contribution_for_testing(&mut offering, 49, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, first, &clock, scenario.ctx());
    assert!(tokens == 0 && refund == 49);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::total_deposited(&offering) == 0 && offering::deposits(&offering) == 0);
    let next = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, next, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 0 && offering::accepted(&offering) == 50);
    finish(scenario, offering, pool, clock);
}

#[test]
fun repeated_failures_keep_unclaimed_receipts_refundable_until_the_next_restart() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(WEEK);
    let first = offering::contribution_for_testing(&mut offering, 20, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::total_deposited(&offering) == 20);
    let second = offering::contribution_for_testing(&mut offering, 29, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK + 100 * WEEK);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, first, &clock, scenario.ctx());
    assert!(tokens == 0 && refund == 20);
    assert!(offering::total_deposited(&offering) == 49);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::total_deposited(&offering) == 29);
    assert!(offering::closes_ms(&offering) == clock.timestamp_ms() + WEEK);
    clock.increment_for_testing(WEEK);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, second, &clock, scenario.ctx());
    assert!(tokens == 0 && refund == 29 && offering::deposits(&offering) == 0);
    assert!(!staking::is_active(&pool) && offering::sale_tokens(&offering) == SALE);
    assert!(offering::liquidity_tokens(&offering) == 160_000_000_000_000);
    assert!(offering::community_claimable(&offering, &clock) == 0);
    assert!(offering::settled_ms(&offering) == 0);
    finish(scenario, offering, pool, clock);
}

#[test]
fun empty_failed_sale_can_restart() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(WEEK);
    clock.increment_for_testing(WEEK);
    offering::start(&mut offering, &clock, scenario.ctx());
    assert!(offering::total_deposited(&offering) == 0 && offering::closes_ms(&offering) == 2 * WEEK);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EAlreadyStarted)]
fun a_live_sale_cannot_restart_even_one_millisecond_before_close() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(WEEK);
    clock.increment_for_testing(WEEK - 1);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EAlreadyStarted)]
fun a_successful_unsettled_sale_cannot_restart() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(WEEK);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    offering::start(&mut offering, &clock, scenario.ctx());
    std::unit_test::destroy(position);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EAlreadyStarted)]
fun a_settled_sale_cannot_restart_even_when_its_escrow_is_empty() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(WEEK);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(offering::deposits(&offering) == 0);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotTreasury)]
fun only_the_treasury_can_restart_a_failed_sale() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(WEEK);
    clock.increment_for_testing(WEEK);
    scenario.next_tx(OWNER);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotClaimable)]
fun restart_relocks_a_retained_receipt_until_the_new_close() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(WEEK);
    let retained = offering::contribution_for_testing(&mut offering, 49, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK);
    offering::start(&mut offering, &clock, scenario.ctx());
    clock.increment_for_testing(WEEK - 1);
    claim_values(&mut offering, &mut pool, retained, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotOpen)]
fun a_failed_sale_cannot_take_new_money_until_the_treasury_restarts_it() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(WEEK);
    clock.increment_for_testing(WEEK);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    std::unit_test::destroy(position);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::EInvalidTerms)]
fun a_restart_cannot_overflow_its_new_closing_time() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(18_446_744_073_709_551_615);
    clock.increment_for_testing(18_446_744_073_709_551_615);
    offering::start(&mut offering, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}
