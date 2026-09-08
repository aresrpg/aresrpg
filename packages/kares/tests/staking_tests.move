#[test_only]
module aresrpg_kares::staking_tests;

use aresrpg_kares::kares::KARES;
use aresrpg_kares::staking::{Self, StakingPool, StakePosition};
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;

const DAY: u64 = 86_400_000;
const INITIAL: u64 = 200_000_000_000_000;
const SCALE: u256 = 1_000_000_000_000_000_000_000_000_000;

fun fixture(ctx: &mut TxContext): (StakingPool, Clock) {
    let clock = clock::create_for_testing(ctx);
    let mut pool = staking::create(coin::mint_for_testing<KARES>(INITIAL, ctx).into_balance(), ctx);
    staking::activate(&mut pool, &clock);
    (pool, clock)
}

fun destroy(pool: StakingPool, position: StakePosition, clock: Clock) {
    staking::destroy_position_for_testing(position);
    staking::destroy_for_testing(pool);
    clock.destroy_for_testing();
}

fun claim_values(pool: &mut StakingPool, position: &mut StakePosition, clock: &Clock, ctx: &mut TxContext): (u64, u64) {
    let (kares, sui) = staking::claim(pool, position, clock, ctx);
    let (kares_value, sui_value) = (kares.value(), sui.value());
    coin::burn_for_testing(kares);
    coin::burn_for_testing(sui);
    (kares_value, sui_value)
}

#[test]
fun five_years_release_exactly_once_and_principal_survives() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1_000_000_000, &clock, ctx);
    clock.increment_for_testing(1_825 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(kares == INITIAL && sui == 0);
    clock.increment_for_testing(20_000 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(kares == 0 && sui == 0);
    let principal = staking::withdraw(&mut pool, &mut position, 1_000_000_000, &clock, ctx);
    assert!(principal.value() == 1_000_000_000);
    assert!(staking::kares_rewards(&pool) == 0);
    coin::burn_for_testing(principal);
    destroy(pool, position, clock);
}

#[test]
fun late_entry_cannot_capture_earlier_rewards() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut early = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    clock.increment_for_testing(365 * DAY);
    let mut late = staking::position_for_testing(&mut pool, 3, &clock, ctx);
    let (kares, sui) = claim_values(&mut pool, &mut late, &clock, ctx);
    assert!(kares == 0 && sui == 0);
    clock.increment_for_testing(365 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut early, &clock, ctx);
    assert!(kares == 50_000_000_000_000 && sui == 0);
    let (kares, sui) = claim_values(&mut pool, &mut late, &clock, ctx);
    assert!(kares == 30_000_000_000_000 && sui == 0);
    staking::destroy_position_for_testing(late);
    destroy(pool, early, clock);
}

#[test]
fun empty_wall_time_pauses_both_baseline_and_supplemental_streams() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(300, ctx), &clock);
    clock.increment_for_testing(10_000 * DAY);
    let mut position = staking::position_for_testing(&mut pool, 10, &clock, ctx);
    assert!(staking::active_ms(&pool) == 0);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(kares == 0 && sui == 0);
    clock.increment_for_testing(16 * DAY);
    let (_, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(sui == 150);
    let principal = staking::withdraw(&mut pool, &mut position, 10, &clock, ctx);
    clock.increment_for_testing(1_000 * DAY);
    staking::add_stake(&mut pool, &mut position, principal, &clock);
    assert!(staking::active_ms(&pool) == 16 * DAY);
    clock.increment_for_testing(15 * DAY);
    let (_, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(sui == 150);
    destroy(pool, position, clock);
}

#[test]
fun overlapping_deposits_keep_original_deadlines_and_both_assets() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(300, ctx), &clock);
    staking::fund_kares(&mut pool, coin::mint_for_testing<KARES>(900, ctx), &clock);
    clock.increment_for_testing(10 * DAY);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(600, ctx), &clock);
    clock.increment_for_testing(21 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    let baseline = ((INITIAL as u128) * 31 / 1_825) as u64;
    assert!(kares == baseline + 900);
    assert!(sui == 700);
    clock.increment_for_testing(10 * DAY);
    let (_, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(sui == 200);
    assert!(staking::sui_rewards(&pool) == 0);
    destroy(pool, position, clock);
}

#[test]
fun sub_day_claims_retain_fractional_user_entitlement() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut first = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    let mut second = staking::position_for_testing(&mut pool, 2, &clock, ctx);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(3, ctx), &clock);
    clock.increment_for_testing(DAY);
    let mut first_sum = 0;
    let mut second_sum = 0;
    30u64.do!(|_| {
        clock.increment_for_testing(DAY);
        let (_, sui) = claim_values(&mut pool, &mut first, &clock, ctx);
        first_sum = first_sum + sui;
        let (_, sui) = claim_values(&mut pool, &mut second, &clock, ctx);
        second_sum = second_sum + sui;
    });
    assert!(first_sum == 1 && second_sum == 2);
    assert!(staking::sui_rewards(&pool) == 0);
    staking::destroy_position_for_testing(second);
    destroy(pool, first, clock);
}

