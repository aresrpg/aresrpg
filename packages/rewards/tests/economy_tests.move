#[test_only]
module aresrpg_rewards::economy_tests;

use aresrpg_rewards::{amounts, combat_rewards::{Self, CombatPot}, community::{Self, CommunityPool},
    economy::{Self, Economy}, staking::{Self, StakingPool}, test_coin::{Self, TEST_COIN, Victory}};
use sui::{clock, coin, package, test_scenario};

fun setup(supply: u64, decimals: u8, burnable: bool, cap_package: address, treasury: address) {
    let mut scenario = test_scenario::begin(treasury);
    economy::init_for_testing(scenario.ctx());
    test_coin::mint(supply, decimals, burnable, scenario.ctx());
    scenario.next_tx(treasury);
    let (currency, reserve) = test_coin::take(&scenario);
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock.increment_for_testing(123);
    let cap = package::test_publish(cap_package.to_id(), scenario.ctx());
    let mut economy = scenario.take_shared<Economy>();
    assert!(!economy::is_funded(&economy));
    economy::setup<TEST_COIN, Victory>(scenario.take_from_sender<economy::Setup>(), &mut economy, &cap,
        &currency, reserve, treasury, &clock, scenario.ctx());
    test_scenario::return_shared(economy);
    transfer::public_transfer(cap, scenario.ctx().sender());
    scenario.next_tx(treasury);
    let retained_cap = scenario.take_from_sender<package::UpgradeCap>();
    assert!(package::upgrade_package(&retained_cap) == cap_package.to_id());
    assert!(package::version(&retained_cap) == 1);
    test_scenario::return_to_sender(&scenario, retained_cap);
    let economy = scenario.take_shared<Economy>();
    economy::assert_currency(&economy, &currency);
    let mut pool = scenario.take_shared<StakingPool<TEST_COIN>>();
    let pot = scenario.take_shared<CombatPot<TEST_COIN>>();
    let mut community = scenario.take_shared<CommunityPool<TEST_COIN>>();
    economy::assert_combat_pot(&economy, &pot);
    assert!(staking::is_active(&pool));
    assert!(staking::kares_rewards(&pool) == amounts::staking_tokens());
    assert!(combat_rewards::balance(&pot) == amounts::combat_tokens());
    assert!(community::remaining(&community) == amounts::community_tokens());
    assert!(community::claimable(&community, &clock) == 0);
    clock.increment_for_testing(amounts::duration_ms());
    assert!(community::claimable(&community, &clock) == amounts::community_tokens());
    scenario.next_tx(@0xA);
    let payment = community::claim(&mut community, &clock, scenario.ctx());
    assert!(payment.value() == amounts::community_tokens());
    coin::burn_for_testing(payment);
    let position = staking::position_for_testing(&mut pool, 1, &clock, scenario.ctx());
    assert!(staking::active_ms(&pool) == 0);
    staking::destroy_position_for_testing(position);
    test_scenario::return_shared(economy);
    test_scenario::return_shared(pool);
    test_scenario::return_shared(pot);
    test_scenario::return_shared(community);
    test_scenario::return_to_address(@0xC, currency);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun funded_setup_retains_upgrade_authority_and_activates_exact_reserves() {
    setup(amounts::reserve_tokens(), 9, true, @aresrpg_rewards, @0xA);
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::economy)]
fun foreign_upgrade_cap_cannot_authorize_setup() {
    setup(amounts::reserve_tokens(), 9, true, @0x123, @0xA);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun fixed_supply_cannot_enable_game_burns() {
    setup(amounts::reserve_tokens(), 9, false, @aresrpg_rewards, @0xA);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun wrong_decimals_cannot_reprice_game_payments() {
    setup(amounts::reserve_tokens(), 6, true, @aresrpg_rewards, @0xA);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_rewards::economy)]
fun underfunded_setup_cannot_start_rewards() {
    setup(amounts::reserve_tokens() - 1, 9, true, @aresrpg_rewards, @0xA);
}

#[test, expected_failure(abort_code = 3, location = aresrpg_rewards::economy)]
fun treasury_cannot_be_zero() {
    setup(amounts::reserve_tokens(), 9, true, @aresrpg_rewards, @0x0);
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::community)]
fun only_the_fixed_treasury_may_withdraw_community_tokens() {
    setup(amounts::reserve_tokens(), 9, true, @aresrpg_rewards, @0xB);
}

