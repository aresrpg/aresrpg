/// Retired layout retained solely for the published game's aborting compatibility door.
module aresrpg_kares::offering;
use aresrpg_kares::kares::KARES;
use sui::balance::Balance;
use sui::sui::SUI;

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

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): Offering {
    Offering { id: object::new(ctx), pool: @0x0.to_id(), minimum: 0, maximum: 0,
        started_ms: option::none(), duration_ms: 0, treasury: @0x0, liquidity: @0x0,
        deposits: sui::balance::zero(), sale_tokens: sui::balance::zero(),
        liquidity_tokens: sui::balance::zero(), total_deposited: 0, accepted: 0,
        settled: false, community_tokens: sui::balance::zero(), settled_ms: 0,
        combat_pot: @0x0.to_id(), combat_tokens: sui::balance::zero() }
}
