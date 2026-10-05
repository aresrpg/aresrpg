/// Retired type identity required by the published game's public signatures and Trade layout.
module aresrpg_kares::kares;

public struct KARES has drop {}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    let (currency, treasury) = sui::coin_registry::new_currency_with_otw(
        KARES {}, 9, b"OLD".to_string(), b"Retired test currency".to_string(),
        b"Compatibility tests only".to_string(), b"".to_string(), ctx,
    );
    transfer::public_transfer(sui::coin_registry::finalize(currency, ctx), ctx.sender());
    transfer::public_transfer(treasury, ctx.sender());
}
