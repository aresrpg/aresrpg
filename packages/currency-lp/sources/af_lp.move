/// Liquidity token of the KARES/SUI Aftermath pool. Aftermath names this module and type, and
/// takes the mint authority into the pool when the pool is created.
module aresrpg_currency_lp::af_lp;

use amm::pool;

// 18-decimal fixed point, in the pool's coin order: SUI sorts before every published coin.
const SUI_WEIGHT: u64 = 200_000_000_000_000_000;
const KARES_WEIGHT: u64 = 800_000_000_000_000_000;

public struct AF_LP has drop {}

fun init(witness: AF_LP, ctx: &mut TxContext) {
    let cap = pool::create_pool_cap_and_set_decimals(
        witness, b"KARES-SUI-LP", b"KARES SUI Aftermath LP", b"Aftermath LP coin for the KARES/SUI pool.",
        option::none(), option::some(vector[9, 9]), true, vector[SUI_WEIGHT, KARES_WEIGHT], 0, ctx,
    );
    transfer::public_transfer(cap, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(AF_LP {}, ctx) }
