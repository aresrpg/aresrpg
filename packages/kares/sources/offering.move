/// Immutable batch sale. Settlement delivers liquidity funds; external pool creation is manual.
module aresrpg_kares::offering;

use aresrpg_kares::kares::{Self, Genesis, KARES};
use aresrpg_kares::staking::{Self, StakingPool};
use aresrpg_kares::combat_rewards::{Self, CombatPot};
use sui::balance::{Self, Balance};
use sui::address;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::package::{Self, UpgradeCap};
use sui::sui::SUI;

const EInvalidTerms: u64 = 0;
const ENotOpen: u64 = 1;
const EWrongOffering: u64 = 2;
const EZeroAmount: u64 = 3;
const ENotSettleable: u64 = 4;
const ENotClaimable: u64 = 5;
const EWrongPool: u64 = 6;
const ENotTreasury: u64 = 7;
const ENothingVested: u64 = 8;
const EWrongUpgradeCap: u64 = 9;
const ECombatAlreadyFunded: u64 = 10;
const EAlreadyStarted: u64 = 11;
const UNIT: u64 = 1_000_000_000;
const SALE_TOKENS: u64 = 400_000 * UNIT;
const LIQUIDITY_TOKENS: u64 = 160_000 * UNIT;
const STAKING_TOKENS: u64 = 200_000 * UNIT;
const TEAM_TOKENS: u64 = 30_000 * UNIT;
const COMMUNITY_TOKENS: u64 = 110_000 * UNIT;
const DAY_MS: u64 = 86_400_000;
const COMMUNITY_VESTING_MS: u64 = 1_825 * DAY_MS;

public struct Offering has key {
    id: UID,
    pool: ID,
    minimum: u64,
    maximum: u64,
    started_ms: Option<u64>,
    duration_ms: u64,
    treasury: address,
    liquidity: address,
    deposits: Balance<SUI>,
    sale_tokens: Balance<KARES>,
    liquidity_tokens: Balance<KARES>,
    total_deposited: u64,
    accepted: u64,
    settled: bool,
    community_tokens: Balance<KARES>,
    settled_ms: u64,
    combat_pot: ID,
    combat_tokens: Balance<KARES>,
}

/// No store ability: sale positions cannot be transferred independently of their owner.
public struct Contribution has key {
    id: UID,
    offering: ID,
    amount: u64,
}

public struct CommunityClaimed has copy, drop {
    offering: ID,
    amount: u64,
}

public fun setup(
    genesis: Genesis, upgrade_cap: UpgradeCap, minimum: u64, maximum: u64,
    duration_ms: u64,
    treasury: address, liquidity: address, team: address, community: address,
    ctx: &mut TxContext,
) {
    let original = std::type_name::with_original_ids<KARES>().address_string();
    assert!(package::version(&upgrade_cap) == 1
        && address::to_ascii_string(package::upgrade_package(&upgrade_cap).to_address()) == original, EWrongUpgradeCap);
    assert!(minimum > 0 && maximum >= minimum, EInvalidTerms);
    assert!(duration_ms > 0, EInvalidTerms);
    assert!(treasury != @0x0 && liquidity != @0x0 && team != @0x0 && community != @0x0, EInvalidTerms);
    package::make_immutable(upgrade_cap);
    let (mut inventory, metadata_cap) = kares::consume(genesis);
    let pool = staking::create(inventory.split(STAKING_TOKENS), ctx);
    let combat_pot = combat_rewards::create(ctx);
    let offering = Offering {
        id: object::new(ctx), pool: object::id(&pool), minimum, maximum,
        started_ms: option::none(), duration_ms, treasury, liquidity,
        deposits: balance::zero(), sale_tokens: inventory.split(SALE_TOKENS),
        liquidity_tokens: inventory.split(LIQUIDITY_TOKENS),
        total_deposited: 0, accepted: 0, settled: false,
        community_tokens: inventory.split(COMMUNITY_TOKENS), settled_ms: 0,
        combat_pot: object::id(&combat_pot), combat_tokens: inventory.split(combat_rewards::initial_tokens()),
    };
    transfer::public_transfer(inventory.split(TEAM_TOKENS).into_coin(ctx), team);
    inventory.destroy_zero();
    // The community cold wallet retains metadata authority, not the vested reserve.
    transfer::public_transfer(metadata_cap, community);
    staking::share(pool);
    combat_rewards::share(combat_pot);
    transfer::share_object(offering);
}

