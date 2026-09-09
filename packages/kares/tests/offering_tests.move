#[test_only]
module aresrpg_kares::offering_tests;

use aresrpg_kares::kares::{Self, KARES};
use aresrpg_kares::combat_rewards::{Self, CombatPot};
use aresrpg_kares::offering::{Self, Contribution, Offering};
use aresrpg_kares::staking::{Self, StakingPool};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};

const OWNER: address = @0xA;
const BUYER: address = @0xB;
const TREASURY: address = @0xC;
const LIQUIDITY: address = @0xD;
const COMMUNITY: address = @0xE;
const SALE: u64 = 400_000_000_000_000;

fun upgrade_cap(scenario: &mut Scenario): sui::package::UpgradeCap {
    sui::package::test_publish(object::id_from_address(@aresrpg_kares), scenario.ctx())
}

fun fixture(minimum: u64, maximum: u64): (Scenario, Offering, StakingPool, Clock) {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let genesis = kares::genesis_for_testing(scenario.ctx());
    offering::setup(genesis, upgrade_cap(&mut scenario), minimum, maximum, 100,
        TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    scenario.next_tx(TREASURY);
    let mut offering = scenario.take_shared<Offering>();
    offering::start(&mut offering, &clock, scenario.ctx());
    let pool = scenario.take_shared<StakingPool>();
    scenario.next_tx(BUYER);
    (scenario, offering, pool, clock)
}

fun finish(scenario: Scenario, offering: Offering, pool: StakingPool, clock: Clock) {
    test_scenario::return_shared(offering);
    test_scenario::return_shared(pool);
    clock.destroy_for_testing();
    scenario.end();
}

fun claim_values(
    offering: &mut Offering, pool: &mut StakingPool, contribution: Contribution, clock: &Clock, ctx: &mut TxContext,
): (u64, u64) {
    let (kares, sui) = offering::claim(offering, pool, contribution, clock, ctx);
    let (kares_value, sui_value) = (kares.value(), sui.value());
    coin::burn_for_testing(kares);
    coin::burn_for_testing(sui);
    (kares_value, sui_value)
}

#[test]
fun setup_allocations_and_immutable_terms_match_the_launch() {
    let (scenario, offering, pool, clock) = fixture(50, 200);
    assert!(offering::pool(&offering) == object::id(&pool));
    assert!(offering::minimum(&offering) == 50 && offering::maximum(&offering) == 200);
    assert!(offering::opens_ms(&offering) == 0 && offering::closes_ms(&offering) == 100);
    assert!(offering::treasury(&offering) == TREASURY && offering::liquidity(&offering) == LIQUIDITY);
    assert!(offering::total_deposited(&offering) == 0 && offering::accepted(&offering) == 0);
    assert!(!offering::settled(&offering) && !staking::is_active(&pool));
    assert!(offering::deposits(&offering) == 0 && offering::sale_tokens(&offering) == SALE);
    assert!(offering::liquidity_tokens(&offering) == 160_000_000_000_000);
    assert!(staking::kares_rewards(&pool) == 200_000_000_000_000 && staking::principal(&pool) == 0);
    let team_tokens = scenario.take_from_address<Coin<KARES>>(OWNER);
    assert!(test_scenario::ids_for_address<Coin<KARES>>(COMMUNITY).is_empty());
    assert!(test_scenario::ids_for_address<Coin<KARES>>(TREASURY).is_empty());
    assert!(offering::community_remaining(&offering) == 110_000_000_000_000);
    assert!(offering::community_claimable(&offering, &clock) == 0 && offering::settled_ms(&offering) == 0);
    let metadata_cap = scenario.take_from_address<sui::coin_registry::MetadataCap<KARES>>(COMMUNITY);
    assert!(test_scenario::ids_for_address<sui::coin_registry::MetadataCap<KARES>>(OWNER).is_empty());
    let currency = scenario.take_from_address<sui::coin_registry::Currency<KARES>>(@0xC);
    assert!(currency.metadata_cap_id() == option::some(object::id(&metadata_cap)));
    assert!(currency.is_supply_burn_only());
    test_scenario::return_to_address(@0xC, currency);
    test_scenario::return_to_address(COMMUNITY, metadata_cap);
    assert!(team_tokens.value() == 30_000_000_000_000);
    coin::burn_for_testing(team_tokens);
    finish(scenario, offering, pool, clock);
}

#[test]
fun minimum_success_allocates_exact_40_60_and_activates_staking() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    assert!(staking::is_active(&pool) && offering::settled(&offering));
    assert!(offering::settled_ms(&offering) == 100);
    assert!(offering::accepted(&offering) == 50 && offering::deposits(&offering) == 0);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 0);
    scenario.next_tx(OWNER);
    let liquidity_sui = scenario.take_from_address<Coin<SUI>>(LIQUIDITY);
    let treasury_sui = scenario.take_from_address<Coin<SUI>>(TREASURY);
    let liquidity_tokens = scenario.take_from_address<Coin<KARES>>(LIQUIDITY);
    assert!(liquidity_sui.value() == 20 && treasury_sui.value() == 30);
    assert!(liquidity_tokens.value() == 160_000_000_000_000);
    coin::burn_for_testing(liquidity_sui);
    coin::burn_for_testing(treasury_sui);
    coin::burn_for_testing(liquidity_tokens);
    finish(scenario, offering, pool, clock);
}

