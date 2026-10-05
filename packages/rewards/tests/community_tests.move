#[test_only]
module aresrpg_rewards::community_tests;

use aresrpg_rewards::{amounts, community::{Self, CommunityPool}, test_coin::TEST_COIN};
use sui::{clock::{Self, Clock}, coin, test_scenario::{Self, Scenario}};

fun fixture(amount: u64): (Scenario, CommunityPool<TEST_COIN>, Clock) {
    let mut scenario = test_scenario::begin(@0xA);
    let clock = clock::create_for_testing(scenario.ctx());
    let reserve = coin::mint_for_testing<TEST_COIN>(amount, scenario.ctx()).into_balance();
    let pool = community::create(reserve, @0xA, &clock, scenario.ctx());
    (scenario, pool, clock)
}

fun finish(scenario: Scenario, pool: CommunityPool<TEST_COIN>, clock: Clock) {
    community::destroy_for_testing(pool);
    clock.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = 2, location = aresrpg_rewards::community)]
fun partial_reserve_cannot_start_vesting() {
    let (scenario, pool, clock) = fixture(amounts::community_tokens() - 1);
    finish(scenario, pool, clock);
}

#[test, expected_failure(abort_code = 1, location = aresrpg_rewards::community)]
fun unvested_reserve_cannot_be_claimed() {
    let (mut scenario, mut pool, clock) = fixture(amounts::community_tokens());
    coin::burn_for_testing(community::claim(&mut pool, &clock, scenario.ctx()));
    finish(scenario, pool, clock);
}

#[test]
fun claim_cadence_preserves_entitlement_and_exhaustion_is_final() {
    let (mut scenario, mut pool, mut clock) = fixture(amounts::community_tokens());
    clock.increment_for_testing(1);
    let first = community::claim(&mut pool, &clock, scenario.ctx());
    let first_value = first.value();
    assert!(first_value > 0);
    assert!(community::claimable(&pool, &clock) == 0);
    coin::burn_for_testing(first);
    clock.set_for_testing(amounts::duration_ms() / 2);
    let halfway = community::claim(&mut pool, &clock, scenario.ctx());
    assert!(halfway.value() + first_value == amounts::community_tokens() / 2);
    coin::burn_for_testing(halfway);
    clock.set_for_testing(amounts::duration_ms() * 2);
    let last = community::claim(&mut pool, &clock, scenario.ctx());
    assert!(last.value() == amounts::community_tokens() / 2);
    coin::burn_for_testing(last);
    assert!(community::remaining(&pool) == 0);
    assert!(community::claimable(&pool, &clock) == 0);
    finish(scenario, pool, clock);
}
