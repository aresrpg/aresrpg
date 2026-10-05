/// Publicly funded combat rewards. Deposits extend runway, never the emission rate.
module aresrpg_rewards::combat_rewards;

use aresrpg_rewards::amounts;
use std::type_name::{Self, TypeName};
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::Coin;

const DAY_MS: u64 = 86_400_000;
// Maximum baseline bounty: one level-200 boss receives 1/100 of the daily allowance.
const BASE_QUOTA: u64 = 20_000;
const MAX_U64: u128 = 18_446_744_073_709_551_615;

public struct CombatPot<phantom Token> has key {
    id: UID,
    balance: Balance<Token>,
    authorized: TypeName,
    started_ms: u64,
    epoch: u64,
    epoch_started_ms: u64,
    work: u64,
    quota: u64,
    day: u64,
    spent: u64,
}

public(package) fun create<Token, Victory: drop>(reserve: Balance<Token>, clock: &Clock, ctx: &mut TxContext): CombatPot<Token> {
    assert!(reserve.value() == amounts::combat_tokens(), 0);
    CombatPot {
        id: object::new(ctx), balance: reserve, authorized: type_name::with_original_ids<Victory>(),
        started_ms: clock.timestamp_ms(), epoch: ctx.epoch(), epoch_started_ms: ctx.epoch_timestamp_ms(),
        work: 0, quota: BASE_QUOTA, day: 0, spent: 0,
    }
}

public(package) fun share<Token>(pot: CombatPot<Token>) { transfer::share_object(pot); }

/// Funding changes custody only. It cannot restart an epoch or refill today's allowance.
public fun fund<Token>(pot: &mut CombatPot<Token>, payment: Coin<Token>) {
    fund_balance(pot, payment.into_balance());
}

public(package) fun fund_balance<Token>(pot: &mut CombatPot<Token>, payment: Balance<Token>) {
    pot.balance.join(payment);
}

/// Gameplay supplies an unforgeable witness, verified boss work, and the fixed winner count.
/// The funded setup fixes the start time and the only accepted victory witness.
public fun take<Token, W: drop>(
    pot: &mut CombatPot<Token>, _: W, weight: u64, winners: u64,
    clock: &Clock, ctx: &TxContext,
): Balance<Token> {
    assert!(pot.authorized == type_name::with_original_ids<W>(), 1);
    if (weight == 0 || winners == 0) return balance::zero();
    retarget(pot, ctx.epoch(), ctx.epoch_timestamp_ms());
    // Count work even when exhausted. Otherwise the ceiling would conceal excess activity.
    pot.work = ((pot.work as u128) + (weight as u128)).min(MAX_U64) as u64;
    let day = (clock.timestamp_ms() - pot.started_ms) / DAY_MS;
    if (day != pot.day) { pot.day = day; pot.spent = 0; };
    let quoted = (((daily_budget() as u128) * (weight as u128)) / (pot.quota as u128)).min(MAX_U64) as u64;
    let available = quoted.min(daily_budget() - pot.spent).min(pot.balance.value());
    // Every seat receives exactly the same amount. Rounding dust stays in the public pot.
    let amount = (available / winners) * winners;
    pot.spent = pot.spent + amount;
    pot.balance.split(amount)
}

fun retarget<Token>(pot: &mut CombatPot<Token>, epoch: u64, epoch_started_ms: u64) {
    if (epoch == pot.epoch) return;
    let elapsed = (epoch_started_ms - pot.epoch_started_ms).max(1);
    let observed = ((pot.work as u128) * (DAY_MS as u128)) / (elapsed as u128);
    pot.quota = (((pot.quota as u128) + observed) / 2).max(BASE_QUOTA as u128).min(MAX_U64) as u64;
    pot.epoch = epoch;
    pot.epoch_started_ms = epoch_started_ms;
    pot.work = 0;
}

public fun initial_tokens(): u64 { amounts::combat_tokens() }
public fun daily_budget(): u64 { amounts::combat_tokens() / 1_825 }
public fun balance<Token>(pot: &CombatPot<Token>): u64 { pot.balance.value() }
public fun quota<Token>(pot: &CombatPot<Token>): u64 { pot.quota }
public fun work<Token>(pot: &CombatPot<Token>): u64 { pot.work }
public fun spent<Token>(pot: &CombatPot<Token>): u64 { pot.spent }

#[test_only]
public fun pot_for_testing<Token, Victory: drop>(amount: u64, clock: &Clock, ctx: &mut TxContext): CombatPot<Token> {
    let reserve = sui::coin::mint_for_testing<Token>(amounts::combat_tokens(), ctx).into_balance();
    let mut pot = create<Token, Victory>(reserve, clock, ctx);
    pot.balance.withdraw_all().destroy_for_testing();
    pot.balance.join(sui::coin::mint_for_testing<Token>(amount, ctx).into_balance());
    pot
}

#[test_only]
public fun share_for_testing<Token>(pot: CombatPot<Token>) { share(pot) }

#[test_only]
public fun destroy_for_testing<Token>(pot: CombatPot<Token>) {
    let CombatPot { id, balance, .. } = pot;
    balance.destroy_for_testing();
    id.delete();
}