#[test]
fun oversubscription_conserves_escrow_with_rounding_in_reverse_claim_order() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(2, 4);
    let first = offering::contribution_for_testing(&mut offering, 2, &clock, scenario.ctx());
    let second = offering::contribution_for_testing(&mut offering, 3, &clock, scenario.ctx());
    let third = offering::contribution_for_testing(&mut offering, 4, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    let (tokens_third, refund_third) = claim_values(&mut offering, &mut pool, third, &clock, scenario.ctx());
    let (tokens_first, refund_first) = claim_values(&mut offering, &mut pool, first, &clock, scenario.ctx());
    let (tokens_second, refund_second) = claim_values(&mut offering, &mut pool, second, &clock, scenario.ctx());
    assert!(tokens_first == (2 * (SALE as u128) / 9) as u64);
    assert!(tokens_second == (3 * (SALE as u128) / 9) as u64);
    assert!(tokens_third == (4 * (SALE as u128) / 9) as u64);
    assert!(refund_first == 1 && refund_second == 1 && refund_third == 2);
    assert!(offering::deposits(&offering) == 1);
    assert!(tokens_first + tokens_second + tokens_third + offering::sale_tokens(&offering) == SALE);
    finish(scenario, offering, pool, clock);
}

#[test]
fun below_minimum_refunds_full_contributions_without_leaking_inventory() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 49, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(tokens == 0 && refund == 49);
    assert!(offering::sale_tokens(&offering) == SALE);
    assert!(offering::liquidity_tokens(&offering) == 160_000_000_000_000);
    assert!(!staking::is_active(&pool));
    assert!(!test_scenario::has_most_recent_for_address<Coin<SUI>>(TREASURY));
    finish(scenario, offering, pool, clock);
}

#[test]
fun maximum_u64_deposits_conserve_escrow_and_allocation() {
    let maximum = 18_446_744_073_709_551_615;
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(1, 20_000_000_000);
    let large = offering::contribution_for_testing(&mut offering, maximum - 1, &clock, scenario.ctx());
    let dust = offering::contribution_for_testing(&mut offering, 1, &clock, scenario.ctx());
    assert!(offering::total_deposited(&offering) == maximum);
    clock.increment_for_testing(100);
    let (dust_tokens, dust_refund) = claim_values(&mut offering, &mut pool, dust, &clock, scenario.ctx());
    let (large_tokens, large_refund) = claim_values(&mut offering, &mut pool, large, &clock, scenario.ctx());
    assert!(dust_tokens == 0 && dust_refund == 0);
    assert!(large_tokens == SALE - 1 && offering::sale_tokens(&offering) == 1);
    assert!(large_refund == maximum - 20_000_000_000 - 1);
    assert!(offering::deposits(&offering) == 1);
    assert!(offering::accepted(&offering) + large_refund + offering::deposits(&offering) == maximum);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(arithmetic_error, location = aresrpg_kares::offering)]
