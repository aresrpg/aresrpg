// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Deterministic zone population derived from immutable world content and a stored seed.
/// Search entropy, expiry, consumption, and dynamic fields remain in the game package.
module aresrpg_math::zone_math;

use aresrpg_math::{city_map::{Self, City}, prng, world_map::{Self, ArchiRow, BiomeMap, MobRow, ResourceRow}};
use std::string::String;

const ENothingThere: u64 = 1302;
const ZONE_SIZE: u32 = 512;
const GROUPS_MIN: u64 = 48;
const GROUPS_MAX: u64 = 64;
const RES_PACKS_MIN: u64 = 24;
const RES_PACKS_MAX: u64 = 42;
const CITY_RESOURCE_NODE_NUMERATOR: u64 = 3;
const CITY_RESOURCE_NODE_DENOMINATOR: u64 = 2;
const GROUP_SIZE_FULL_AT: u64 = 10_000;
const GROUP_SIZE_AVG3_AT: u64 = 2_000;
const LEVEL_RAMP_AT: u64 = 20_000;
const LEVEL_LOW_CAP: u64 = 75;
const LEVEL_HIGH_CAP: u64 = 100;
const NODES_RAMP_AT: u64 = 20_000;
const HOMOGENEOUS_BP: u64 = 5_000;
const ARCHIMOB_BP: u64 = 100;

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

fun archi_type(rows: &vector<ArchiRow>, ordinary_type: &String): String {
  let mut index = 0;
  while (index < rows.length()) {
    if (&world_map::archi_row_ordinary(&rows[index]) == ordinary_type) return world_map::archi_row_replacement(&rows[index]);
    index = index + 1;
  };
  b"".to_string()
}

fun replacement_for_roll(rows: &vector<ArchiRow>, ordinary_type: String, roll: u64): String {
  if (roll >= ARCHIMOB_BP) return ordinary_type;
  let replacement = archi_type(rows, &ordinary_type);
  if (!replacement.is_empty()) replacement else ordinary_type
}

public fun zone_size(): u32 { ZONE_SIZE }

