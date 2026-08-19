// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The 20 hardcoded worlds + everything about a character's place in them. Position lives as
/// dynamic fields ON the character (one checkpoint per visited world — automatic memory), so
/// joining and moving touch zero shared objects. The shared `World` objects carry per-world
/// content settings (mobs, resources, dungeon key — designed later) and load only when read.
module aresrpg::world;

use aresrpg::{character::Character, equipment, progression};
use aresrpg_math::world_map::{Self, WorldContent};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ELevelTooLow: u64 = 302;
const ENotInWorld: u64 = 303;
const EOutOfBounds: u64 = 304;
const ETravelTooFar: u64 = 305;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One shared object per world — the content settings home. Filled by the seeding
/// (SeedCap-gated doors, so the one seal closes world content too); after the seal no door can
/// ever write again — immutability by door-absence. Identity and entry level stay hardcoded law.
public struct World has key {
  id: UID,
  name: String,
  content: WorldContent,
}

/// DF key on the character → the world it is in NOW (a `String` world name).
public struct CurrentWorldKey has copy, drop, store {}

/// DF key on the character → its `Checkpoint` in that world. One per visited world.
public struct CheckpointKey(String) has copy, drop, store;

/// The last proven position — everything the speed check needs rides here.
public struct Checkpoint has copy, drop, store {
  x: u32,
  z: u32,
  at_ms: u64,
  pet: bool, // ×1.5 speed; written by the equipment layer later
}

public struct WorldJoined has copy, drop { character: ID, world: String, x: u32, z: u32, first_join: bool }
public struct WorldCreated has copy, drop { world: ID, name: String }

// ╔════════════════ [ init — the 20 worlds ] ═════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  let mut names = world_map::world_names();
  while (!names.is_empty()) {
    let name = names.pop_back();
    let world = World {
      id: object::new(ctx),
      name,
      content: world_map::empty_world_content(),
    };
    event::emit(WorldCreated { world: object::id(&world), name });
    transfer::share_object(world);
  };
}

/// Zone state rides the World's UID — the zone module is the only writer.
public(package) fun uid(world: &World): &UID { &world.id }

public(package) fun uid_mut(world: &mut World): &mut UID { &mut world.id }

/// Static content reads/writes cross this custody seam. Only package code can obtain the mutable
/// reference; the public math functions operating on it therefore add no authoring authority.
public(package) fun content(world: &World): &WorldContent { &world.content }

public(package) fun content_mut(world: &mut World): &mut WorldContent { &mut world.content }

// ╔════════════════ [ Content reads ] ═════════════════════════════════════════ ]

public fun name(world: &World): String { world.name }

// ╔════════════════ [ Travel ] ═══════════════════════════════════════════════ ]

/// The STAR GATE (ruling 2026-08-09): every world's portal stands at its center (client 0;0).
/// Switching requires WALKING to the portal — the character proves travel to the center of its
/// CURRENT world, then materializes at the DESTINATION portal. A fresh character (no world
/// yet) joins free: there is no origin gate to walk to. The level requirement checks every
/// time. Package-private: the public door is `api::join_world` (kiosk-borrowing).
public(package) fun join_world(character: &mut Character, world: String, clock: &Clock) {
  assert!(character.level() >= world_map::entry_level(&world), ELevelTooLow);
  progression::touch(character, clock);

  let character_id = character.id();
  let now = clock.timestamp_ms();
  let center = world_map::world_center();
  let in_a_world = dfield::exists(character.uid_mut(), CurrentWorldKey {});
  // Reaching the gate coord IS the whole proof — the speed check to the portal.
  if (in_a_world) { prove_move(character, center, center, clock); };

  let uid = character.uid_mut();
  if (in_a_world) {
    *dfield::borrow_mut(uid, CurrentWorldKey {}) = world;
  } else {
    dfield::add(uid, CurrentWorldKey {}, world);
  };

  // Arrival = the destination portal. The pet flag RE-DERIVES from the live equipment —
  // a stale flag from a past visit would be free speed (or stolen speed) forever.
  let pet = equipment::pet_equipped(character);
  let uid = character.uid_mut();
  let first_join = !dfield::exists(uid, CheckpointKey(world));
  if (first_join) {
    dfield::add(uid, CheckpointKey(world), Checkpoint { x: center, z: center, at_ms: now, pet });
  } else {
    let cp: &mut Checkpoint = dfield::borrow_mut(uid, CheckpointKey(world));
    cp.x = center;
    cp.z = center;
    cp.at_ms = now;
    cp.pet = pet;
  };
  event::emit(WorldJoined { character: character_id, world, x: center, z: center, first_join });
}