fun overflowing_deposits_abort_instead_of_wrapping() {
    let (mut scenario, mut offering, pool, clock) = fixture(1, 20_000_000_000);
    let large = offering::contribution_for_testing(&mut offering, 18_446_744_073_709_551_615, &clock, scenario.ctx());
    let extra = offering::contribution_for_testing(&mut offering, 1, &clock, scenario.ctx());
    std::unit_test::destroy(large);
    std::unit_test::destroy(extra);
    finish(scenario, offering, pool, clock);
}

#[test]
fun late_claim_preserves_an_oversubscribed_sale() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 500, &clock, scenario.ctx());
    clock.increment_for_testing(200);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 300);
    assert!(staking::is_active(&pool) && offering::accepted(&offering) == 200);
    finish(scenario, offering, pool, clock);
}

#[test]
fun public_contribution_aggregates_only_into_the_bound_sale() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let payment = coin::mint_for_testing<SUI>(10, scenario.ctx());
    offering::contribute(&mut offering, payment, &clock, scenario.ctx());
    scenario.next_tx(BUYER);
    let mut position = scenario.take_from_sender<Contribution>();
    assert!(offering::contribution_offering(&position) == object::id(&offering));
    offering::add_contribution(&mut offering, &mut position, coin::mint_for_testing<SUI>(40, scenario.ctx()), &clock);
    assert!(offering::contribution_amount(&position) == 50);
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 0);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 5, location = aresrpg_kares::offering)]
fun subscriptions_cannot_be_withdrawn_early() {
    let (mut scenario, mut offering, mut pool, clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 1, &clock, scenario.ctx());
    claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 4, location = aresrpg_kares::offering)]
fun settlement_cannot_happen_before_close() {
    let (mut scenario, mut offering, mut pool, clock) = fixture(50, 200);
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(50, scenario.ctx()), &clock, scenario.ctx());
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test]
fun repeated_settlement_preserves_allocations() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(50, scenario.ctx()), &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test]
fun successful_sale_can_distribute_proceeds_long_after_close() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(50, scenario.ctx()), &clock, scenario.ctx());
    clock.increment_for_testing(VESTING_DURATION);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 4, location = aresrpg_kares::offering)]
fun below_minimum_cannot_settle() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(49, scenario.ctx()), &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_kares::offering)]
fun contributions_close_at_exact_boundary() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(50, 200);
    clock.increment_for_testing(100);
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(1, scenario.ctx()), &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 3, location = aresrpg_kares::offering)]
fun zero_contribution_is_rejected() {
    let (mut scenario, mut offering, pool, clock) = fixture(50, 200);
    offering::contribute(&mut offering, coin::zero<SUI>(scenario.ctx()), &clock, scenario.ctx());
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun reversed_raise_limits_are_rejected() {
    let (scenario, offering, pool, clock) = fixture(200, 50);
    finish(scenario, offering, pool, clock);
}

#[test]
fun successful_claim_finalizes_without_the_treasury() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 0);
    assert!(offering::settled(&offering) && staking::is_active(&pool));
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 6, location = aresrpg_kares::offering)]
fun settlement_rejects_a_substituted_pool() {
    let (mut scenario, mut offering, pool, mut clock) = fixture(50, 200);
    let mut other = staking::create(coin::mint_for_testing<KARES>(200_000_000_000_000, scenario.ctx()).into_balance(), scenario.ctx());
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(50, scenario.ctx()), &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut other, &clock, scenario.ctx());
    staking::destroy_for_testing(other);
    finish(scenario, offering, pool, clock);
}

fun second_offering(scenario: &mut Scenario, clock: &Clock): Offering {
    let genesis = kares::genesis_for_testing(scenario.ctx());
    offering::setup(genesis, upgrade_cap(scenario), 50, 200, 100, TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    scenario.next_tx(TREASURY);
    let mut offering = scenario.take_shared<Offering>();
    offering::start(&mut offering, clock, scenario.ctx());
    scenario.next_tx(BUYER);
    offering
}

#[test, expected_failure(abort_code = 2, location = aresrpg_kares::offering)]
fun claims_reject_a_position_from_another_sale() {
    let (mut scenario, mut offering, mut pool, clock) = fixture(50, 200);
    let mut other = second_offering(&mut scenario, &clock);
    let position = offering::contribution_for_testing(&mut other, 1, &clock, scenario.ctx());
    claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    test_scenario::return_shared(other);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_kares::offering)]