/// Configuration is already sealed. Only its treasury can start the immutable window, once.
public fun start(offering: &mut Offering, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == offering.treasury, ENotTreasury);
    assert!(offering.started_ms.is_none(), EAlreadyStarted);
    // Prove the closing boundary fit before committing the start timestamp.
    let end = (clock.timestamp_ms() as u128) + (offering.duration_ms as u128);
    assert!(end <= 18_446_744_073_709_551_615, EInvalidTerms);
    offering.started_ms.fill(clock.timestamp_ms());
}

/// Owner-triggered deployment funding never exposes the reserved allocation as liquid treasury coins.
public fun seed_combat(offering: &mut Offering, pot: &mut CombatPot, ctx: &TxContext) {
    assert!(ctx.sender() == offering.treasury, ENotTreasury);
    assert!(offering.combat_pot == object::id(pot), EWrongPool);
    assert!(offering.combat_tokens.value() > 0, ECombatAlreadyFunded);
    combat_rewards::fund_balance(pot, offering.combat_tokens.withdraw_all());
}

/// A game republish may rotate its witness type without resetting monetary counters.
public fun authorize_combat<W: drop>(offering: &Offering, pot: &mut CombatPot, ctx: &TxContext) {
    assert!(ctx.sender() == offering.treasury, ENotTreasury);
    assert!(offering.combat_pot == object::id(pot), EWrongPool);
    combat_rewards::authorize<W>(pot);
}

public fun boss_bounty<W: drop>(
    offering: &Offering, pot: &mut CombatPot, witness: W, weight: u64, winners: u64,
    clock: &Clock, ctx: &TxContext,
): Balance<KARES> {
    assert!(offering.combat_pot == object::id(pot), EWrongPool);
    if (!offering.settled) return balance::zero();
    combat_rewards::take(pot, witness, weight, winners, offering.settled_ms, clock, ctx)
}

public fun contribute(offering: &mut Offering, payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext) {
    let position = new_contribution(offering, payment, clock, ctx);
    transfer::transfer(position, ctx.sender());
}

fun new_contribution(
    offering: &mut Offering, payment: Coin<SUI>, clock: &Clock, ctx: &mut TxContext,
): Contribution {
    let amount = deposit(offering, payment, clock);
    Contribution { id: object::new(ctx), offering: object::id(offering), amount }
}

public fun add_contribution(
    offering: &mut Offering, position: &mut Contribution, payment: Coin<SUI>, clock: &Clock,
) {
    assert!(position.offering == object::id(offering), EWrongOffering);
    position.amount = position.amount + deposit(offering, payment, clock);
}

fun deposit(offering: &mut Offering, payment: Coin<SUI>, clock: &Clock): u64 {
    let now = clock.timestamp_ms();
    assert!(started(offering) && now < closes_ms(offering), ENotOpen);
    let amount = payment.value();
    assert!(amount > 0, EZeroAmount);
    offering.total_deposited = offering.total_deposited + amount;
    offering.deposits.join(payment.into_balance());
    amount
}

/// Permissionless and atomic. No caller-supplied recipient or post-sale treasury gate.
public fun settle(offering: &mut Offering, pool: &mut StakingPool, clock: &Clock, ctx: &mut TxContext) {
    assert!(offering.pool == object::id(pool), EWrongPool);
    if (offering.settled) return;
    let now = clock.timestamp_ms();
    assert!(started(offering) && now >= closes_ms(offering), ENotSettleable);
    assert!(offering.total_deposited >= offering.minimum, ENotSettleable);
    let accepted = offering.total_deposited.min(offering.maximum);
    let liquidity = (((accepted as u128) * 40) / 100) as u64;
    transfer::public_transfer(offering.deposits.split(liquidity).into_coin(ctx), offering.liquidity);
    transfer::public_transfer(offering.deposits.split(accepted - liquidity).into_coin(ctx), offering.treasury);
    transfer::public_transfer(offering.liquidity_tokens.withdraw_all().into_coin(ctx), offering.liquidity);
    staking::activate(pool, clock);
    offering.accepted = accepted;
    offering.settled_ms = now;
    offering.settled = true;
}