fun distance_blocks(zone_x: u32, zone_z: u32): u64 {
  let center = world_map::world_center() as u64;
  let px = (zone_x as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
  let pz = (zone_z as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
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

fun population_mob_rows(rows: vector<MobRow>, map: &BiomeMap, cities: &vector<City>, zone_x: u32, zone_z: u32): vector<MobRow> {
  let city = city_map::city_index_at(cities, zone_x, zone_z);
  if (city.is_some()) {
    let city = *city.borrow();
    return rows.filter!(|row| world_map::mob_row_cities(row).contains(&city))
  };
  let biome = world_map::biome_of_zone(map, zone_x, zone_z);
  rows.filter!(|row| world_map::mob_row_biomes(row).contains(&biome))
}

public fun families(rows: vector<MobRow>, map: &BiomeMap, cities: &vector<City>, zone_x: u32, zone_z: u32): vector<String> {
  population_mob_rows(rows, map, cities, zone_x, zone_z).map!(|row| world_map::mob_row_type(&row))
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

fun mob_groups_inner(
  rows: vector<MobRow>,
  archi_rows: &vector<ArchiRow>,
  map: &BiomeMap,
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  taken: u128,
): vector<MobGroup> {
  let rows = population_mob_rows(rows, map, cities, zone_x, zone_z);
  if (rows.is_empty()) return vector[];
  let total = rows.fold!(0u64, |sum, row| sum + (world_map::mob_row_weight_bp(&row) as u64));
  let distance = distance_blocks(zone_x, zone_z);
  let mut state = prng::rng_seed(prng::mix(seed, 2));
  let mut archi_state = prng::rng_seed(prng::mix(seed, 4));
  let count = GROUPS_MIN + prng::draw(&mut state) % (GROUPS_MAX - GROUPS_MIN + 1);
  let (size_lo, size_hi) = group_size_bounds(distance);
  let (level_lo, level_hi) = level_bounds_at_distance(distance);
  let mut groups = vector[];
  let mut index = 0u64;
  while (index < count) {
    let x = (zone_x * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let z = (zone_z * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let size = size_lo + prng::draw(&mut state) % (size_hi - size_lo + 1);
    let homogeneous = prng::draw(&mut state) % 10_000 < HOMOGENEOUS_BP;
    let family = weighted_family(&rows, total, &mut state);
    let mut members = vector[];
    let mut member_index = 0u64;
    while (member_index < size) {
      let ordinary_type = if (homogeneous) family else weighted_family(&rows, total, &mut state);
      let scalar = level_lo + prng::draw(&mut state) % (level_hi - level_lo + 1);
      let mob_type = replacement_for_roll(archi_rows, ordinary_type, prng::draw(&mut archi_state) % 10_000);
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

public fun mob_groups(
  rows: vector<MobRow>, map: &BiomeMap, cities: &vector<City>, zone_x: u32, zone_z: u32, seed: u64, taken: u128,
): vector<MobGroup> {
  // Retained only because deleting an existing public signature breaks compatible upgrades.
  mob_groups_inner(rows, &vector[], map, cities, zone_x, zone_z, seed, taken)
}

public fun mob_groups_with_archis(
  rows: vector<MobRow>, archi_rows: &vector<ArchiRow>, map: &BiomeMap, cities: &vector<City>, zone_x: u32,
  zone_z: u32, seed: u64, taken: u128,
): vector<MobGroup> {
  mob_groups_inner(rows, archi_rows, map, cities, zone_x, zone_z, seed, taken)
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
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
): vector<String> {
  let city = city_map::city_index_at(cities, zone_x, zone_z);
  if (city.is_some()) {
    let city = *city.borrow();
    return rows
      .filter!(|row| world_map::resource_row_cities(row).contains(&city))
      .map!(|row| world_map::resource_row_type(&row))
  };
  let biome = world_map::biome_of_zone(map, zone_x, zone_z);
  rows
    .filter!(|row| world_map::resource_row_biomes(row).contains(&biome))
    .map!(|row| world_map::resource_row_type(&row))
}

fun all_resource_packs(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
): vector<ResourcePack> {
  let families = resource_families(rows, map, cities, zone_x, zone_z);
  if (families.is_empty()) return vector[];
  let city = city_map::city_index_at(cities, zone_x, zone_z).is_some();
  let distance = distance_blocks(zone_x, zone_z);
  let mut state = prng::rng_seed(prng::mix(seed, 3));
  let nodes_lo = ramp(distance, NODES_RAMP_AT, 2, 16);
  let nodes_hi = ramp(distance, NODES_RAMP_AT, 4, 22);
  let count = RES_PACKS_MIN + prng::draw(&mut state) % (RES_PACKS_MAX - RES_PACKS_MIN + 1);
  let mut packs = vector[];
  let mut index = 0u64;
  while (index < count) {
    let x = (zone_x * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let z = (zone_z * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let item_type = families[prng::draw(&mut state) % families.length()];
    let nodes = nodes_lo + prng::draw(&mut state) % (nodes_hi - nodes_lo + 1);
    let nodes = if (city) nodes * CITY_RESOURCE_NODE_NUMERATOR / CITY_RESOURCE_NODE_DENOMINATOR else nodes;
    packs.push_back(ResourcePack { index, x, z, item_type, nodes: nodes as u8 });
    index = index + 1;
  };
  packs
}

#[test_only]
public fun city_resource_nodes_for_testing(nodes: u64): u64 {
  nodes * CITY_RESOURCE_NODE_NUMERATOR / CITY_RESOURCE_NODE_DENOMINATOR
}

fun taken_of(taken: &vector<u8>, index: u64): u8 {
  if (index < taken.length()) taken[index] else 0
}

public fun resource_packs(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  taken: &vector<u8>,
): vector<ResourcePack> {
  let all = all_resource_packs(rows, map, cities, zone_x, zone_z, seed);
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
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  taken: &vector<u8>,
  index: u64,
): ResourcePack {
  let packs = all_resource_packs(rows, map, cities, zone_x, zone_z, seed);
  assert!(index < packs.length(), ENothingThere);
  let ResourcePack { index: pack_index, x, z, item_type, nodes } = packs[index];
  let consumed = taken_of(taken, index);
  assert!(consumed < nodes, ENothingThere);
  ResourcePack { index: pack_index, x, z, item_type, nodes: nodes - consumed }
}

public fun total_resource_nodes(
  rows: vector<ResourceRow>,
  map: &BiomeMap,
  cities: &vector<City>,
  zone_x: u32,
  zone_z: u32,
  seed: u64,
  index: u64,
): u8 {
  let packs = all_resource_packs(rows, map, cities, zone_x, zone_z, seed);
  assert!(index < packs.length(), ENothingThere);
  packs[index].nodes
}

public fun level_bounds(zone_x: u32, zone_z: u32): (u64, u64) {
  level_bounds_at_distance(distance_blocks(zone_x, zone_z))
}

public fun group_index(group: &MobGroup): u64 { group.index }

public fun group_x(group: &MobGroup): u32 { group.x }

public fun group_z(group: &MobGroup): u32 { group.z }

public fun group_members(group: &MobGroup): vector<MobMember> { group.members }

public fun member_type(member: &MobMember): String { member.mob_type }

public fun member_level_scalar(member: &MobMember): u8 { member.level_scalar }

public fun new_member(mob_type: String, level_scalar: u8): MobMember { MobMember { mob_type, level_scalar } }

#[test_only]
public fun archimob_bp_for_testing(): u64 { ARCHIMOB_BP }

#[test_only]
public fun replacement_for_roll_for_testing(rows: &vector<ArchiRow>, ordinary_type: String, roll: u64): String {
  replacement_for_roll(rows, ordinary_type, roll)
}

public fun pack_index(pack: &ResourcePack): u64 { pack.index }

public fun pack_x(pack: &ResourcePack): u32 { pack.x }

public fun pack_z(pack: &ResourcePack): u32 { pack.z }

public fun pack_item_type(pack: &ResourcePack): String { pack.item_type }

public fun pack_nodes(pack: &ResourcePack): u8 { pack.nodes }
