// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FIGHT_LATCH — the character-keyed, sharded chain-liveness book for live fight seats.
///
/// This family is deliberately distinct from `fight_registry::FightRegistry`: registries are scope-keyed
/// derived-object parents, while latches answer a global fact about one character. A create takes one of each;
/// a join and result-open touch only the character's latch shard. Even when both indexes are equal, the shared
/// objects and their state remain distinct.
///
/// The latch is shared-family-homed rather than a Character dynamic field so a mid-fight character sale cannot
/// brick the buyer. Its key includes the consumer brand: a foreign witness cannot latch-grief another consumer.
module aresrpg_fight::fight_latch;

use aresrpg_fight::fight_registry;
use std::type_name::TypeName;
use sui::table::{Self, Table};

const ECharacterInFight: u64 = 103; // create/join: the character is already seated in a live fight for this brand
const EWrongShard: u64 = 104; // every latch door: this is not the shard the character maps to

/// One character-latch shard. Shared once at init and never moved.
public struct FightLatch has key {
  id: UID,
  index: u64,
  active_fighters: Table<LatchKey, ID>,
}

/// Read-only directory for the latch family, ordered by the one shared shard-index function.
public struct FightLatchShards has key {
  id: UID,
  shards: vector<ID>,
}

/// The brand-scoped latch key (S-46 witness law).
public struct LatchKey has copy, drop, store { brand: TypeName, character: ID }

/// Resolve the latch shard for a CHARACTER. Uses the registry module's shard-index function; there is no twin
/// implementation to drift.
public fun shard_for(book: &FightLatchShards, character: ID): ID {
  book.shards[fight_registry::shard_index(character)]
}

public fun shards(book: &FightLatchShards): vector<ID> { book.shards }
public fun index(latch: &FightLatch): u64 { latch.index }

public fun assert_character(latch: &FightLatch, character: ID) {
  assert!(latch.index == fight_registry::shard_index(character), EWrongShard);
}

fun init(ctx: &mut TxContext) {
  let mut shards = vector[];
  let mut i = 0;
  while (i < fight_registry::shard_count()) {
    let shard = FightLatch { id: object::new(ctx), index: i, active_fighters: table::new(ctx) };
    shards.push_back(object::id(&shard));
    transfer::share_object(shard);
    i = i + 1;
  };
  transfer::share_object(FightLatchShards { id: object::new(ctx), shards });
}

/// Latch `character` into `fight`. Every real create/join seat path runs this.
public(package) fun latch_character(latch: &mut FightLatch, brand: TypeName, character: ID, fight: ID) {
  assert_character(latch, character);
  let key = LatchKey { brand, character };
  assert!(!latch.active_fighters.contains(key), ECharacterInFight);
  latch.active_fighters.add(key, fight);
}

/// Clear one outcome holder's latch at the consumer's result-open door. Missing is tolerated for test-only seats.
public(package) fun unlatch_character(latch: &mut FightLatch, brand: TypeName, character: ID) {
  assert_character(latch, character);
  let key = LatchKey { brand, character };
  if (latch.active_fighters.contains(key)) { latch.active_fighters.remove(key); };
}

/// The live fight for `character`, if any. Ask only the character's own shard.
public fun character_fight(latch: &FightLatch, brand: TypeName, character: ID): Option<ID> {
  assert_character(latch, character);
  let key = LatchKey { brand, character };
  if (latch.active_fighters.contains(key)) option::some(*latch.active_fighters.borrow(key)) else option::none()
}

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun latch_for_testing(latch: &mut FightLatch, brand: TypeName, character: ID, fight: ID) {
  latch_character(latch, brand, character, fight);
}
