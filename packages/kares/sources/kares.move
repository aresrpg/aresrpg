/// Independent, once-issued currency. No mint authority survives publication.
module aresrpg_kares::kares;

use sui::balance::Balance;
use sui::coin::Coin;
use sui::coin_registry::{Self, Currency, MetadataCap};

public struct KARES has drop {}

/// Consumed once by offering setup; never transferable outside this module.
public struct Genesis has key {
    id: UID,
    inventory: Balance<KARES>,
    metadata_cap: MetadataCap<KARES>,
}

const UNIT: u64 = 1_000_000_000;
const SUPPLY: u64 = 1_000_000 * UNIT;

fun init(witness: KARES, ctx: &mut TxContext) {
    transfer::transfer(new_genesis(witness, ctx), ctx.sender());
}

fun new_genesis(witness: KARES, ctx: &mut TxContext): Genesis {
    let (mut currency, mut treasury) = coin_registry::new_currency_with_otw(
        witness, 9, b"KARES".to_string(), b"kAres".to_string(),
        b"Fixed-supply AresRPG community token. Burn KARES for Mastery rewards or stake to share funded rewards.".to_string(),
        b"https://launchpad.aresrpg.world/kares.png".to_string(), ctx,
    );
    let inventory = treasury.mint_balance(SUPPLY);
    currency.make_supply_burn_only(treasury);
    let metadata_cap = coin_registry::finalize(currency, ctx);
    Genesis { id: object::new(ctx), inventory, metadata_cap }
}

public fun unit(): u64 { UNIT }

public fun burn(currency: &mut Currency<KARES>, payment: Coin<KARES>) {
    currency.burn(payment);
}

public(package) fun consume(genesis: Genesis): (Balance<KARES>, MetadataCap<KARES>) {
    let Genesis { id, inventory, metadata_cap } = genesis;
    id.delete();
    (inventory, metadata_cap)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(KARES {}, ctx) }

#[test_only]
public fun genesis_for_testing(ctx: &mut TxContext): Genesis {
    new_genesis(KARES {}, ctx)
}