fun deposits_reject_a_position_from_another_sale() {
    let (mut scenario, mut offering, mut pool, clock) = fixture(50, 200);
    let mut other = second_offering(&mut scenario, &clock);
    let mut position = offering::contribution_for_testing(&mut other, 1, &clock, scenario.ctx());
    offering::add_contribution(&mut offering, &mut position, coin::mint_for_testing<SUI>(1, scenario.ctx()), &clock);
    claim_values(&mut other, &mut pool, position, &clock, scenario.ctx());
    test_scenario::return_shared(other);
    finish(scenario, offering, pool, clock);
}

fun setup_terms(minimum: u64, duration: u64, recipients: vector<address>) {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    offering::setup(kares::genesis_for_testing(scenario.ctx()), upgrade_cap(&mut scenario), minimum, 200, duration,
        recipients[0], recipients[1], recipients[2], recipients[3], scenario.ctx());
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun zero_minimum_is_rejected() { setup_terms(0, 100, vector[TREASURY, LIQUIDITY, OWNER, COMMUNITY]) }

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun empty_subscription_window_is_rejected() { setup_terms(50, 0, vector[TREASURY, LIQUIDITY, OWNER, COMMUNITY]) }

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun zero_treasury_is_rejected() { setup_terms(50, 100, vector[@0, LIQUIDITY, OWNER, COMMUNITY]) }

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun zero_liquidity_recipient_is_rejected() { setup_terms(50, 100, vector[TREASURY, @0, OWNER, COMMUNITY]) }

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun zero_team_is_rejected() { setup_terms(50, 100, vector[TREASURY, LIQUIDITY, @0, COMMUNITY]) }

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::offering)]
fun zero_community_recipient_is_rejected() { setup_terms(50, 100, vector[TREASURY, LIQUIDITY, OWNER, @0]) }

#[test]
fun configuration_keeps_the_sale_paused_until_start() {
    let mut scenario = test_scenario::begin(OWNER);
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.increment_for_testing(1);
    offering::setup(kares::genesis_for_testing(scenario.ctx()), upgrade_cap(&mut scenario), 50, 200, 100,
        TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    scenario.next_tx(BUYER);
    let offering = scenario.take_shared<Offering>();
    assert!(!offering::started(&offering));
    assert!(offering::opens_ms(&offering) == 0 && offering::closes_ms(&offering) == 0);
    test_scenario::return_shared(offering);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_kares::offering)]
fun subscription_cannot_start_before_activation() {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    offering::setup(kares::genesis_for_testing(scenario.ctx()), upgrade_cap(&mut scenario), 50, 200, 100,
        TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    scenario.next_tx(BUYER);
    let mut offering = scenario.take_shared<Offering>();
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(1, scenario.ctx()), &clock, scenario.ctx());
    test_scenario::return_shared(offering);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun claimed_position_is_consumed_and_genesis_does_not_survive_setup() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    assert!(test_scenario::ids_for_address<kares::Genesis>(OWNER).is_empty());
    offering::contribute(&mut offering, coin::mint_for_testing<SUI>(1, scenario.ctx()), &clock, scenario.ctx());
    scenario.next_tx(BUYER);
    let position = scenario.take_from_sender<Contribution>();
    clock.increment_for_testing(100);
    claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    scenario.next_tx(BUYER);
    assert!(test_scenario::ids_for_address<Contribution>(BUYER).is_empty());
    finish(scenario, offering, pool, clock);
}

const COMMUNITY_SUPPLY: u64 = 110_000_000_000_000;
const VESTING_DURATION: u64 = 1_825 * 86_400_000;

fun vested_fixture(): (Scenario, Offering, StakingPool, Clock) {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    let position = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
    scenario.next_tx(TREASURY);
    (scenario, offering, pool, clock)
}

