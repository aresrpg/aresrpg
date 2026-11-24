/// The AresRPG currency. Publication issues the whole supply once; no mint authority survives it.
module aresrpg_currency::kares;

use sui::balance::Balance;
use sui::coin::Coin;
use sui::coin_registry;

const UNIT: u64 = 1_000_000_000;
const LIQUIDITY_TOKENS: u64 = 540_000_000 * UNIT;
const RESERVE_TOKENS: u64 = 410_000_000 * UNIT;
const TEAM_TOKENS: u64 = 50_000_000 * UNIT;

public struct KARES has drop {}

/// The whole supply before launch. It cannot be transferred; only `split` opens it.
public struct Genesis has key {
    id: UID,
    supply: Balance<KARES>,
}

fun init(witness: KARES, ctx: &mut TxContext) {
    let (mut currency, mut treasury) = coin_registry::new_currency_with_otw(
        witness, 9, b"KARES".to_string(), b"KARES".to_string(),
        b"KARES is the AresRPG game token.".to_string(), b"https://aresrpg.world/kares.png".to_string(), ctx,
    );
    let supply = treasury.mint_balance(LIQUIDITY_TOKENS + RESERVE_TOKENS + TEAM_TOKENS);
    currency.make_supply_burn_only(treasury);
    transfer::public_transfer(currency.finalize(ctx), ctx.sender());
    transfer::transfer(Genesis { id: object::new(ctx), supply }, ctx.sender());
}

/// Opens the supply into its three fixed shares: locked liquidity, reward reserves, team.
public fun split(genesis: Genesis, ctx: &mut TxContext): (Coin<KARES>, Coin<KARES>, Coin<KARES>) {
    let Genesis { id, mut supply } = genesis;
    id.delete();
    let liquidity = supply.split(LIQUIDITY_TOKENS).into_coin(ctx);
    let reserves = supply.split(RESERVE_TOKENS).into_coin(ctx);
    (liquidity, reserves, supply.into_coin(ctx))
}

public fun liquidity_tokens(): u64 { LIQUIDITY_TOKENS }
public fun reserve_tokens(): u64 { RESERVE_TOKENS }
public fun team_tokens(): u64 { TEAM_TOKENS }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(KARES {}, ctx) }