/// Only the immutable treasury may withdraw the portion unlocked since successful settlement.
public fun claim_community(offering: &mut Offering, clock: &Clock, ctx: &mut TxContext): Coin<KARES> {
    assert!(ctx.sender() == offering.treasury, ENotTreasury);
    let amount = community_claimable(offering, clock);
    assert!(amount > 0, ENothingVested);
    let payment = offering.community_tokens.split(amount).into_coin(ctx);
    sui::event::emit(CommunityClaimed { offering: object::id(offering), amount });
    payment
}

/// Cumulative vesting minus cumulative withdrawals makes claim cadence irrelevant to rounding.
public fun community_claimable(offering: &Offering, clock: &Clock): u64 {
    if (!offering.settled) return 0;
    let elapsed = (clock.timestamp_ms() - offering.settled_ms).min(COMMUNITY_VESTING_MS);
    let vested = (((COMMUNITY_TOKENS as u128) * (elapsed as u128)) / (COMMUNITY_VESTING_MS as u128)) as u64;
    vested - (COMMUNITY_TOKENS - offering.community_tokens.value())
}

/// Success claims KARES plus proportional excess; failed sales return the full deposit.
public fun claim(
    offering: &mut Offering, pool: &mut StakingPool, position: Contribution, clock: &Clock, ctx: &mut TxContext,
): (Coin<KARES>, Coin<SUI>) {
    assert!(position.offering == object::id(offering), EWrongOffering);
    assert!(offering.pool == object::id(pool), EWrongPool);
    let now = clock.timestamp_ms();
    // A bound Contribution can only be created after start; its custody already proves activation.
    assert!(now >= closes_ms(offering), ENotClaimable);
    if (!offering.settled && offering.total_deposited >= offering.minimum) {
        settle(offering, pool, clock, ctx);
    };
    let Contribution { id, offering: _, amount } = position;
    id.delete();
    let (tokens, refund) = entitlement(offering, amount);
    (offering.sale_tokens.split(tokens).into_coin(ctx), offering.deposits.split(refund).into_coin(ctx))
}

fun entitlement(offering: &Offering, amount: u64): (u64, u64) {
    if (offering.settled) {
        let total = offering.total_deposited as u128;
        let tokens = ((amount as u128) * (SALE_TOKENS as u128) / total) as u64;
        // Floor the excess directly. Subtracting floored acceptance can overpromise refunds.
        let refund = ((amount as u128) * ((offering.total_deposited - offering.accepted) as u128) / total) as u64;
        (tokens, refund)
    } else {
        (0, amount)
    }
}

public fun pool(offering: &Offering): ID { offering.pool }
public fun minimum(offering: &Offering): u64 { offering.minimum }
public fun maximum(offering: &Offering): u64 { offering.maximum }
fun timestamp(offering: &Offering, offset: u128): u64 {
    if (offering.started_ms.is_none()) 0 else ((*offering.started_ms.borrow() as u128) + offset) as u64
}
public fun started(offering: &Offering): bool { offering.started_ms.is_some() }
public fun duration_ms(offering: &Offering): u64 { offering.duration_ms }
public fun opens_ms(offering: &Offering): u64 { timestamp(offering, 0) }
public fun closes_ms(offering: &Offering): u64 { timestamp(offering, offering.duration_ms as u128) }
public fun treasury(offering: &Offering): address { offering.treasury }
public fun liquidity(offering: &Offering): address { offering.liquidity }
public fun total_deposited(offering: &Offering): u64 { offering.total_deposited }
public fun accepted(offering: &Offering): u64 { offering.accepted }
public fun settled(offering: &Offering): bool { offering.settled }
public fun settled_ms(offering: &Offering): u64 { offering.settled_ms }
public fun community_remaining(offering: &Offering): u64 { offering.community_tokens.value() }
public fun combat_pot(offering: &Offering): ID { offering.combat_pot }
public fun combat_remaining(offering: &Offering): u64 { offering.combat_tokens.value() }
public fun deposits(offering: &Offering): u64 { offering.deposits.value() }
public fun sale_tokens(offering: &Offering): u64 { offering.sale_tokens.value() }
public fun liquidity_tokens(offering: &Offering): u64 { offering.liquidity_tokens.value() }
public fun contribution_offering(position: &Contribution): ID { position.offering }
public fun contribution_amount(position: &Contribution): u64 { position.amount }

#[test_only]
public fun contribution_for_testing(
    offering: &mut Offering, amount: u64, clock: &Clock, ctx: &mut TxContext,
): Contribution { new_contribution(offering, sui::coin::mint_for_testing<SUI>(amount, ctx), clock, ctx) }
