// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The 20 hardcoded worlds + everything about a character's place in them. Position lives as
/// dynamic fields ON the character (one checkpoint per visited world — automatic memory), so
/// joining and moving touch zero shared objects. The shared `World` objects carry per-world
/// content settings (mobs, resources, dungeon key — designed later) and load only when read.
module aresrpg::world;

use aresrpg::character::Character;
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EUnknownWorld: u64 = 301;
const ELevelTooLow: u64 = 302;
const ENotInWorld: u64 = 303;
const EOutOfBounds: u64 = 304;
const ETravelTooFar: u64 = 305;

const WORLD_SIZE: u32 = 500_000;
/// Chain coords are unsigned — the center maps to the client's 0;0 (the corner-bug law).
const WORLD_CENTER: u32 = 250_000;
/// Game-wide, blocks/sec ×100 fixed-point — engine RUN_SPEED 10.5 b/s +10% terrain slack.
const SPEED_BUDGET: u64 = 1150;
const SPEED_SCALE: u64 = 100_000; // ÷100 (fixed-point) then ÷1000 (ms→s)
const PET_NUM: u64 = 3; // pet = ×1.5
const PET_DEN: u64 = 2;
const MAX_LINEAR: u64 = 1_000_000; // dwarfs any in-world distance; overflow guard for the square

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One shared object per world — the content settings home (mobs, resources, dungeon key;
/// designed later). Identity and entry level are hardcoded law, never object state.
public struct World has key {
  id: UID,
  name: String,
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

// ╔════════════════ [ init — the 20 worlds ] ═════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  let mut names = world_names();
  while (!names.is_empty()) {
    transfer::share_object(World { id: object::new(ctx), name: names.pop_back() });
  };
}

// ╔════════════════ [ Travel ] ═══════════════════════════════════════════════ ]

/// Join or switch — allowed anytime, the level requirement checks EVERY time. First visit
/// spawns at the world center; a revisit restores that world's own checkpoint.
public fun join_world(character: &mut Character, world: String, clock: &Clock) {
  assert!(character.level() >= entry_level(&world), ELevelTooLow);

  let character_id = character.id();
  let uid = character.uid_mut();
  if (dfield::exists(uid, CurrentWorldKey {})) {
    *dfield::borrow_mut(uid, CurrentWorldKey {}) = world;
  } else {
    dfield::add(uid, CurrentWorldKey {}, world);
  };

  let first_join = !dfield::exists(uid, CheckpointKey(world));
  if (first_join) {
    dfield::add(
      uid,
      CheckpointKey(world),
      Checkpoint { x: WORLD_CENTER, z: WORLD_CENTER, at_ms: clock.timestamp_ms(), pet: false },
    );
  };
  let cp: &Checkpoint = dfield::borrow(uid, CheckpointKey(world));
  event::emit(WorldJoined { character: character_id, world, x: cp.x, z: cp.z, first_join });
}

/// Every future world interaction (fight, gather, …) calls this: proves the character could
/// have walked from its last checkpoint to (x, z) at the speed budget, then saves the new
/// position. Returns the current world name for the caller's own logic.
public(package) fun prove_move(character: &mut Character, x: u32, z: u32, clock: &Clock): String {
  assert!(x < WORLD_SIZE && z < WORLD_SIZE, EOutOfBounds);
  let uid = character.uid_mut();
  assert!(dfield::exists(uid, CurrentWorldKey {}), ENotInWorld);
  let world: String = *dfield::borrow(uid, CurrentWorldKey {});

  let cp: &mut Checkpoint = dfield::borrow_mut(uid, CheckpointKey(world));
  let now = clock.timestamp_ms();
  assert!(travel_ok(cp, x, z, now), ETravelTooFar);
  cp.x = x;
  cp.z = z;
  cp.at_ms = now;
  world
}

/// Exact squared-distance compare (consensus path — no sqrt), saturating overflow guard.
fun travel_ok(cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64): bool {
  if (now_ms < cp.at_ms) return false;
  let eff = if (cp.pet) SPEED_BUDGET * PET_NUM / PET_DEN else SPEED_BUDGET;
  let budget = (now_ms - cp.at_ms) * eff / SPEED_SCALE; // blocks
  if (budget >= MAX_LINEAR) return true;
  let dx = abs_diff(to_x, cp.x);
  let dz = abs_diff(to_z, cp.z);
  budget * budget >= dx * dx + dz * dz
}

fun abs_diff(a: u32, b: u32): u64 {
  if (a > b) ((a - b) as u64) else ((b - a) as u64)
}

// ╔════════════════ [ The 20 worlds — hardcoded law ] ════════════════════════ ]

/// Entry level of a world — the single gate function. Aborts `EUnknownWorld` on any other name.
public fun entry_level(world: &String): u16 {
  if (*world == b"01_first_shore".to_string()) return 1;
  if (*world == b"02_verdant_hollow".to_string()) return 1;
  if (*world == b"03_emberfall_steppe".to_string()) return 10;
  if (*world == b"04_mistral_heights".to_string()) return 14;
  if (*world == b"05_drowned_fen".to_string()) return 18;
  if (*world == b"06_pandora_reach".to_string()) return 22;
  if (*world == b"07_cinderforge_depths".to_string()) return 30;
  if (*world == b"08_palewood".to_string()) return 34;
  if (*world == b"09_coral_throne".to_string()) return 40;
  if (*world == b"10_sunspire_dunes".to_string()) return 45;
  if (*world == b"11_rootheart".to_string()) return 52;
  if (*world == b"12_static_fields".to_string()) return 60;
  if (*world == b"13_mirrormere".to_string()) return 68;
  if (*world == b"14_charnel_marches".to_string()) return 75;
  if (*world == b"15_silent_atoll".to_string()) return 82;
  if (*world == b"16_the_sundering".to_string()) return 95;
  if (*world == b"17_obsidian_choir".to_string()) return 110;
  if (*world == b"18_abyssal_weald".to_string()) return 125;
  if (*world == b"19_hollow_crown".to_string()) return 145;
  if (*world == b"20_zenith_scar".to_string()) return 170;
  abort EUnknownWorld
}

fun world_names(): vector<String> {
  vector[
    b"01_first_shore".to_string(),
    b"02_verdant_hollow".to_string(),
    b"03_emberfall_steppe".to_string(),
    b"04_mistral_heights".to_string(),
    b"05_drowned_fen".to_string(),
    b"06_pandora_reach".to_string(),
    b"07_cinderforge_depths".to_string(),
    b"08_palewood".to_string(),
    b"09_coral_throne".to_string(),
    b"10_sunspire_dunes".to_string(),
    b"11_rootheart".to_string(),
    b"12_static_fields".to_string(),
    b"13_mirrormere".to_string(),
    b"14_charnel_marches".to_string(),
    b"15_silent_atoll".to_string(),
    b"16_the_sundering".to_string(),
    b"17_obsidian_choir".to_string(),
    b"18_abyssal_weald".to_string(),
    b"19_hollow_crown".to_string(),
    b"20_zenith_scar".to_string(),
  ]
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
