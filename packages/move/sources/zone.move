// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Zone discovery and consumption state. Population itself is deterministic static law in
/// `aresrpg_math::zone_math`; this module owns only entropy, expiry, dynamic fields, and writes.
module aresrpg::zone;

use aresrpg::{character::Character, world::{Self, World}};
use aresrpg_seed::world_content::{Self, WorldContent};
use aresrpg_math::{world_map, zone_math::{Self, MobGroup, ResourcePack}};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event, random::RandomGenerator};

const EWrongWorld: u64 = 1301;
const ENothingThere: u64 = 1302;
const ENotSearched: u64 = 1303;
const RESEARCH_TTL_MS: u64 = 7_200_000;

public struct ZoneKey has copy, drop, store { zone_x: u32, zone_z: u32 }

public struct Zone has copy, drop, store {
  seed: u64,
  searched_at_ms: u64,
  mob_taken: u128,
  res_taken: vector<u8>,
}

public struct ZoneSearched has copy, drop { world: String, zone_x: u32, zone_z: u32, seed: u64, fresh: bool }

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
  let (zone_x, zone_z) = (x / size, z / size);
  let key = ZoneKey { zone_x, zone_z };
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
  event::emit(ZoneSearched { world: current, zone_x, zone_z, seed, fresh });
}

public fun mob_groups(world_object: &World, world_content: &WorldContent, zone_x: u32, zone_z: u32): vector<MobGroup> {
  assert_world_content(world_object, world_content);
  let zone = live_zone(world_object, zone_x, zone_z);
  zone_math::mob_groups_with_archis(
    world_map::mobs(world_content::data(world_content)),
    &world_content::archi_rows(world_content),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone_x,
    zone_z,
    zone.seed,
    zone.mob_taken,
  )
}

public(package) fun consume_mob_group(world_object: &mut World, zone_x: u32, zone_z: u32, index: u64) {
  assert!(index < 128, ENothingThere);
  let zone = live_zone_mut(world_object, zone_x, zone_z);
  let bit = 1u128 << (index as u8);
  assert!(zone.mob_taken & bit == 0, ENothingThere);
  zone.mob_taken = zone.mob_taken | bit;
}

public fun resource_pack_at(world_object: &World, world_content: &WorldContent, zone_x: u32, zone_z: u32, index: u64): ResourcePack {
  assert_world_content(world_object, world_content);
  let zone = live_zone(world_object, zone_x, zone_z);
  zone_math::resource_pack_at(
    world_map::resources(world_content::data(world_content)),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone_x,
    zone_z,
    zone.seed,
    &zone.res_taken,
    index,
  )
}

public(package) fun consume_resource_node(world_object: &mut World, world_content: &WorldContent, zone_x: u32, zone_z: u32, index: u64) {
  assert_world_content(world_object, world_content);
  let zone_read = live_zone(world_object, zone_x, zone_z);
  let total = zone_math::total_resource_nodes(
    world_map::resources(world_content::data(world_content)),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone_x,
    zone_z,
    zone_read.seed,
    index,
  );
  let zone = live_zone_mut(world_object, zone_x, zone_z);
  while ((zone.res_taken.length() as u64) <= index) zone.res_taken.push_back(0);
  let taken = &mut zone.res_taken[index];
  assert!(*taken < total, ENothingThere);
  *taken = *taken + 1;
}

public fun seed_of(world_object: &World, zone_x: u32, zone_z: u32): u64 {
  live_zone(world_object, zone_x, zone_z).seed
}

public fun level_bounds(zone_x: u32, zone_z: u32): (u64, u64) { zone_math::level_bounds(zone_x, zone_z) }

// check_world
/// Content from one world must never resolve another's spawns — the seam's one assert.
fun assert_world_content(world_object: &World, world_content: &WorldContent) {
  assert!(world_content::name(world_content) == world_object.name(), EWrongWorld);
}

// live_zone
fun live_zone(world_object: &World, zone_x: u32, zone_z: u32): Zone {
  let uid = world::uid(world_object);
  assert!(dfield::exists(uid, ZoneKey { zone_x, zone_z }), ENotSearched);
  *dfield::borrow(uid, ZoneKey { zone_x, zone_z })
}

// live_zone_mut
fun live_zone_mut(world_object: &mut World, zone_x: u32, zone_z: u32): &mut Zone {
  let uid = world::uid_mut(world_object);
  assert!(dfield::exists(uid, ZoneKey { zone_x, zone_z }), ENotSearched);
  dfield::borrow_mut(uid, ZoneKey { zone_x, zone_z })
}
