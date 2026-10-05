/// One fixed boss bounty per Fight, paid equally to its authoritative winning seats.
module aresrpg::fight_rewards;

use aresrpg_combat::combat::{Self, Fighter};
use aresrpg_rewards::{combat_rewards::{Self, CombatPot}, economy::{Self, Economy}};
use aresrpg_math::mob_data;
use aresrpg_seed::mob_rows::MobTemplate;
use sui::clock::Clock;

/// Only this module can construct the witness accepted by the independent monetary package.
public struct BossVictory has drop {}

public struct FightRewards has copy, drop, store {
    weight: u64,
    paid: Option<u64>,
}

public(package) fun new(): FightRewards { FightRewards { weight: 0, paid: option::none() } }

public(package) fun add_mob(rewards: &mut FightRewards, template: &MobTemplate, fighter: &Fighter) {
    if (mob_data::is_boss(template.data())) rewards.weight = rewards.weight + combat::level(fighter);
}

/// Runs before terminal Random. Everyone is paid atomically, including disconnected winners.
public(package) fun allocate<Token>(
    rewards: &mut FightRewards, economy: &Economy, pot: &mut CombatPot<Token>,
    recipients: vector<address>, clock: &Clock, ctx: &mut TxContext,
) {
    if (rewards.weight == 0 || rewards.paid.is_some()) return;
    let count = recipients.length();
    assert!(count > 0, 0);
    economy::assert_combat_pot(economy, pot);
    let mut bounty = combat_rewards::take(
        pot, BossVictory {}, rewards.weight, count, clock, ctx,
    );
    let share = bounty.value() / count;
    rewards.paid = option::some(share);
    if (share > 0) {
        let mut index = 0;
        while (index < count) {
            transfer::public_transfer(bounty.split(share).into_coin(ctx), recipients[index]);
            index = index + 1;
        };
    };
    bounty.destroy_zero();
}

/// A proof against the same shared object makes funding/settlement races serialize safely.
public(package) fun unfunded(rewards: &mut FightRewards, economy: &Economy) {
    assert!(!economy::is_funded(economy), 0);
    if (rewards.paid.is_none()) rewards.paid = option::some(0);
}

public(package) fun ready(rewards: &FightRewards): bool { rewards.weight == 0 || rewards.paid.is_some() }
public(package) fun amount(rewards: &FightRewards): u64 { rewards.paid.get_with_default(0) }

#[test_only]
public(package) fun boss_for_testing(level: u64): FightRewards {
    FightRewards { weight: level, paid: option::none() }
}