#[test]
fun partial_then_full_withdrawal_preserves_earned_rewards() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 10, &clock, ctx);
    clock.increment_for_testing(365 * DAY);
    let first = staking::withdraw(&mut pool, &mut position, 4, &clock, ctx);
    assert!(staking::position_amount(&position) == 6);
    let second = staking::withdraw(&mut pool, &mut position, 6, &clock, ctx);
    clock.increment_for_testing(365 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(kares == 40_000_000_000_000 && sui == 0);
    assert!(staking::active_ms(&pool) == 365 * DAY);
    coin::burn_for_testing(first);
    coin::burn_for_testing(second);
    destroy(pool, position, clock);
}

#[test]
fun many_donors_and_years_of_inactivity_do_not_grow_schedule() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    400u64.do!(|_| {
        staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(30, ctx), &clock);
        clock.increment_for_testing(DAY);
    });
    assert!(staking::buckets(&pool).length() == 31);
    clock.increment_for_testing(20_000 * DAY);
    let (kares, sui) = claim_values(&mut pool, &mut position, &clock, ctx);
    assert!(kares == INITIAL && sui == 12_000);
    assert!(staking::sui_rewards(&pool) == 0);
    destroy(pool, position, clock);
}

#[test]
fun royalty_split_uses_actual_coin_and_floors_small_amounts() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let remainder = staking::fund_royalties(&mut pool, coin::mint_for_testing<SUI>(103, ctx), &clock, ctx);
    assert!(remainder.value() == 83);
    assert!(staking::sui_rewards(&pool) == 20);
    coin::burn_for_testing(remainder);
    let remainder = staking::fund_royalties(&mut pool, coin::mint_for_testing<SUI>(4, ctx), &clock, ctx);
    assert!(remainder.value() == 4);
    assert!(staking::sui_rewards(&pool) == 20);
    coin::burn_for_testing(remainder);
    staking::destroy_for_testing(pool);
    clock.destroy_for_testing();
}

#[test]
fun fixed_seed_churn_conserves_principal_and_both_reward_assets() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut positions = vector[
        staking::position_for_testing(&mut pool, 11, &clock, ctx),
        staking::position_for_testing(&mut pool, 23, &clock, ctx),
        staking::position_for_testing(&mut pool, 37, &clock, ctx),
    ];
    let mut principal_in = 71;
    let mut principal_out = 0;
    let mut kares_in = INITIAL;
    let mut sui_in = 0;
    let mut kares_out = 0;
    let mut sui_out = 0;
    let mut seed = 7919u64;
    300u64.do!(|step| {
        seed = (seed * 48271) % 2_147_483_647;
        clock.increment_for_testing(seed % (7 * DAY));
        let index = seed % 3;
        let position = &mut positions[index];
        if (step % 4 == 0) {
            let amount = seed % 101 + 1;
            staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(amount, ctx), &clock);
            staking::fund_kares(&mut pool, coin::mint_for_testing<KARES>(amount, ctx), &clock);
            sui_in = sui_in + amount;
            kares_in = kares_in + amount;
        };
        if (step % 4 == 1) {
            staking::add_stake(&mut pool, position, coin::mint_for_testing<KARES>(7, ctx), &clock);
            principal_in = principal_in + 7;
        };
        if (step % 4 == 2 && staking::position_amount(position) > 1) {
            coin::burn_for_testing(staking::withdraw(&mut pool, position, 1, &clock, ctx));
            principal_out = principal_out + 1;
        };
        let (kares, sui) = claim_values(&mut pool, position, &clock, ctx);
        kares_out = kares_out + kares;
        sui_out = sui_out + sui;
        assert!(kares_out + staking::kares_rewards(&pool) == kares_in);
        assert!(sui_out + staking::sui_rewards(&pool) == sui_in);
        assert!(principal_out + staking::principal(&pool) == principal_in);
    });
    clock.increment_for_testing(10_000 * DAY);
    positions.do_mut!(|position| {
        let (kares, sui) = claim_values(&mut pool, position, &clock, ctx);
        kares_out = kares_out + kares;
        sui_out = sui_out + sui;
    });
    assert!(kares_in - kares_out < 4 && sui_in - sui_out < 4);
    positions.destroy!(|position| staking::destroy_position_for_testing(position));
    staking::destroy_for_testing(pool);
    clock.destroy_for_testing();
}

