/// Publicly funded combat rewards. Deposits extend runway, never the emission rate.
module aresrpg_kares::combat_rewards;

use aresrpg_kares::kares::KARES;
use std::type_name::{Self, TypeName};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::Coin;

const UNIT: u64 = 1_000_000_000;
const INITIAL_TOKENS: u64 = 100_000 * UNIT;
const DAY_MS: u64 = 86_400_000;
const DAILY_BUDGET: u64 = INITIAL_TOKENS / 1_825;
// Maximum baseline bounty: one level-200 boss receives 1/100 of the daily allowance.
const BASE_QUOTA: u64 = 20_000;
const MAX_U64: u128 = 18_446_744_073_709_551_615;

public struct CombatPot has key {
    id: UID,
    balance: Balance<KARES>,
    authorized: Option<TypeName>,
    epoch: u64,
    epoch_started_ms: u64,
    work: u64,
    quota: u64,
    day: u64,
    spent: u64,
}

public(package) fun create(ctx: &mut TxContext): CombatPot {
    CombatPot {
        id: object::new(ctx), balance: balance::zero(), authorized: option::none(),
        epoch: ctx.epoch(), epoch_started_ms: ctx.epoch_timestamp_ms(), work: 0,
        quota: BASE_QUOTA, day: 0, spent: 0,
    }
}

public(package) fun share(pot: CombatPot) { transfer::share_object(pot); }

/// Funding changes custody only. It cannot restart an epoch or refill today's allowance.
public fun fund(pot: &mut CombatPot, payment: Coin<KARES>) {
    fund_balance(pot, payment.into_balance());
}

public(package) fun fund_balance(pot: &mut CombatPot, payment: Balance<KARES>) {
    pot.balance.join(payment);
}

/// The canonical offering authenticates its immutable treasury before rotating game authority.
public(package) fun authorize<W: drop>(pot: &mut CombatPot) {
    pot.authorized = option::some(type_name::with_original_ids<W>());
}

/// Gameplay supplies an unforgeable witness, verified boss work, and the fixed winner count.
/// Start time comes only from the canonical offering's successful settlement.
public(package) fun take<W: drop>(
    pot: &mut CombatPot, _: W, weight: u64, winners: u64,
    start_ms: u64, clock: &Clock, ctx: &TxContext,
): Balance<KARES> {
    if (pot.authorized != option::some(type_name::with_original_ids<W>())) return balance::zero();
    if (weight == 0 || winners == 0) return balance::zero();
    retarget(pot, ctx.epoch(), ctx.epoch_timestamp_ms());
    // Count work even when exhausted. Otherwise the ceiling would conceal excess activity.
    pot.work = ((pot.work as u128) + (weight as u128)).min(MAX_U64) as u64;
    let day = (clock.timestamp_ms() - start_ms) / DAY_MS;
    if (day != pot.day) { pot.day = day; pot.spent = 0; };
    let quoted = (((DAILY_BUDGET as u128) * (weight as u128)) / (pot.quota as u128)).min(MAX_U64) as u64;
    let available = quoted.min(DAILY_BUDGET - pot.spent).min(pot.balance.value());
    // Every seat receives exactly the same amount. Rounding dust stays in the public pot.
    let amount = (available / winners) * winners;
    pot.spent = pot.spent + amount;
    pot.balance.split(amount)
}

fun retarget(pot: &mut CombatPot, epoch: u64, epoch_started_ms: u64) {
    if (epoch == pot.epoch) return;
    let elapsed = (epoch_started_ms - pot.epoch_started_ms).max(1);
    let observed = ((pot.work as u128) * (DAY_MS as u128)) / (elapsed as u128);
    pot.quota = (((pot.quota as u128) + observed) / 2).max(BASE_QUOTA as u128).min(MAX_U64) as u64;
    pot.epoch = epoch;
    pot.epoch_started_ms = epoch_started_ms;
    pot.work = 0;
}

public fun initial_tokens(): u64 { INITIAL_TOKENS }
public fun daily_budget(): u64 { DAILY_BUDGET }
public fun balance(pot: &CombatPot): u64 { pot.balance.value() }
public fun quota(pot: &CombatPot): u64 { pot.quota }
public fun work(pot: &CombatPot): u64 { pot.work }
public fun spent(pot: &CombatPot): u64 { pot.spent }

#[test_only]
public fun destroy_for_testing(pot: CombatPot) {
    let CombatPot { id, balance, .. } = pot;
    balance.destroy_for_testing();
    id.delete();
}