#[test]
fun treasury_claims_five_year_reserve_incrementally_without_waiting_for_stakers() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    assert!(offering::community_claimable(&offering, &clock) == 0);
    assert!(staking::principal(&pool) == 0 && staking::active_ms(&pool) == 0);
    let mut claimed = 0;
    (5u64).do!(|_| {
        clock.increment_for_testing(VESTING_DURATION / 5);
        let payment = offering::claim_community(&mut offering, &clock, scenario.ctx());
        assert!(payment.value() == COMMUNITY_SUPPLY / 5);
        claimed = claimed + payment.value();
        assert!(claimed + offering::community_remaining(&offering) == COMMUNITY_SUPPLY);
        assert!(offering::community_claimable(&offering, &clock) == 0);
        transfer::public_transfer(payment, TREASURY);
    });
    assert!(claimed == COMMUNITY_SUPPLY && offering::community_remaining(&offering) == 0);
    assert!(staking::principal(&pool) == 0 && staking::active_ms(&pool) == 0);
    finish(scenario, offering, pool, clock);
}

#[test]
fun frequent_claims_preserve_fractional_release_and_the_final_base_unit() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    let mut claimed = 0;
    (100u64).do!(|_| {
        clock.increment_for_testing(1);
        let payment = offering::claim_community(&mut offering, &clock, scenario.ctx());
        claimed = claimed + payment.value();
        coin::burn_for_testing(payment);
    });
    assert!(claimed == (((COMMUNITY_SUPPLY as u128) * 100) / (VESTING_DURATION as u128)) as u64);
    clock.increment_for_testing(VESTING_DURATION - 101);
    let payment = offering::claim_community(&mut offering, &clock, scenario.ctx());
    claimed = claimed + payment.value();
    coin::burn_for_testing(payment);
    assert!(claimed < COMMUNITY_SUPPLY && offering::community_remaining(&offering) > 0);
    clock.increment_for_testing(1);
    let payment = offering::claim_community(&mut offering, &clock, scenario.ctx());
    claimed = claimed + payment.value();
    coin::burn_for_testing(payment);
    assert!(claimed == COMMUNITY_SUPPLY && offering::community_remaining(&offering) == 0);
    finish(scenario, offering, pool, clock);
}

#[test]
fun treasury_may_permanently_burn_unlocked_community_tokens() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    clock.increment_for_testing(VESTING_DURATION * 2);
    let payment = offering::claim_community(&mut offering, &clock, scenario.ctx());
    assert!(payment.value() == COMMUNITY_SUPPLY);
    let mut currency = scenario.take_from_address<sui::coin_registry::Currency<KARES>>(@0xC);
    kares::burn(&mut currency, payment);
    assert!(currency.total_supply() == option::some(1_000_000 * kares::unit() - COMMUNITY_SUPPLY));
    test_scenario::return_to_address(@0xC, currency);
    assert!(offering::community_remaining(&offering) == 0);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 7, location = aresrpg_kares::offering)]
fun publisher_cannot_claim_the_treasury_reserve() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    clock.increment_for_testing(VESTING_DURATION);
    scenario.next_tx(OWNER);
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 7, location = aresrpg_kares::offering)]
fun metadata_owner_cannot_claim_the_treasury_reserve() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    clock.increment_for_testing(VESTING_DURATION);
    scenario.next_tx(COMMUNITY);
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 8, location = aresrpg_kares::offering)]
fun settlement_does_not_unlock_any_community_tokens_immediately() {
    let (mut scenario, mut offering, pool, clock) = vested_fixture();
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 8, location = aresrpg_kares::offering)]
fun a_community_claim_cannot_be_replayed_at_the_same_time() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    clock.increment_for_testing(1);
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = 8, location = aresrpg_kares::offering)]
fun an_exhausted_community_reserve_cannot_be_claimed_again() {
    let (mut scenario, mut offering, pool, mut clock) = vested_fixture();
    clock.increment_for_testing(VESTING_DURATION);
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    clock.increment_for_testing(1);
    coin::burn_for_testing(offering::claim_community(&mut offering, &clock, scenario.ctx()));
    finish(scenario, offering, pool, clock);
}

#[test]
fun failed_offerings_never_start_community_vesting() {
    vector[1, 49].do!(|amount| {
        let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
        let position = offering::contribution_for_testing(&mut offering, amount, &clock, scenario.ctx());
        clock.increment_for_testing(VESTING_DURATION);
        let (tokens, refund) = claim_values(&mut offering, &mut pool, position, &clock, scenario.ctx());
        assert!(tokens == 0 && refund == amount);
        assert!(offering::community_claimable(&offering, &clock) == 0);
        assert!(offering::community_remaining(&offering) == COMMUNITY_SUPPLY);
        finish(scenario, offering, pool, clock);
    });
}

