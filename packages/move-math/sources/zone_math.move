// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Deterministic zone population derived from immutable world content and a stored seed.
/// Search entropy, expiry, consumption, and dynamic fields remain in the game package.
module aresrpg_math::zone_math;

use aresrpg_math::{prng, world_map::{Self, BiomeMap, MobRow, ResourceRow}};
use std::string::String;

const ENothingThere: u64 = 1302;
const ZONE_SIZE: u32 = 512;
const GROUPS_MIN: u64 = 48;
const GROUPS_MAX: u64 = 64;
const RES_PACKS_MIN: u64 = 24;
const RES_PACKS_MAX: u64 = 42;
const GROUP_SIZE_FULL_AT: u64 = 10_000;
const GROUP_SIZE_AVG3_AT: u64 = 2_000;
const LEVEL_RAMP_AT: u64 = 20_000;
const LEVEL_LOW_CAP: u64 = 75;
const LEVEL_HIGH_CAP: u64 = 100;
const NODES_RAMP_AT: u64 = 20_000;
const HOMOGENEOUS_BP: u64 = 5_000;
const PORTAL_BP: u64 = 1_000;

public struct MobGroup has copy, drop {
  index: u64,
  x: u32,
  z: u32,
  members: vector<MobMember>,
}

public struct MobMember has copy, drop {
  mob_type: String,
  level_scalar: u8,
}

public struct ResourcePack has copy, drop {
  index: u64,
  x: u32,
  z: u32,
  item_type: String,
  nodes: u8,
}

public fun zone_size(): u32 { ZONE_SIZE }

