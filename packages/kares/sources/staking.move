/// Principal custody and bounded reward schedules on a clock paused when nobody stakes.
module aresrpg_kares::staking;

use aresrpg_kares::kares::KARES;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;

const EInactive: u64 = 0;
const EWrongPool: u64 = 1;
const EZeroAmount: u64 = 2;
const EInsufficientStake: u64 = 3;
const EAlreadyActive: u64 = 4;
const EBadSchedule: u64 = 5;
const DAY_MS: u64 = 86_400_000;
const MONTH_MS: u64 = 30 * DAY_MS;
const INITIAL_DURATION_MS: u64 = 1_825 * DAY_MS;
const INITIAL_REWARDS: u64 = 200_000_000_000_000;
const SCALE: u256 = 1_000_000_000_000_000_000_000_000_000;
const SLOTS: u64 = 31;

/// At most 31 distinct start days coexist. Donations on a day share a slot.
public struct RewardBucket has copy, drop, store {
    start_ms: u64,
    kares: u64,
    sui: u64,
    released_kares: u64,
    released_sui: u64,
}

public struct StakingPool has key {
    id: UID,
    active: bool,
    principal: Balance<KARES>,
    kares_rewards: Balance<KARES>,
    sui_rewards: Balance<SUI>,
    last_wall_ms: u64,
    active_ms: u64,
    initial_released: u64,
    kares_index: u256,
    sui_index: u256,
    kares_remainder: u256,
    sui_remainder: u256,
    buckets: vector<RewardBucket>,
}

/// No store ability: ordinary ownership cannot be transferred or wrapped elsewhere.
public struct StakePosition has key {
    id: UID,
    pool: ID,
    amount: u64,
    kares_index: u256,
    sui_index: u256,
    kares_accrued: u256,
    sui_accrued: u256,
}

public struct RoyaltyFunded has copy, drop {
    pool: ID,
    amount: u64,
    staking: u64,
}

public(package) fun create(rewards: Balance<KARES>, ctx: &mut TxContext): StakingPool {
    assert!(rewards.value() == INITIAL_REWARDS, EBadSchedule);
    let mut buckets = vector[];
    SLOTS.do!(|_| buckets.push_back(empty_bucket()));
    StakingPool {
        id: object::new(ctx), active: false, principal: balance::zero(),
        kares_rewards: rewards, sui_rewards: balance::zero(), last_wall_ms: 0,
        active_ms: 0, initial_released: 0, kares_index: 0, sui_index: 0,
        kares_remainder: 0, sui_remainder: 0, buckets,
    }
}

public(package) fun share(pool: StakingPool) { transfer::share_object(pool) }

public(package) fun activate(pool: &mut StakingPool, clock: &Clock) {
    assert!(!pool.active, EAlreadyActive);
    pool.active = true;
    pool.last_wall_ms = clock.timestamp_ms();
}

public fun open_position(
    pool: &mut StakingPool, payment: Coin<KARES>, clock: &Clock, ctx: &mut TxContext,
) {
    let position = new_position(pool, payment, clock, ctx);
    transfer::transfer(position, ctx.sender());
}

fun new_position(
    pool: &mut StakingPool, payment: Coin<KARES>, clock: &Clock, ctx: &mut TxContext,
): StakePosition {
    update(pool, clock);
    let amount = payment.value();
    assert!(amount > 0, EZeroAmount);
    pool.principal.join(payment.into_balance());
    StakePosition {
        id: object::new(ctx), pool: object::id(pool), amount,
        kares_index: pool.kares_index, sui_index: pool.sui_index,
        kares_accrued: 0, sui_accrued: 0,
    }
}

public fun add_stake(
    pool: &mut StakingPool, position: &mut StakePosition, payment: Coin<KARES>, clock: &Clock,
) {
    update_position(pool, position, clock);
    let amount = payment.value();
    assert!(amount > 0, EZeroAmount);
    position.amount = position.amount + amount;
    pool.principal.join(payment.into_balance());
}