#[test, expected_failure(abort_code = 9, location = aresrpg_kares::offering)]
fun setup_cannot_burn_an_unrelated_upgrade_cap_instead_of_its_own() {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let cap = sui::package::test_publish(object::id_from_address(@0xBAD), scenario.ctx());
    offering::setup(kares::genesis_for_testing(scenario.ctx()), cap, 50, 200, 100,
        TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 9, location = aresrpg_kares::offering)]
fun setup_rejects_a_capability_with_upgrade_history() {
    let mut scenario = test_scenario::begin(OWNER);
    let clock = clock::create_for_testing(scenario.ctx());
    let mut cap = sui::package::test_publish(object::id_from_address(@0xBAD), scenario.ctx());
    let ticket = sui::package::authorize_upgrade(&mut cap, sui::package::compatible_policy(), vector[]);
    sui::package::commit_upgrade(&mut cap, sui::package::test_upgrade(ticket));
    assert!(sui::package::version(&cap) == 2);
    offering::setup(kares::genesis_for_testing(scenario.ctx()), cap, 50, 200, 100,
        TREASURY, LIQUIDITY, OWNER, COMMUNITY, scenario.ctx());
    clock.destroy_for_testing();
    scenario.end();
}

public struct TestVictory has drop {}

#[test]
fun combat_reserve_is_linked_seeded_once_and_locked_until_success() {
    let (mut scenario, mut offering, mut pool, mut clock) = fixture(50, 200);
    test_scenario::return_shared(offering);
    scenario.next_tx(TREASURY);
    offering = scenario.take_shared<Offering>();
    let mut pot = scenario.take_shared<CombatPot>();
    assert!(offering::combat_pot(&offering) == object::id(&pot));
    assert!(offering::combat_remaining(&offering) == combat_rewards::initial_tokens());
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    offering::authorize_combat<TestVictory>(&offering, &mut pot, scenario.ctx());
    assert!(offering::combat_remaining(&offering) == 0);
    assert!(combat_rewards::balance(&pot) == combat_rewards::initial_tokens());
    offering::boss_bounty(&offering, &mut pot, TestVictory {}, 20_000, 1, &clock, scenario.ctx()).destroy_zero();
    let contribution = offering::contribution_for_testing(&mut offering, 50, &clock, scenario.ctx());
    clock.increment_for_testing(100);
    offering::settle(&mut offering, &mut pool, &clock, scenario.ctx());
    let (tokens, refund) = claim_values(&mut offering, &mut pool, contribution, &clock, scenario.ctx());
    assert!(tokens == SALE && refund == 0);
    let bounty = offering::boss_bounty(&offering, &mut pot, TestVictory {}, 200, 3, &clock, scenario.ctx());
    assert!(bounty.value() == (combat_rewards::daily_budget() / 100 / 3) * 3);
    bounty.destroy_for_testing();
    test_scenario::return_shared(pot);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotTreasury)]
fun outsiders_cannot_seed_combat() {
    let (mut scenario, mut offering, pool, clock) = fixture(50, 200);
    let mut pot = scenario.take_shared<CombatPot>();
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    test_scenario::return_shared(pot);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ENotTreasury)]
fun outsiders_cannot_authorize_a_forged_witness() {
    let (mut scenario, offering, pool, clock) = fixture(50, 200);
    let mut pot = scenario.take_shared<CombatPot>();
    offering::authorize_combat<TestVictory>(&offering, &mut pot, scenario.ctx());
    test_scenario::return_shared(pot);
    finish(scenario, offering, pool, clock);
}

#[test, expected_failure(abort_code = offering::ECombatAlreadyFunded)]
fun combat_reserve_cannot_be_seeded_twice() {
    let (mut scenario, offering, pool, clock) = fixture(50, 200);
    test_scenario::return_shared(offering);
    scenario.next_tx(TREASURY);
    let mut offering = scenario.take_shared<Offering>();
    let mut pot = scenario.take_shared<CombatPot>();
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    offering::seed_combat(&mut offering, &mut pot, scenario.ctx());
    test_scenario::return_shared(pot);
    finish(scenario, offering, pool, clock);
}