#[test]
fun mastery_prices_preserve_points_and_scale_only_tokens() {
    assert!(amounts::mastery_price(3) == 3_000 * amounts::unit());
    assert!(amounts::mastery_price(50) == 50_000 * amounts::unit());
    assert!(amounts::team_tokens() == 30_000_000 * amounts::unit());
    assert!(amounts::mastery_tokens() == 1_000);
    assert!(amounts::initial_supply() == 1_000_000_000_000_000_000);
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::amounts)]
fun mastery_prices_reject_u64_overflow() { amounts::mastery_price(std::u64::max_value!()); }

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::economy)]
fun setup_requires_its_initial_publication_capability() {
    let mut scenario = test_scenario::begin(@0xA);
    test_coin::mint(amounts::reserve_tokens(), 9, true, scenario.ctx());
    scenario.next_tx(@0xA);
    let (currency, reserve) = test_coin::take(&scenario);
    let clock = clock::create_for_testing(scenario.ctx());
    let mut cap = package::test_publish(@0xBAD.to_id(), scenario.ctx());
    let ticket = package::authorize_upgrade(&mut cap, package::compatible_policy(), vector[]);
    package::commit_upgrade(&mut cap, package::test_upgrade(ticket));
    let mut economy = economy::unfunded_for_testing(scenario.ctx());
    economy::setup<TEST_COIN, Victory>(economy::setup_for_testing(scenario.ctx()), &mut economy, &cap,
        &currency, reserve, @0xA, &clock, scenario.ctx());
    economy::destroy_for_testing(economy);
    transfer::public_transfer(cap, scenario.ctx().sender());
    test_scenario::return_to_address(@0xC, currency);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun another_currency_object_is_not_the_bound_currency() {
    let mut scenario = test_scenario::begin(@0xA);
    test_coin::mint(1, 9, true, scenario.ctx());
    scenario.next_tx(@0xA);
    let (currency, coin) = test_coin::take(&scenario);
    let economy = economy::economy_for_testing<TEST_COIN>(@0xBAD.to_id(), @0xBAD.to_id(), scenario.ctx());
    economy::assert_currency(&economy, &currency);
    economy::destroy_for_testing(economy);
    coin::burn_for_testing(coin);
    test_scenario::return_to_address(@0xC, currency);
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun another_combat_pot_cannot_replace_the_fixed_reserve() {
    let mut scenario = test_scenario::begin(@0xA);
    let clock = clock::create_for_testing(scenario.ctx());
    let pot = combat_rewards::pot_for_testing<TEST_COIN, Victory>(1, &clock, scenario.ctx());
    let economy = economy::economy_for_testing<TEST_COIN>(@0xBAD.to_id(), @0xBAD.to_id(), scenario.ctx());
    economy::assert_combat_pot(&economy, &pot);
    economy::destroy_for_testing(economy);
    combat_rewards::destroy_for_testing(pot);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 0, location = aresrpg_rewards::economy)]
fun a_restricted_cap_cannot_promise_future_reserve_migration() {
    let mut scenario = test_scenario::begin(@0xA);
    test_coin::mint(amounts::reserve_tokens(), 9, true, scenario.ctx());
    scenario.next_tx(@0xA);
    let (currency, reserve) = test_coin::take(&scenario);
    let clock = clock::create_for_testing(scenario.ctx());
    let mut cap = package::test_publish(@aresrpg_rewards.to_id(), scenario.ctx());
    package::only_dep_upgrades(&mut cap);
    let mut economy = economy::unfunded_for_testing(scenario.ctx());
    economy::setup<TEST_COIN, Victory>(economy::setup_for_testing(scenario.ctx()), &mut economy, &cap,
        &currency, reserve, @0xA, &clock, scenario.ctx());
    economy::destroy_for_testing(economy);
    transfer::public_transfer(cap, scenario.ctx().sender());
    test_scenario::return_to_address(@0xC, currency);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun an_unfunded_economy_cannot_authorize_token_payments() {
    let mut scenario = test_scenario::begin(@0xA);
    let economy = economy::unfunded_for_testing(scenario.ctx());
    economy::assert_token<TEST_COIN>(&economy);
    economy::destroy_for_testing(economy);
    scenario.end();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::economy)]
fun a_funded_economy_cannot_authorize_a_different_token() {
    let mut scenario = test_scenario::begin(@0xA);
    let economy = economy::economy_for_testing<TEST_COIN>(@0x1.to_id(), @0x2.to_id(), scenario.ctx());
    economy::assert_token<sui::sui::SUI>(&economy);
    economy::destroy_for_testing(economy);
    scenario.end();
}

#[test, expected_failure(abort_code = 4, location = aresrpg_rewards::economy)]
fun funding_cannot_rebind_an_existing_economy() {
    let mut scenario = test_scenario::begin(@0xA);
    test_coin::mint(amounts::reserve_tokens(), 9, true, scenario.ctx());
    scenario.next_tx(@0xA);
    let (currency, reserve) = test_coin::take(&scenario);
    let clock = clock::create_for_testing(scenario.ctx());
    let cap = package::test_publish(@aresrpg_rewards.to_id(), scenario.ctx());
    let mut economy = economy::economy_for_testing<TEST_COIN>(@0x1.to_id(), @0x2.to_id(), scenario.ctx());
    economy::setup<TEST_COIN, Victory>(economy::setup_for_testing(scenario.ctx()), &mut economy, &cap,
        &currency, reserve, @0xA, &clock, scenario.ctx());
    economy::destroy_for_testing(economy);
    transfer::public_transfer(cap, scenario.ctx().sender());
    test_scenario::return_to_address(@0xC, currency);
    clock.destroy_for_testing();
    scenario.end();
}

#[test]
fun setup_authority_can_follow_upgrade_authority_into_cold_storage() {
    let mut scenario = test_scenario::begin(@0xA);
    economy::init_for_testing(scenario.ctx());
    scenario.next_tx(@0xA);
    let setup = scenario.take_from_sender<economy::Setup>();
    let setup_id = object::id(&setup);
    transfer::public_transfer(setup, @0xB);
    scenario.next_tx(@0xB);
    let setup = scenario.take_from_sender<economy::Setup>();
    assert!(object::id(&setup) == setup_id);
    test_scenario::return_to_sender(&scenario, setup);
    let economy = scenario.take_shared<Economy>();
    assert!(!economy::is_funded(&economy));
    test_scenario::return_shared(economy);
    scenario.end();
}

#[test, expected_failure(abort_code = 3, location = aresrpg_rewards::economy)]
fun funding_cannot_nominate_a_treasury_that_did_not_sign() {
    let mut scenario = test_scenario::begin(@0xA);
    test_coin::mint(amounts::reserve_tokens(), 9, true, scenario.ctx());
    scenario.next_tx(@0xA);
    let (currency, reserve) = test_coin::take(&scenario);
    let clock = clock::create_for_testing(scenario.ctx());
    let cap = package::test_publish(@aresrpg_rewards.to_id(), scenario.ctx());
    let mut economy = economy::unfunded_for_testing(scenario.ctx());
    economy::setup<TEST_COIN, Victory>(economy::setup_for_testing(scenario.ctx()), &mut economy, &cap,
        &currency, reserve, @0xB, &clock, scenario.ctx());
    economy::destroy_for_testing(economy);
    transfer::public_transfer(cap, scenario.ctx().sender());
    test_scenario::return_to_address(@0xC, currency);
    clock.destroy_for_testing();
    scenario.end();
}
