// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEON LOCK — additive dynamic state that makes a character's `world:dungeon` transition enforceable.
/// The lock is keyed directly on the kiosk-locked Character, so its layout does not alter the frozen Character
/// struct. Ordinary world writes consult `assert_unlocked`; only the pinned dungeon witness can add/remove a lock
/// through `character_link`'s branded doors. The pass id is the in-dungeon world token and the stored `world` is
/// the sole release destination.
module aresrpg::dungeon_lock;

use aresrpg::character::{Self, Character};
use sui::dynamic_field as df;

const EAlreadyLocked: u64 = 101;
const ENotLocked: u64 = 102;
const EWrongLock: u64 = 103;

public struct DungeonLockKey has copy, drop, store {}

public struct DungeonLock has copy, drop, store {
  pass: ID,
  world: ID,
}

public(package) fun assert_unlocked(character: &Character) {
  assert!(!is_locked(character), EAlreadyLocked);
}

public(package) fun lock(character: &mut Character, pass: ID, world: ID) {
  assert_unlocked(character);
  df::add(character::uid_mut(character), DungeonLockKey {}, DungeonLock { pass, world });
}

public(package) fun unlock(character: &mut Character, pass: ID, world: ID) {
  assert!(is_locked(character), ENotLocked);
  let lock: DungeonLock = df::remove(character::uid_mut(character), DungeonLockKey {});
  assert!(lock.pass == pass && lock.world == world, EWrongLock);
}

public fun is_locked(character: &Character): bool {
  df::exists(character.uid(), DungeonLockKey {})
}

public fun pass(character: &Character): Option<ID> {
  if (is_locked(character)) {
    option::some(df::borrow<DungeonLockKey, DungeonLock>(character.uid(), DungeonLockKey {}).pass)
  } else option::none()
}

public fun world(character: &Character): Option<ID> {
  if (is_locked(character)) {
    option::some(df::borrow<DungeonLockKey, DungeonLock>(character.uid(), DungeonLockKey {}).world)
  } else option::none()
}