/// Every future world interaction (fight, gather, …) calls this: proves the character could
/// have walked from its last checkpoint to (x, z) at the speed budget, then saves the new
/// position. Returns the current world name for the caller's own logic.
public(package) fun prove_move(character: &mut Character, x: u32, z: u32, clock: &Clock): String {
  assert!(x < world_map::world_size() && z < world_map::world_size(), EOutOfBounds);
  progression::touch(character, clock);
  // The ×1.5 pet speed is a BOTH-END rule (audit 2026-08-10): a pet on the slot NOW earns
  // the boost only over a leg that also STARTED with a pet — never retroactively over time
  // banked before it was equipped. `cp.pet` is the start-point snapshot; this saves the
  // live state as the next leg's start.
  let pet_now = equipment::pet_equipped(character);
  let (world, cp) = ccm(character);
  let now = clock.timestamp_ms();
  assert!(world_map::travel_ok(cp.x, cp.z, cp.at_ms, cp.pet, x, z, now, pet_now), ETravelTooFar);
  cp.x = x;
  cp.z = z;
  cp.at_ms = now;
  cp.pet = pet_now;
  world
}

/// ROOT the character in place until `extra_ms` from now (the hytale gather-time law,
/// owner 2026-08-10): a FUTURE-dated checkpoint makes `travel_ok` refuse every proof —
/// no move, no next gather, no fight join — until the clock catches up. The gather duration
/// rides the machinery that already exists instead of a new timer field.
public(package) fun delay_checkpoint(character: &mut Character, extra_ms: u64, clock: &Clock) {
  let (_, cp) = ccm(character);
  cp.at_ms = clock.timestamp_ms() + extra_ms;
}

/// Is the character ROOTED right now? A future-dated checkpoint (`at_ms > now`) means a
/// gather-time root or a fired protector verdict is holding them — no action may fire until
/// the clock catches up. Every out-of-fight action door that isn't itself a `prove_move`
/// (consumables) must gate on this, or a recall potion would wipe the root.
public(package) fun is_rooted(character: &Character, clock: &Clock): bool {
  let uid = character.uid();
  assert!(dfield::exists(uid, CurrentWorldKey {}), ENotInWorld);
  let world: String = *dfield::borrow(uid, CurrentWorldKey {});
  let cp: &Checkpoint = dfield::borrow(uid, CheckpointKey(world));
  cp.at_ms > clock.timestamp_ms()
}

/// TELEPORT TO CENTER (the recall consumable): the checkpoint jumps to the world portal
/// (client 0;0), exactly like a fresh arrival — the pet flag re-derives, the clock resets.
public(package) fun teleport_center(character: &mut Character, clock: &Clock) {
  let pet = equipment::pet_equipped(character);
  let now = clock.timestamp_ms();
  let center = world_map::world_center();
  let (_, cp) = ccm(character);
  cp.x = center;
  cp.z = center;
  cp.at_ms = now;
  cp.pet = pet;
}

// current_checkpoint_mut
/// The ONE door to the current world's checkpoint — every writer (`prove_move`,
/// `delay_checkpoint`) reads and mutates through here; nobody re-derives the DF pair.
fun ccm(character: &mut Character): (String, &mut Checkpoint) {
  let uid = character.uid_mut();
  assert!(dfield::exists(uid, CurrentWorldKey {}), ENotInWorld);
  let world: String = *dfield::borrow(uid, CurrentWorldKey {});
  (world, dfield::borrow_mut(uid, CheckpointKey(world)))
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
