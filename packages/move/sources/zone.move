// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Zone discovery and consumption state. Population itself is deterministic static law in
/// `aresrpg_math::zone_math`; this module owns only entropy, expiry, dynamic fields, and writes.
module aresrpg::zone;

use aresrpg::{character::Character, world::{Self, World}};
use aresrpg_math::{world_map, zone_math::{Self, MobGroup, ResourcePack}};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event, random::RandomGenerator};

const EWrongWorld: u64 = 1301;
const ENothingThere: u64 = 1302;
const ENotSearched: u64 = 1303;
const RESEARCH_TTL_MS: u64 = 7_200_000;

public struct ZoneKey has copy, drop, store { zx: u32, zz: u32 }

public struct Zone has copy, drop, store {
  seed: u64,
  searched_at_ms: u64,
  mob_taken: u128,
  res_taken: vector<u8>,
}

public struct ZoneSearched has copy, drop { world: String, zx: u32, zz: u32, seed: u64, fresh: bool }

public(package) fun search(
  character: &mut Character,
  x: u32,
  z: u32,
  world_object: &mut World,
  generator: &mut RandomGenerator,
  clock: &Clock,
) {
  let current = world::prove_move(character, x, z, clock);
  assert!(current == world_object.name(), EWrongWorld);
  let size = zone_math::zone_size();
  let (zx, zz) = (x / size, z / size);
  let key = ZoneKey { zx, zz };
  let now = clock.timestamp_ms();
  let uid = world::uid_mut(world_object);
  let (seed, fresh) = if (dfield::exists(uid, key)) {
    let zone: &mut Zone = dfield::borrow_mut(uid, key);
    if (now >= zone.searched_at_ms + RESEARCH_TTL_MS) {
      zone.seed = generator.generate_u32() as u64;
      zone.searched_at_ms = now;
      zone.mob_taken = 0;
      zone.res_taken = vector[];
      (zone.seed, true)
    } else {
      (zone.seed, false)
    }
  } else {
    let seed = generator.generate_u32() as u64;
    dfield::add(uid, key, Zone { seed, searched_at_ms: now, mob_taken: 0, res_taken: vector[] });
    (seed, true)
  };
  event::emit(ZoneSearched { world: current, zx, zz, seed, fresh });
}

public fun mob_groups(world_object: &World, zx: u32, zz: u32): vector<MobGroup> {
  let zone = lz(world_object, zx, zz);
  zone_math::mob_groups(
    world_map::mobs(world::content(world_object)),
    world_map::biome_map(world::content(world_object)),
    zx,
    zz,
    zone.seed,
    zone.mob_taken,
  )
}

public(package) fun consume_mob_group(world_object: &mut World, zx: u32, zz: u32, index: u64) {
  assert!(index < 128, ENothingThere);
  let zone = lzm(world_object, zx, zz);
  let bit = 1u128 << (index as u8);
  assert!(zone.mob_taken & bit == 0, ENothingThere);
  zone.mob_taken = zone.mob_taken | bit;
}

public fun resource_pack_at(world_object: &World, zx: u32, zz: u32, index: u64): ResourcePack {
  let zone = lz(world_object, zx, zz);
  zone_math::resource_pack_at(
    world_map::resources(world::content(world_object)),
    world_map::biome_map(world::content(world_object)),
    zx,
    zz,
    zone.seed,
    &zone.res_taken,
    index,
  )
}

public(package) fun consume_resource_node(world_object: &mut World, zx: u32, zz: u32, index: u64) {
  let zone_read = lz(world_object, zx, zz);
  let total = zone_math::total_resource_nodes(
    world_map::resources(world::content(world_object)),
    world_map::biome_map(world::content(world_object)),
    zx,
    zz,
    zone_read.seed,
    index,
  );
  let zone = lzm(world_object, zx, zz);
  while ((zone.res_taken.length() as u64) <= index) zone.res_taken.push_back(0);
  let taken = &mut zone.res_taken[index];
  assert!(*taken < total, ENothingThere);
  *taken = *taken + 1;
}

public fun seed_of(world_object: &World, zx: u32, zz: u32): u64 {
  lz(world_object, zx, zz).seed
}

public fun portal_of(world_object: &World, zx: u32, zz: u32): (bool, u32, u32) {
  zone_math::portal_of(
    world_map::dungeon_room_count(world::content(world_object)) > 0,
    seed_of(world_object, zx, zz),
    zx,
    zz,
  )
}

public fun level_floor(zx: u32, zz: u32): u64 { zone_math::level_floor(zx, zz) }

// live_zone
fun lz(world_object: &World, zx: u32, zz: u32): Zone {
  let uid = world::uid(world_object);
  assert!(dfield::exists(uid, ZoneKey { zx, zz }), ENotSearched);
  *dfield::borrow(uid, ZoneKey { zx, zz })
}

// live_zone_mut
fun lzm(world_object: &mut World, zx: u32, zz: u32): &mut Zone {
  let uid = world::uid_mut(world_object);
  assert!(dfield::exists(uid, ZoneKey { zx, zz }), ENotSearched);
  dfield::borrow_mut(uid, ZoneKey { zx, zz })
}
