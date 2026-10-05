#[test_only]
module aresrpg_rewards::test_coin;

use sui::coin::Coin;
use sui::coin_registry::{Self, Currency};
use sui::test_scenario::Scenario;

public struct TEST_COIN has drop {}
public struct Victory has drop {}

public fun mint(supply: u64, decimals: u8, burnable: bool, ctx: &mut TxContext) {
    let (mut currency, mut cap) = coin_registry::new_currency_with_otw(
        TEST_COIN {}, decimals, b"TEST".to_string(), b"Test currency".to_string(),
        b"Unit-test fixture".to_string(), b"https://example.com/test.png".to_string(), ctx,
    );
    transfer::public_transfer(cap.mint(supply, ctx), ctx.sender());
    if (burnable) currency.make_supply_burn_only(cap) else currency.make_supply_fixed(cap);
    transfer::public_transfer(coin_registry::finalize(currency, ctx), ctx.sender());
}

public fun take(scenario: &Scenario): (Currency<TEST_COIN>, Coin<TEST_COIN>) {
    (scenario.take_from_address<Currency<TEST_COIN>>(@0xC), scenario.take_from_sender<Coin<TEST_COIN>>())
}