public fun withdraw(
    pool: &mut StakingPool, position: &mut StakePosition, amount: u64,
    clock: &Clock, ctx: &mut TxContext,
): Coin<KARES> {
    update_position(pool, position, clock);
    assert!(amount > 0, EZeroAmount);
    assert!(position.amount >= amount, EInsufficientStake);
    position.amount = position.amount - amount;
    pool.principal.split(amount).into_coin(ctx)
}

public fun claim(
    pool: &mut StakingPool, position: &mut StakePosition, clock: &Clock, ctx: &mut TxContext,
): (Coin<KARES>, Coin<SUI>) {
    update_position(pool, position, clock);
    let kares = (position.kares_accrued / SCALE) as u64;
    let sui = (position.sui_accrued / SCALE) as u64;
    position.kares_accrued = position.kares_accrued % SCALE;
    position.sui_accrued = position.sui_accrued % SCALE;
    (pool.kares_rewards.split(kares).into_coin(ctx), pool.sui_rewards.split(sui).into_coin(ctx))
}

/// Donations cannot be withdrawn. Zero funding is accepted for composable royalty PTBs.
public fun fund_kares(pool: &mut StakingPool, payment: Coin<KARES>, clock: &Clock) {
    update(pool, clock);
    let amount = payment.value();
    pool.kares_rewards.join(payment.into_balance());
    let bucket = funding_bucket(pool);
    bucket.kares = bucket.kares + amount;
}

public fun fund_sui(pool: &mut StakingPool, payment: Coin<SUI>, clock: &Clock) {
    update(pool, clock);
    let amount = payment.value();
    pool.sui_rewards.join(payment.into_balance());
    let bucket = funding_bucket(pool);
    bucket.sui = bucket.sui + amount;
}

/// Split actual withdrawn proceeds inside the PTB, never a stale off-chain balance hint.
public fun fund_royalties(
    pool: &mut StakingPool, mut payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext,
): Coin<SUI> {
    let amount = payment.value();
    let staking = amount / 5;
    fund_sui(pool, payment.split(staking, ctx), clock);
    sui::event::emit(RoyaltyFunded { pool: object::id(pool), amount, staking });
    payment
}

fun funding_bucket(pool: &mut StakingPool): &mut RewardBucket {
    let day = pool.active_ms / DAY_MS + 1;
    let start_ms = day * DAY_MS;
    let bucket = &mut pool.buckets[day % SLOTS];
    if (bucket.start_ms != start_ms) {
        assert!(bucket.kares == bucket.released_kares && bucket.sui == bucket.released_sui, EBadSchedule);
        *bucket = empty_bucket();
        bucket.start_ms = start_ms;
    };
    bucket
}

fun update_position(pool: &mut StakingPool, position: &mut StakePosition, clock: &Clock) {
    assert!(position.pool == object::id(pool), EWrongPool);
    update(pool, clock);
    position.kares_accrued = position.kares_accrued
        + (position.amount as u256) * (pool.kares_index - position.kares_index);
    position.sui_accrued = position.sui_accrued
        + (position.amount as u256) * (pool.sui_index - position.sui_index);
    position.kares_index = pool.kares_index;
    position.sui_index = pool.sui_index;
}

