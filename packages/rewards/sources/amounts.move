/// Whole-token allocations and the one conversion from Mastery points to currency.
module aresrpg_rewards::amounts;

const UNIT: u64 = 1_000_000_000;
const MASTERY_UNIT: u64 = 1_000 * UNIT;
const EPriceOverflow: u64 = 0;

public fun unit(): u64 { UNIT }
public fun initial_supply(): u64 { 1_000_000_000 * UNIT }
public fun staking_tokens(): u64 { 200_000_000 * UNIT }
public fun combat_tokens(): u64 { 100_000_000 * UNIT }
public fun community_tokens(): u64 { 110_000_000 * UNIT }
public fun team_tokens(): u64 { 30_000_000 * UNIT }
public fun reserve_tokens(): u64 { staking_tokens() + combat_tokens() + community_tokens() }
public fun duration_ms(): u64 { 1_825 * 86_400_000 }
public fun mastery_tokens(): u64 { 1_000 }

public fun mastery_price(points: u64): u64 {
    let price = (points as u128) * (MASTERY_UNIT as u128);
    assert!(price <= (std::u64::max_value!() as u128), EPriceOverflow);
    price as u64
}
