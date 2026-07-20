// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RUN — the `RunPass`: §9's "the key IS the run object." A NON-TRANSFERABLE bound pass minted when a key is
/// consumed, carrying the room counter (starts at 1), the activation character, the pre-entry world position
/// (§17.25), and — while a room fight is live — a `commit` LATCH to that fight. This module owns the TYPE + its
/// lifecycle PRIMITIVES; `dungeon` composes them with the key burn, world lock, roster read, and fight bridge.
///
/// ┌─ NON-TRANSFERABLE BY ABILITY (§9 "bound") ─────────────────────────────────────────────────────────────┐
/// │ `RunPass` has `key` ONLY — no `store`. So `transfer::public_transfer` does not compile for it, and       │
/// │ `transfer::transfer` is callable only inside THIS (its defining) module. There is NO user-facing transfer │
/// │ entry anywhere, so a player can never hand their run to another address (compile-level non-transferability)│
/// │ The `owner` field is the belt-and-suspenders binding: every acting path asserts `owner == sender`          │
/// │ (`assert_owner`), so even a hypothetical move leaves an unusable pass.                                     │
/// └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
///
/// ┌─ THE FIGHT LATCH (§9 — the pass NEVER leaves its owner) ────────────────────────────────────────────────┐
/// │ There is NO escrow. `NEXT FIGHT` / join stamp the pass's `commit` latch — `some(fight, character)` —     │
/// │ after verifying owner + activation character; `latch` asserts the latch was EMPTY. Settlement is          │
/// │ oracle-driven off the seat's SOULBOUND `FightResult`: a match against the latch proves the result is this │
/// │ pass's, then victory advances (completion/defeat consume) and clears the latch.                            │
/// └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
module aresrpg_dungeon::run;

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ROOM_START: u16 = 1; // §9 — the room counter starts at 1

const EWrongRoom: u64 = 101; // a pass is not at the asserted room (§9 — join must share the fight's room)
const ENotOwner: u64 = 102; // an acting path was called by someone other than the pass's bound owner
const ENotSingleKeyUnit: u64 = 103; // activation burned != 1 key unit (§9 — exactly one unit becomes the run)
const EAlreadyLatched: u64 = 104; // latch: the pass is already committed to a fight (§9 — one fight at a time)
const ENotInFight: u64 = 105; // settle: the pass holds no fight latch (nothing to settle)
const EWrongFight: u64 = 106; // settle: the FightResult is from a different fight than the pass's latch
const EWrongCharacter: u64 = 107; // act/settle: character differs from the pass's activation character

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The pass's live commitment: the fight it is latched to + the character it seated there. Set by `latch` at
/// NEXT-FIGHT/join, matched against the seat's `FightResult` at settlement, cleared on victory-advance.
public struct Commitment has store, copy, drop { fight: ID, character: ID }

/// The bound run. `key` ONLY → non-transferable. `room` is the 1-based progress counter; `return_x/z` freeze the
/// pre-entry position; `owner` binds it; `character` is the only character this run may seat or release; `commit`
/// is the live fight latch (`none` = free to NEXT FIGHT or abandon).
public struct RunPass has key {
  id: UID,
  world: ID,
  room: u16,
  owner: address,
  return_x: u32,
  return_z: u32,
  commit: Option<Commitment>,
  character: ID,
}

// ╔════════════════ [ Mint (package-private — only `dungeon::activate`) ] ═════ ]

/// Mint a fresh character-bound run at room 1. The pass id is also the character's in-dungeon world-lock token.
public(package) fun new(
  world: ID,
  owner: address,
  return_x: u32,
  return_z: u32,
  character: ID,
  ctx: &mut TxContext,
): RunPass {
  RunPass {
    id: object::new(ctx), world, room: ROOM_START, owner, return_x, return_z,
    commit: option::none(), character,
  }
}

/// Mint + BIND the run to `owner`, returning its id. The `key`-only transfer is legal only in this module.
public(package) fun mint_and_bind(
  world: ID,
  owner: address,
  return_x: u32,
  return_z: u32,
  character: ID,
  ctx: &mut TxContext,
): ID {
  let pass = new(world, owner, return_x, return_z, character, ctx);
  let pass_id = object::id(&pass);
  transfer::transfer(pass, owner);
  pass_id
}

// ╔════════════════ [ Reads (FREE — RPC + the fight bridge derive from these) ] ═ ]

public fun world(self: &RunPass): ID { self.world }
public fun room(self: &RunPass): u16 { self.room }
public fun owner(self: &RunPass): address { self.owner }
public fun return_x(self: &RunPass): u32 { self.return_x }
public fun return_z(self: &RunPass): u32 { self.return_z }
public fun character(self: &RunPass): ID { self.character }
public fun id(self: &RunPass): ID { object::id(self) }

/// Is the pass currently latched to a fight? (`some` = in a fight; a latched pass cannot NEXT FIGHT again.)
public fun is_latched(self: &RunPass): bool { self.commit.is_some() }

/// The fight the pass is latched to, if any (RPC: "which fight is this run in").
public fun latched_fight(self: &RunPass): Option<ID> {
  if (self.commit.is_some()) option::some(self.commit.borrow().fight) else option::none()
}

/// Is the pass at the dungeon's LAST room? The victory that clears it consumes the pass instead of advancing it.
public fun is_last_room(self: &RunPass, room_count: u64): bool { (self.room as u64) >= room_count }

// ╔════════════════ [ Guards (package-internal — act auth + settlement match) ] ═ ]

public(package) fun assert_owner(self: &RunPass, who: address) {
  assert!(self.owner == who, ENotOwner);
}

public(package) fun assert_at_room(self: &RunPass, room: u16) {
  assert!(self.room == room, EWrongRoom);
}

public(package) fun assert_character(self: &RunPass, character: ID) {
  assert!(self.character == character, EWrongCharacter);
}

/// Abort unless exactly ONE key unit was burned — §9's "split ONE unit off your key stack."
public(package) fun assert_single_key_unit(amount: u64) { assert!(amount == 1, ENotSingleKeyUnit); }

/// Prove the caller's outcome belongs to this pass and its activation character.
public(package) fun assert_commit_match(self: &RunPass, fight: ID, character: ID) {
  assert!(self.commit.is_some(), ENotInFight);
  let c = self.commit.borrow();
  assert!(c.fight == fight, EWrongFight);
  assert!(c.character == character && character == self.character, EWrongCharacter);
}

// ╔════════════════ [ Latch (package-internal — NEXT FIGHT / join stamp) ] ═══ ]

public(package) fun latch(self: &mut RunPass, fight: ID, character: ID) {
  assert_character(self, character);
  assert!(self.commit.is_none(), EAlreadyLatched);
  self.commit.fill(Commitment { fight, character });
}

public(package) fun clear_commit(self: &mut RunPass) { self.commit = option::none(); }

// ╔════════════════ [ Lifecycle mutations (package-internal) ] ═══════════════ ]

public(package) fun advance_room(self: &mut RunPass) { self.room = self.room + 1; }

public(package) fun return_to_owner(self: RunPass) {
  let owner = self.owner;
  transfer::transfer(self, owner);
}

/// Consume the pass and return `(world, owner, character, return_x, return_z)` for the branded world release.
public(package) fun consume(self: RunPass): (ID, address, ID, u32, u32) {
  let RunPass { id, world, room: _, owner, return_x, return_z, commit: _, character } = self;
  object::delete(id);
  (world, owner, character, return_x, return_z)
}