#[test]
fun getters_describe_scaled_accrual_and_schedule() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, mut clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(30, ctx), &clock);
    assert!(staking::is_active(&pool));
    assert!(staking::position_pool(&position) == object::id(&pool));
    let (start, kares, sui, released_kares, released_sui) = staking::bucket_values(&staking::buckets(&pool)[1]);
    assert!(start == DAY && kares == 0 && sui == 30 && released_kares == 0 && released_sui == 0);
    clock.increment_for_testing(365 * DAY);
    let coin = staking::withdraw(&mut pool, &mut position, 1, &clock, ctx);
    assert!(staking::last_wall_ms(&pool) == 365 * DAY);
    assert!(staking::initial_released(&pool) == INITIAL / 5);
    let (kares_index, sui_index) = staking::indexes(&pool);
    let (position_kares_index, position_sui_index) = staking::position_indexes(&position);
    assert!(kares_index == position_kares_index && sui_index == position_sui_index);
    let (kares, sui) = staking::position_accrued(&position);
    assert!(kares == (INITIAL as u256) / 5 * SCALE && sui == 30 * SCALE);
    coin::burn_for_testing(coin);
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 0, location = aresrpg_kares::staking)]
fun inactive_pool_rejects_staking() {
    let ctx = &mut tx_context::dummy();
    let clock = clock::create_for_testing(ctx);
    let mut pool = staking::create(coin::mint_for_testing<KARES>(INITIAL, ctx).into_balance(), ctx);
    let position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 4, location = aresrpg_kares::staking)]
fun activation_is_one_shot() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    staking::activate(&mut pool, &clock);
    staking::destroy_for_testing(pool);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = 1, location = aresrpg_kares::staking)]
fun another_pool_cannot_pay_a_position() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let (mut other, other_clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    claim_values(&mut other, &mut position, &clock, ctx);
    staking::destroy_for_testing(other);
    other_clock.destroy_for_testing();
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 3, location = aresrpg_kares::staking)]
fun rewards_are_not_withdrawable_principal() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    coin::burn_for_testing(staking::withdraw(&mut pool, &mut position, 2, &clock, ctx));
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_kares::staking)]
fun zero_stake_is_rejected() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let position = staking::position_for_testing(&mut pool, 0, &clock, ctx);
    destroy(pool, position, clock);
}

#[test]
fun public_stake_position_is_owned_by_the_sender() {
    let mut scenario = sui::test_scenario::begin(@0xA);
    let (mut pool, clock) = fixture(scenario.ctx());
    staking::open_position(&mut pool, coin::mint_for_testing<KARES>(100, scenario.ctx()), &clock, scenario.ctx());
    scenario.next_tx(@0xA);
    let position = scenario.take_from_sender<StakePosition>();
    assert!(staking::position_amount(&position) == 100);
    assert!(sui::test_scenario::ids_for_address<StakePosition>(@0xB).is_empty());
    destroy(pool, position, clock);
    scenario.end();
}

#[test, expected_failure(abort_code = 2, location = aresrpg_kares::staking)]
fun zero_additional_stake_is_rejected() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    staking::add_stake(&mut pool, &mut position, coin::zero<KARES>(ctx), &clock);
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 2, location = aresrpg_kares::staking)]
fun zero_withdrawal_is_rejected() {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    let mut position = staking::position_for_testing(&mut pool, 1, &clock, ctx);
    coin::burn_for_testing(staking::withdraw(&mut pool, &mut position, 0, &clock, ctx));
    destroy(pool, position, clock);
}

#[test, expected_failure(abort_code = 5, location = aresrpg_kares::staking)]
fun initial_reward_amount_cannot_be_substituted() {
    let ctx = &mut tx_context::dummy();
    let pool = staking::create(coin::mint_for_testing<KARES>(INITIAL - 1, ctx).into_balance(), ctx);
    staking::destroy_for_testing(pool);
}

fun fund_with_unreleased_bucket(kares: u64, sui: u64) {
    let ctx = &mut tx_context::dummy();
    let (mut pool, clock) = fixture(ctx);
    staking::set_unreleased_bucket_for_testing(&mut pool, kares, sui);
    staking::fund_sui(&mut pool, coin::mint_for_testing<SUI>(1, ctx), &clock);
    staking::destroy_for_testing(pool);
    clock.destroy_for_testing();
}

#[test, expected_failure(abort_code = staking::EBadSchedule)]
fun bucket_rollover_cannot_discard_unreleased_kares() { fund_with_unreleased_bucket(1, 0) }

#[test, expected_failure(abort_code = staking::EBadSchedule)]
fun bucket_rollover_cannot_discard_unreleased_sui() { fund_with_unreleased_bucket(0, 1) }
