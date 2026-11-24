/// Interface of the one Aftermath AMM door the liquidity token calls. The chain links the real
/// module; this body only lets the package compile and its test run.
module amm::pool;

use sui::url::Url;

public struct CreatePoolCapV2 has key, store { id: UID }

public fun create_pool_cap_and_set_decimals<LP: drop>(
    _witness: LP, _symbol: vector<u8>, _name: vector<u8>, _description: vector<u8>, _icon: Option<Url>,
    _coin_decimals: Option<vector<u8>>, _respect_decimals: bool, _weights: vector<u64>, _flatness: u64,
    ctx: &mut TxContext,
): CreatePoolCapV2 {
    CreatePoolCapV2 { id: object::new(ctx) }
}
