/// Fixed community reserve; only its treasury can claim the wall-clock vested balance.
module aresrpg_rewards::community;

use aresrpg_rewards::amounts;
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::Coin;

const ENotTreasury: u64 = 0;
const ENothingVested: u64 = 1;
const EInvalidReserve: u64 = 2;

public struct CommunityPool<phantom Token> has key {
    id: UID,
    treasury: address,
    started_ms: u64,
    remaining: Balance<Token>,
}

public struct CommunityClaimed<phantom Token> has copy, drop {
    pool: ID,
    amount: u64,
}

public(package) fun create<Token>(
    reserve: Balance<Token>, treasury: address, clock: &Clock, ctx: &mut TxContext,
): CommunityPool<Token> {
    assert!(reserve.value() == amounts::community_tokens(), EInvalidReserve);
    CommunityPool { id: object::new(ctx), treasury, started_ms: clock.timestamp_ms(), remaining: reserve }
}

public(package) fun share<Token>(pool: CommunityPool<Token>) { transfer::share_object(pool) }

public fun claim<Token>(pool: &mut CommunityPool<Token>, clock: &Clock, ctx: &mut TxContext): Coin<Token> {
    assert!(ctx.sender() == pool.treasury, ENotTreasury);
    let amount = claimable(pool, clock);
    assert!(amount > 0, ENothingVested);
    sui::event::emit(CommunityClaimed<Token> { pool: object::id(pool), amount });
    pool.remaining.split(amount).into_coin(ctx)
}

public fun claimable<Token>(pool: &CommunityPool<Token>, clock: &Clock): u64 {
    let elapsed = (clock.timestamp_ms() - pool.started_ms).min(amounts::duration_ms());
    let vested = ((amounts::community_tokens() as u128) * (elapsed as u128) / (amounts::duration_ms() as u128)) as u64;
    vested - (amounts::community_tokens() - pool.remaining.value())
}

public fun remaining<Token>(pool: &CommunityPool<Token>): u64 { pool.remaining.value() }

#[test_only]
public fun destroy_for_testing<Token>(pool: CommunityPool<Token>) {
    let CommunityPool { id, treasury: _, started_ms: _, remaining } = pool;
    id.delete();
    sui::balance::destroy_for_testing(remaining);
}
