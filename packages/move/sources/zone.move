// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Zone discovery and consumption state. Population itself is deterministic static law in
/// `aresrpg_math::zone_math`; this module owns only entropy, expiry, and consumption writes.
/// Each discovered zone is its own shared object, so activity in distinct zones is parallel.
module aresrpg::zone;

use aresrpg::{character::Character, world::{Self, World}};
use aresrpg_seed::world_content::{Self, WorldContent};
use aresrpg_math::{world_map, zone_math::{Self, MobGroup, ResourcePack}};
use std::string::String;
use sui::{clock::Clock, derived_object, event, random::RandomGenerator};

const EWrongWorld: u64 = 1301;
const ENothingThere: u64 = 1302;
const EWrongZone: u64 = 1303;
const RESEARCH_TTL_MS: u64 = 7_200_000;

/// Stable address key derived under the world's UID. This is the one zone identity formula.
public struct ZoneKey has copy, drop, store { zone_x: u32, zone_z: u32 }

/// Independent shared mutable state for one discovered zone.
public struct Zone has key {
  id: UID,
  world: String,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  searched_at_ms: u64,
  mob_taken: u128,
  res_taken: vector<u8>,
}

public struct ZoneSearched has copy, drop { world: String, zone_x: u32, zone_z: u32, seed: u64, fresh: bool }

/// First discovery claims the deterministic zone address under its World, then shares it.
public(package) fun create(
  character: &mut Character,
  x: u32,
  z: u32,
  world_object: &mut World,
  generator: &mut RandomGenerator,
  clock: &Clock,
) {
  let current = world::prove_move(character, x, z, clock);
  let world = world_object.name();
  assert!(current == world, EWrongWorld);
  let size = zone_math::zone_size();
  let (zone_x, zone_z) = (x / size, z / size);
  let seed = generator.generate_u32() as u64;
  let zone = Zone {
    id: derived_object::claim(world::uid_mut(world_object), ZoneKey { zone_x, zone_z }),
    world,
    zone_x,
    zone_z,
    seed,
    searched_at_ms: clock.timestamp_ms(),
    mob_taken: 0,
    res_taken: vector[],
  };
  event::emit(ZoneSearched { world, zone_x, zone_z, seed, fresh: true });
  transfer::share_object(zone);
}

/// A known zone refreshes in place. Before expiry this is an idempotent observation.
public(package) fun refresh(
  character: &mut Character,
  x: u32,
  z: u32,
  zone: &mut Zone,
  generator: &mut RandomGenerator,
  clock: &Clock,
) {
  assert_zone(zone, x / zone_math::zone_size(), z / zone_math::zone_size());
  let current = world::prove_move(character, x, z, clock);
  assert!(current == zone.world, EWrongWorld);
  let now = clock.timestamp_ms();
  let fresh = now >= zone.searched_at_ms + RESEARCH_TTL_MS;
  if (fresh) {
    zone.seed = generator.generate_u32() as u64;
    zone.searched_at_ms = now;
    zone.mob_taken = 0;
    zone.res_taken = vector[];
  };
  event::emit(ZoneSearched {
    world: zone.world,
    zone_x: zone.zone_x,
    zone_z: zone.zone_z,
    seed: zone.seed,
    fresh,
  });
}

public fun mob_groups(zone: &Zone, world_content: &WorldContent): vector<MobGroup> {
  assert_world_content(zone, world_content);
  zone_math::mob_groups_with_archis(
    world_map::mobs(world_content::data(world_content)),
    &world_content::archi_rows(world_content),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone.zone_x,
    zone.zone_z,
    zone.seed,
    zone.mob_taken,
  )
}

public(package) fun consume_mob_group(zone: &mut Zone, index: u64) {
  assert!(index < 128, ENothingThere);
  let bit = 1u128 << (index as u8);
  assert!(zone.mob_taken & bit == 0, ENothingThere);
  zone.mob_taken = zone.mob_taken | bit;
}

public fun resource_pack_at(zone: &Zone, world_content: &WorldContent, index: u64): ResourcePack {
  assert_world_content(zone, world_content);
  zone_math::resource_pack_at(
    world_map::resources(world_content::data(world_content)),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone.zone_x,
    zone.zone_z,
    zone.seed,
    &zone.res_taken,
    index,
  )
}

public(package) fun consume_resource_node(zone: &mut Zone, world_content: &WorldContent, index: u64) {
  assert_world_content(zone, world_content);
  let total = zone_math::total_resource_nodes(
    world_map::resources(world_content::data(world_content)),
    world_map::biome_map(world_content::data(world_content)),
    &world_map::cities(world_content::data(world_content)),
    zone.zone_x,
    zone.zone_z,
    zone.seed,
    index,
  );
  while ((zone.res_taken.length() as u64) <= index) zone.res_taken.push_back(0);
  let taken = &mut zone.res_taken[index];
  assert!(*taken < total, ENothingThere);
  *taken = *taken + 1;
}

public fun seed_of(zone: &Zone): u64 { zone.seed }

public fun level_bounds(zone: &Zone): (u64, u64) { zone_math::level_bounds(zone.zone_x, zone.zone_z) }

public(package) fun world_name(zone: &Zone): String { zone.world }

fun assert_world_content(zone: &Zone, world_content: &WorldContent) {
  assert!(world_content::name(world_content) == zone.world, EWrongWorld);
}

fun assert_zone(zone: &Zone, zone_x: u32, zone_z: u32) {
  assert!(zone.zone_x == zone_x && zone.zone_z == zone_z, EWrongZone);
}

#[test_only]
public(package) fun for_testing(
  world: String,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  ctx: &mut TxContext,
): Zone {
  Zone {
    id: object::new(ctx), world, zone_x, zone_z, seed, searched_at_ms: 0,
    mob_taken: 0, res_taken: vector[],
  }
}

#[test_only]
public(package) fun destroy_for_testing(zone: Zone) {
  let Zone {
    id, world: _, zone_x: _, zone_z: _, seed: _, searched_at_ms: _, mob_taken: _, res_taken: _,
  } = zone;
  id.delete();
}
