// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Immutable world content values and deterministic world rules. This module owns no object,
/// authority, clock, entropy, event, or dynamic field; the game package owns every state write.
module aresrpg_math::world_map;

use aresrpg_math::city_map::{Self, City};
use std::string::String;

const EInvalidRate: u64 = 306;
const EInvalidJob: u64 = 308;
const EInvalidBiomeMap: u64 = 311;
const ENoSuchResource: u64 = 309;

const WORLD_SIZE: u32 = 100_000;
const WORLD_CENTER: u32 = 50_000;
const SPEED_BUDGET: u64 = 1150;
const SPEED_SCALE: u64 = 100_000;
const PET_NUM: u64 = 3;
const PET_DEN: u64 = 2;
const MAX_LINEAR: u64 = 1_000_000;

public struct BiomeMap has copy, drop, store {
  zone_x0: u32,
  zone_z0: u32,
  side: u16,
  cells: vector<u8>,
}

public struct MobRow has copy, drop, store {
  mob_type: String,
  weight_bp: u16,
  biomes: vector<u8>,
  cities: vector<u8>,
}

public struct ArchiRow has copy, drop, store { ordinary_type: String, archi_type: String }

public fun new_archi_row(ordinary_type: String, archi_type: String): ArchiRow {
  ArchiRow { ordinary_type, archi_type }
}

public fun archi_row_ordinary(row: &ArchiRow): String { row.ordinary_type }

public fun archi_row_replacement(row: &ArchiRow): String { row.archi_type }

public struct ResourceRow has copy, drop, store {
  item_type: String,
  job: String,
  tier: u8,
  protector: String,
  rare_item_type: String,
  biomes: vector<u8>,
  cities: vector<u8>,
}

/// The authored payload of a World. The game object owns custody; this value module owns its
/// shape and static reads/writes. Possessing `&mut WorldContent` still requires a game-package
/// authority door, so these public functions grant no authority by themselves.
public struct WorldContent has copy, drop, store {
  mobs: vector<MobRow>,
  resources: vector<ResourceRow>,
  cities: vector<City>,
  biome_map: BiomeMap,
}

public fun world_size(): u32 { WORLD_SIZE }

public fun world_center(): u32 { WORLD_CENTER }

public fun empty_biome_map(): BiomeMap {
  BiomeMap { zone_x0: 0, zone_z0: 0, side: 0, cells: vector[] }
}

public fun empty_world_content(): WorldContent {
  WorldContent {
    mobs: vector[],
    resources: vector[],
    cities: vector[],
    biome_map: empty_biome_map(),
  }
}

public fun set_biome_map_window(content: &mut WorldContent, zone_x0: u32, zone_z0: u32, side: u16) {
  content.biome_map = biome_map_window(zone_x0, zone_z0, side);
}

public fun append_biome_map_cells(content: &mut WorldContent, cells: vector<u8>) {
  content.biome_map = append_biome_cells(&content.biome_map, cells);
}

public fun clear_biome_map(content: &mut WorldContent) { content.biome_map = empty_biome_map(); }

public fun set_mobs(content: &mut WorldContent, rows: vector<MobRow>) { content.mobs = rows; }

public fun set_resources(content: &mut WorldContent, rows: vector<ResourceRow>) { content.resources = rows; }

public fun set_cities(content: &mut WorldContent, cities: vector<City>) {
  city_map::assert_valid(&cities);
  content.cities = cities;
}

public fun mobs(content: &WorldContent): vector<MobRow> { content.mobs }

public fun resources(content: &WorldContent): vector<ResourceRow> { content.resources }

public fun cities(content: &WorldContent): vector<City> { content.cities }

public fun biome_map(content: &WorldContent): &BiomeMap { &content.biome_map }

public fun resource_row_of(content: &WorldContent, item_type: String): ResourceRow {
  let mut i = 0;
  while (i < content.resources.length()) {
    if (resource_row_type(&content.resources[i]) == item_type) return content.resources[i];
    i = i + 1;
  };
  abort ENoSuchResource
}

