/// Retired layout retained solely for the published game's aborting compatibility door.
module aresrpg_kares::combat_rewards;
use aresrpg_kares::kares::KARES;
use sui::balance::Balance;
use std::type_name::TypeName;

public struct CombatPot has key {
    id: UID,
    balance: Balance<KARES>,
    authorized: Option<TypeName>,
    epoch: u64,
    epoch_started_ms: u64,
    work: u64,
    quota: u64,
    day: u64,
    spent: u64,
}

#[test_only]
public fun create_for_testing(ctx: &mut TxContext): CombatPot {
    CombatPot { id: object::new(ctx), balance: sui::balance::zero(), authorized: option::none(),
        epoch: 0, epoch_started_ms: 0, work: 0, quota: 0, day: 0, spent: 0 }
}