fun distance_blocks(zx: u32, zz: u32): u64 {
  let center = world_map::world_center() as u64;
  let px = (zx as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
  let pz = (zz as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
  let dx = if (px >= center) px - center else center - px;
  let dz = if (pz >= center) pz - center else center - pz;
  if (dx >= dz) dx else dz
}

fun ramp(distance: u64, full_at: u64, from: u64, to: u64): u64 {
  let capped = if (distance > full_at) full_at else distance;
  from + (to - from) * capped / full_at
}

fun group_size_bounds(distance: u64): (u64, u64) {
  let low = ramp(distance, GROUP_SIZE_FULL_AT, 1, 6);
  // At 2,000 blocks low=2 and high=4: uniform 2..4 has the authored average of three.
  let high_raw = ramp(distance, GROUP_SIZE_AVG3_AT * 5 / 3, 1, 6);
  (low, if (high_raw < low) low else high_raw)
}

fun level_bounds_at_distance(distance: u64): (u64, u64) {
  (
    ramp(distance, LEVEL_RAMP_AT, 0, LEVEL_LOW_CAP),
    ramp(distance, LEVEL_RAMP_AT, 0, LEVEL_HIGH_CAP),
  )
}

fun biome_mob_rows(rows: vector<MobRow>, map: &BiomeMap, zx: u32, zz: u32): vector<MobRow> {
  let biome = world_map::biome_of_zone(map, zx, zz);
  rows.filter!(|row| world_map::mob_row_biomes(row).contains(&biome))
}

public fun families(rows: vector<MobRow>, map: &BiomeMap, zx: u32, zz: u32): vector<String> {
  biome_mob_rows(rows, map, zx, zz).map!(|row| world_map::mob_row_type(&row))
}

fun weighted_family(rows: &vector<MobRow>, total: u64, state: &mut u64): String {
  let roll = prng::draw(state) % total;
  let mut accumulated = 0u64;
  let mut index = 0;
  loop {
    accumulated = accumulated + (world_map::mob_row_weight_bp(&rows[index]) as u64);
    if (roll < accumulated) return world_map::mob_row_type(&rows[index]);
    index = index + 1;
  }
}

public fun mob_groups(
  rows: vector<MobRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
  seed: u64,
  taken: u128,
): vector<MobGroup> {
  let rows = biome_mob_rows(rows, map, zx, zz);
  if (rows.is_empty()) return vector[];
  let total = rows.fold!(0u64, |sum, row| sum + (world_map::mob_row_weight_bp(&row) as u64));
  let distance = distance_blocks(zx, zz);
  let mut state = prng::rng_seed(prng::mix(seed, 2));
  let count = GROUPS_MIN + prng::draw(&mut state) % (GROUPS_MAX - GROUPS_MIN + 1);
  let (size_lo, size_hi) = group_size_bounds(distance);
  let (level_lo, level_hi) = level_bounds_at_distance(distance);
  let mut groups = vector[];
  let mut index = 0u64;
  while (index < count) {
    let x = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let z = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let size = size_lo + prng::draw(&mut state) % (size_hi - size_lo + 1);
    let homogeneous = prng::draw(&mut state) % 10_000 < HOMOGENEOUS_BP;
    let family = weighted_family(&rows, total, &mut state);
    let mut members = vector[];
    let mut member_index = 0u64;
    while (member_index < size) {
      let mob_type = if (homogeneous) family else weighted_family(&rows, total, &mut state);
      let scalar = level_lo + prng::draw(&mut state) % (level_hi - level_lo + 1);
      members.push_back(MobMember { mob_type, level_scalar: scalar as u8 });
      member_index = member_index + 1;
    };
    if (taken & (1u128 << (index as u8)) == 0) {
      groups.push_back(MobGroup { index, x, z, members });
    };
    index = index + 1;
  };
  groups
}

#[test_only]
public fun group_size_bounds_for_testing(distance: u64): vector<u64> {
  let (low, high) = group_size_bounds(distance);
  vector[low, high]
}

#[test_only]
public fun level_bounds_for_testing(distance: u64): vector<u64> {
  let (low, high) = level_bounds_at_distance(distance);
  vector[low, high]
}

public fun resource_families(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
): vector<String> {
  let biome = world_map::biome_of_zone(map, zx, zz);
  rows
    .filter!(|row| world_map::resource_row_biomes(row).contains(&biome))
    .map!(|row| world_map::resource_row_type(&row))
}

fun all_resource_packs(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
  seed: u64,
): vector<ResourcePack> {
  let families = resource_families(rows, map, zx, zz);
  if (families.is_empty()) return vector[];
  let distance = distance_blocks(zx, zz);
  let mut state = prng::rng_seed(prng::mix(seed, 3));
  let nodes_lo = ramp(distance, NODES_RAMP_AT, 2, 16);
  let nodes_hi = ramp(distance, NODES_RAMP_AT, 4, 22);
  let count = RES_PACKS_MIN + prng::draw(&mut state) % (RES_PACKS_MAX - RES_PACKS_MIN + 1);
  let mut packs = vector[];
  let mut index = 0u64;
  while (index < count) {
    let x = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let z = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let item_type = families[prng::draw(&mut state) % families.length()];
    let nodes = nodes_lo + prng::draw(&mut state) % (nodes_hi - nodes_lo + 1);
    packs.push_back(ResourcePack { index, x, z, item_type, nodes: nodes as u8 });
    index = index + 1;
  };
  packs
}

fun taken_of(taken: &vector<u8>, index: u64): u8 {
  if (index < taken.length()) taken[index] else 0
}

public fun resource_packs(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
  seed: u64,
  taken: &vector<u8>,
): vector<ResourcePack> {
  let all = all_resource_packs(rows, map, zx, zz, seed);
  let mut live = vector[];
  let mut cursor = 0;
  while (cursor < all.length()) {
    let ResourcePack { index, x, z, item_type, nodes } = all[cursor];
    let consumed = taken_of(taken, index);
    if (consumed < nodes) {
      live.push_back(ResourcePack { index, x, z, item_type, nodes: nodes - consumed });
    };
    cursor = cursor + 1;
  };
  live
}

public fun resource_pack_at(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
  seed: u64,
  taken: &vector<u8>,
  index: u64,
): ResourcePack {
  let packs = all_resource_packs(rows, map, zx, zz, seed);
  assert!(index < packs.length(), ENothingThere);
  let ResourcePack { index: pack_index, x, z, item_type, nodes } = packs[index];
  let consumed = taken_of(taken, index);
  assert!(consumed < nodes, ENothingThere);
  ResourcePack { index: pack_index, x, z, item_type, nodes: nodes - consumed }
}

public fun total_resource_nodes(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  zx: u32,
  zz: u32,
  seed: u64,
  index: u64,
): u8 {
  let packs = all_resource_packs(rows, map, zx, zz, seed);
  assert!(index < packs.length(), ENothingThere);
  packs[index].nodes
}

public fun portal_of(has_dungeon: bool, seed: u64, zx: u32, zz: u32): (bool, u32, u32) {
  if (!has_dungeon) return (false, 0, 0);
  let mut state = prng::rng_seed(prng::mix(seed, 5));
  if (prng::draw(&mut state) % 10_000 >= PORTAL_BP) return (false, 0, 0);
  let x = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
  let z = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
  (true, x, z)
}

public fun level_bounds(zx: u32, zz: u32): (u64, u64) {
  level_bounds_at_distance(distance_blocks(zx, zz))
}

public fun group_index(group: &MobGroup): u64 { group.index }

public fun group_x(group: &MobGroup): u32 { group.x }

public fun group_z(group: &MobGroup): u32 { group.z }

public fun group_members(group: &MobGroup): vector<MobMember> { group.members }

public fun member_type(member: &MobMember): String { member.mob_type }

public fun member_level_scalar(member: &MobMember): u8 { member.level_scalar }

public fun new_member(mob_type: String, level_scalar: u8): MobMember { MobMember { mob_type, level_scalar } }

public fun pack_index(pack: &ResourcePack): u64 { pack.index }

public fun pack_x(pack: &ResourcePack): u32 { pack.x }

public fun pack_z(pack: &ResourcePack): u32 { pack.z }

public fun pack_item_type(pack: &ResourcePack): String { pack.item_type }

public fun pack_nodes(pack: &ResourcePack): u8 { pack.nodes }