public fun biome_map_window(zone_x0: u32, zone_z0: u32, side: u16): BiomeMap {
  BiomeMap { zone_x0, zone_z0, side, cells: vector[] }
}

public fun append_biome_cells(map: &BiomeMap, cells: vector<u8>): BiomeMap {
  let mut combined = map.cells;
  combined.append(cells);
  let side = map.side as u64;
  assert!(combined.length() <= side * side, EInvalidBiomeMap);
  BiomeMap { zone_x0: map.zone_x0, zone_z0: map.zone_z0, side: map.side, cells: combined }
}

public fun new_mob_row(mob_type: String, weight_bp: u16, biomes: vector<u8>, cities: vector<u8>): MobRow {
  assert!(weight_bp > 0 && weight_bp <= 10_000, EInvalidRate);
  assert!(!biomes.is_empty() || !cities.is_empty(), EInvalidRate);
  MobRow { mob_type, weight_bp, biomes, cities }
}

public fun new_resource_row(
  item_type: String,
  job: String,
  tier: u8,
  protector: String,
  rare_item_type: String,
  biomes: vector<u8>,
  cities: vector<u8>,
): ResourceRow {
  assert!(
    job == b"FARMER".to_string() || job == b"HERBALIST".to_string() || job == b"MINER".to_string(),
    EInvalidJob,
  );
  // Empty means the resource remains in the content catalog without spawning in this world.
  ResourceRow { item_type, job, tier, protector, rare_item_type, biomes, cities }
}

public fun mob_row_type(row: &MobRow): String { row.mob_type }

public fun mob_row_weight_bp(row: &MobRow): u16 { row.weight_bp }

public fun mob_row_biomes(row: &MobRow): vector<u8> { row.biomes }

public fun mob_row_cities(row: &MobRow): vector<u8> { row.cities }

public fun resource_row_type(row: &ResourceRow): String { row.item_type }

public fun resource_row_job(row: &ResourceRow): String { row.job }

public fun resource_row_tier(row: &ResourceRow): u8 { row.tier }

public fun resource_row_protector(row: &ResourceRow): String { row.protector }

public fun resource_row_rare(row: &ResourceRow): String { row.rare_item_type }

public fun resource_row_biomes(row: &ResourceRow): vector<u8> { row.biomes }

public fun resource_row_cities(row: &ResourceRow): vector<u8> { row.cities }

public fun biome_of_zone(map: &BiomeMap, zone_x: u32, zone_z: u32): u8 {
  if (map.side == 0) return 0;
  let side = map.side as u64;
  assert!(map.cells.length() == side * side, EInvalidBiomeMap);
  let last = (map.side as u32) - 1;
  let cx = clamp_to_window(zone_x, map.zone_x0, last);
  let cz = clamp_to_window(zone_z, map.zone_z0, last);
  map.cells[(cz as u64) * side + (cx as u64)]
}

fun clamp_to_window(zone: u32, origin: u32, last: u32): u32 {
  if (zone <= origin) 0 else if (zone - origin >= last) last else zone - origin
}

public fun travel_ok(
  from_x: u32,
  from_z: u32,
  from_ms: u64,
  pet_at_start: bool,
  to_x: u32,
  to_z: u32,
  now_ms: u64,
  pet_now: bool,
): bool {
  if (now_ms < from_ms) return false;
  let speed = if (pet_at_start && pet_now) SPEED_BUDGET * PET_NUM / PET_DEN else SPEED_BUDGET;
  let budget = (now_ms - from_ms) * speed / SPEED_SCALE;
  if (budget >= MAX_LINEAR) return true;
  let dx = abs_diff(to_x, from_x);
  let dz = abs_diff(to_z, from_z);
  budget * budget >= dx * dx + dz * dz
}

fun abs_diff(a: u32, b: u32): u64 {
  if (a > b) ((a - b) as u64) else ((b - a) as u64)
}