fun update(pool: &mut StakingPool, clock: &Clock) {
    assert!(pool.active, EInactive);
    let now = clock.timestamp_ms();
    let elapsed = now - pool.last_wall_ms;
    pool.last_wall_ms = now;
    let total = pool.principal.value();
    if (total == 0) return;
    pool.active_ms = pool.active_ms + elapsed;
    let released = linear(INITIAL_REWARDS, pool.active_ms, INITIAL_DURATION_MS);
    let mut kares = released - pool.initial_released;
    let mut sui = 0;
    pool.initial_released = released;
    pool.buckets.do_mut!(|bucket| {
        let elapsed = if (pool.active_ms > bucket.start_ms) pool.active_ms - bucket.start_ms else 0;
        let released_kares = linear(bucket.kares, elapsed, MONTH_MS);
        let released_sui = linear(bucket.sui, elapsed, MONTH_MS);
        kares = kares + (released_kares - bucket.released_kares);
        sui = sui + (released_sui - bucket.released_sui);
        bucket.released_kares = released_kares;
        bucket.released_sui = released_sui;
    });
    let kares_scaled = (kares as u256) * SCALE + pool.kares_remainder;
    let sui_scaled = (sui as u256) * SCALE + pool.sui_remainder;
    pool.kares_index = pool.kares_index + kares_scaled / (total as u256);
    pool.sui_index = pool.sui_index + sui_scaled / (total as u256);
    pool.kares_remainder = kares_scaled % (total as u256);
    pool.sui_remainder = sui_scaled % (total as u256);
}

fun linear(amount: u64, elapsed: u64, duration: u64): u64 {
    (((amount as u128) * (elapsed.min(duration) as u128)) / (duration as u128)) as u64
}

fun empty_bucket(): RewardBucket {
    RewardBucket { start_ms: 0, kares: 0, sui: 0, released_kares: 0, released_sui: 0 }
}

public fun is_active(pool: &StakingPool): bool { pool.active }
public fun principal(pool: &StakingPool): u64 { pool.principal.value() }
public fun kares_rewards(pool: &StakingPool): u64 { pool.kares_rewards.value() }
public fun sui_rewards(pool: &StakingPool): u64 { pool.sui_rewards.value() }
public fun active_ms(pool: &StakingPool): u64 { pool.active_ms }
public fun last_wall_ms(pool: &StakingPool): u64 { pool.last_wall_ms }
public fun initial_released(pool: &StakingPool): u64 { pool.initial_released }
public fun indexes(pool: &StakingPool): (u256, u256) { (pool.kares_index, pool.sui_index) }
public fun buckets(pool: &StakingPool): &vector<RewardBucket> { &pool.buckets }
public fun position_pool(position: &StakePosition): ID { position.pool }
public fun position_amount(position: &StakePosition): u64 { position.amount }
public fun position_indexes(position: &StakePosition): (u256, u256) { (position.kares_index, position.sui_index) }
public fun position_accrued(position: &StakePosition): (u256, u256) { (position.kares_accrued, position.sui_accrued) }
public fun bucket_values(bucket: &RewardBucket): (u64, u64, u64, u64, u64) {
    (bucket.start_ms, bucket.kares, bucket.sui, bucket.released_kares, bucket.released_sui)
}

#[test_only]
public fun position_for_testing(
    pool: &mut StakingPool, amount: u64, clock: &Clock, ctx: &mut TxContext,
): StakePosition { new_position(pool, coin::mint_for_testing<KARES>(amount, ctx), clock, ctx) }

#[test_only]
public fun destroy_position_for_testing(position: StakePosition) {
    let StakePosition { id, pool: _, amount: _, kares_index: _, sui_index: _, kares_accrued: _, sui_accrued: _ } = position;
    id.delete();
}

#[test_only]
public fun destroy_for_testing(pool: StakingPool) {
    let StakingPool {
        id, active: _, principal, kares_rewards, sui_rewards, last_wall_ms: _, active_ms: _,
        initial_released: _, kares_index: _, sui_index: _, kares_remainder: _, sui_remainder: _, buckets: _,
    } = pool;
    id.delete();
    balance::destroy_for_testing(principal);
    balance::destroy_for_testing(kares_rewards);
    balance::destroy_for_testing(sui_rewards);
}

#[test_only]
public fun set_unreleased_bucket_for_testing(pool: &mut StakingPool, kares: u64, sui: u64) {
    pool.buckets[1].kares = kares;
    pool.buckets[1].sui = sui;
}
