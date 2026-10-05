/// Standalone testnet fixture: issues one billion tokens once, then destroys mint authority.
module kares_test_token::kares;

use sui::coin_registry;

public struct KARES has drop {}

fun init(witness: KARES, ctx: &mut TxContext) {
    let (mut currency, mut treasury) = coin_registry::new_currency_with_otw(
        witness, 9, b"KARES".to_string(), b"KARES Test Token".to_string(),
        b"Testnet-only reward system rehearsal token.".to_string(),
        b"https://aresrpg.world/kares.png".to_string(), ctx,
    );
    transfer::public_transfer(treasury.mint(1_000_000_000_000_000_000, ctx), ctx.sender());
    currency.make_supply_burn_only(treasury);
    transfer::public_transfer(coin_registry::finalize(currency, ctx), ctx.sender());
}
