// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE ONE-LIVE-FIGHT LATCH, across scopes.
///
/// The latch exists to stop one character being seated in two live fights at once — the multi-fight farm off a
/// single stale HP snapshot. Its key is `(brand, character)`, which is a GLOBAL fact about a character, so the
/// authority that answers it cannot depend on which fight is asking.
///
/// Sharding the registry by SCOPE put that authority in the scope's table, and a character can be rostered into
/// two scopes at once (two kolizeum lobbies is the shipped path — kolizeum takes an immutable character id and
/// runs no `fight_marker`). Two lobbies whose ids land on different shards then latch the same character twice,
/// each shard seeing an empty table. This suite is the wall against that.
#[test_only]
module aresrpg_fight::latch_authority_tests;

use aresrpg_fight::{fight, fight_latch::{Self, FightLatch, FightLatchShards}, fight_registry, fight_scaffold::stand_up};
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xA;
const CHARACTER: address = @0xC0;
// Two scopes whose LAST BYTE differs, so they map to different shards (0xa0 → 0, 0xb7 → 7).
const SCOPE_A: address = @0xa0;
const SCOPE_B: address = @0xb7;

/// The latch authority for a CHARACTER — the shard its own id maps to, whatever fight is asking.
fun latch_shard(sc: &ts::Scenario, character: ID): FightLatch {
  let book = sc.take_shared<FightLatchShards>();
  let shard = fight_latch::shard_for(&book, character);
  ts::return_shared(book);
  ts::take_shared_by_id<FightLatch>(sc, shard)
}

#[test]
#[expected_failure(abort_code = 103, location = aresrpg_fight::fight_latch)]
/// The same character, latched under two scopes that live on DIFFERENT shards. The second latch must abort
/// `ECharacterInFight` — the character is already in a live fight, and which scope asks changes nothing.
fun the_same_character_cannot_latch_under_two_scopes() {
  let mut sc = ts::begin(OWNER);
  stand_up(&mut sc);
  sc.next_tx(OWNER);

  let brand = std::type_name::with_defining_ids<fight::TestBrand>();
  let character = object::id_from_address(CHARACTER);
  let scope_a = object::id_from_address(SCOPE_A);
  let scope_b = object::id_from_address(SCOPE_B);
  assert!(fight_registry::shard_index(scope_a) != fight_registry::shard_index(scope_b), 0);

  // The authority is the CHARACTER's shard both times — the scope cannot choose it, which is the whole fix.
  let mut reg_a = latch_shard(&sc, character);
  fight_latch::latch_character(&mut reg_a, brand, character, object::id_from_address(@0xF1));
  ts::return_shared(reg_a);

  sc.next_tx(OWNER);
  let mut reg_b = latch_shard(&sc, character);
  fight_latch::latch_character(&mut reg_b, brand, character, object::id_from_address(@0xF2));
  ts::return_shared(reg_b);
  abort 9999
}
