/// One funded setup binds the reward contracts to exactly one native currency.
module aresrpg_rewards::economy;

use aresrpg_rewards::{amounts, combat_rewards, community, staking};
use std::type_name;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::coin_registry::Currency;
use sui::package::{Self, UpgradeCap};

const EWrongUpgradeCap: u64 = 0;
const EWrongCurrency: u64 = 1;
const EWrongFunding: u64 = 2;
const EInvalidTreasury: u64 = 3;
const EAlreadyFunded: u64 = 4;

public struct Setup has key, store { id: UID }

/// Published once, before a token exists. Funding permanently binds its currency and reserves.
public struct Economy has key {
    id: UID,
    token: std::ascii::String,
    currency: ID,
    staking_pool: ID,
    combat_pot: ID,
    community_pool: ID,
    started_ms: u64,
}

public struct Funded<phantom Token> has copy, drop {
    economy: ID,
    currency: ID,
    staking_pool: ID,
    combat_pot: ID,
    community_pool: ID,
    started_ms: u64,
}

fun init(ctx: &mut TxContext) {
    transfer::transfer(Setup { id: object::new(ctx) }, ctx.sender());
    transfer::share_object(unfunded(ctx));
}

/// Funding consumes Setup once and borrows upgrade authority until the final project freeze.
public fun setup<Token, Victory: drop>(
    setup: Setup, economy: &mut Economy, upgrade_cap: &UpgradeCap, currency: &Currency<Token>,
    reserve: Coin<Token>, treasury: address, clock: &Clock, ctx: &mut TxContext,
) {
    assert!(economy.token.is_empty(), EAlreadyFunded);
    let original = std::type_name::with_original_ids<Setup>().address_string();
    assert!(package::version(upgrade_cap) == 1
        && package::upgrade_policy(upgrade_cap) == package::compatible_policy()
        && sui::address::to_ascii_string(package::upgrade_package(upgrade_cap).to_address()) == original,
        EWrongUpgradeCap);
    assert!(currency.decimals() == 9 && currency.is_supply_burn_only(), EWrongCurrency);
    assert!(reserve.value() == amounts::reserve_tokens(), EWrongFunding);
    assert!(treasury != @0x0 && treasury == ctx.sender(), EInvalidTreasury);
    let Setup { id } = setup;
    id.delete();
    let mut reserve = reserve.into_balance();
    let mut staking_pool = staking::create(reserve.split(amounts::staking_tokens()), ctx);
    staking::activate(&mut staking_pool, clock);
    let combat_pot = combat_rewards::create<Token, Victory>(reserve.split(amounts::combat_tokens()), clock, ctx);
    let community_pool = community::create(reserve.withdraw_all(), treasury, clock, ctx);
    reserve.destroy_zero();
    economy.token = type_name::with_original_ids<Token>().into_string();
    economy.currency = object::id(currency);
    economy.staking_pool = object::id(&staking_pool);
    economy.combat_pot = object::id(&combat_pot);
    economy.community_pool = object::id(&community_pool);
    economy.started_ms = clock.timestamp_ms();
    sui::event::emit(Funded<Token> {
        economy: object::id(economy), currency: economy.currency,
        staking_pool: economy.staking_pool, combat_pot: economy.combat_pot,
        community_pool: economy.community_pool, started_ms: economy.started_ms,
    });
    staking::share(staking_pool);
    combat_rewards::share(combat_pot);
    community::share(community_pool);
}

public fun assert_currency<Token>(economy: &Economy, currency: &Currency<Token>) {
    assert_token<Token>(economy);
    assert!(economy.currency == object::id(currency), EWrongCurrency);
}

public fun assert_combat_pot<Token>(economy: &Economy, pot: &combat_rewards::CombatPot<Token>) {
    assert_token<Token>(economy);
    assert!(economy.combat_pot == object::id(pot), EWrongCurrency);
}

public fun is_funded(economy: &Economy): bool { !economy.token.is_empty() }

public fun assert_token<Token>(economy: &Economy) {
    assert!(!economy.token.is_empty()
        && economy.token == type_name::with_original_ids<Token>().into_string(), EWrongCurrency);
}

fun unfunded(ctx: &mut TxContext): Economy {
    Economy { id: object::new(ctx), token: b"".to_ascii_string(), currency: @0x0.to_id(),
        staking_pool: @0x0.to_id(), combat_pot: @0x0.to_id(), community_pool: @0x0.to_id(), started_ms: 0 }
}

#[test_only]
public fun unfunded_for_testing(ctx: &mut TxContext): Economy { unfunded(ctx) }

#[test_only]
public fun setup_for_testing(ctx: &mut TxContext): Setup { Setup { id: object::new(ctx) } }

#[test_only]
public fun economy_for_testing<Token>(currency: ID, combat_pot: ID, ctx: &mut TxContext): Economy {
    Economy { id: object::new(ctx), token: type_name::with_original_ids<Token>().into_string(),
        currency, staking_pool: @0x0.to_id(), combat_pot, community_pool: @0x0.to_id(), started_ms: 0 }
}

#[test_only]
public fun destroy_for_testing(economy: Economy) {
    let Economy { id, token: _, currency: _, staking_pool: _, combat_pot: _, community_pool: _, started_ms: _ } = economy;
    id.delete();
}

#[test_only]
public fun share_for_testing(economy: Economy) { transfer::share_object(economy) }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
