// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// A world's authored content as its OWN shared object — the ÷10 plan's Lever 2: the mutable
/// gameplay `World` in core shrinks to id+name, and the 39KB of map data stops riding every
/// search/gather/engage transaction. One object per world, derived by name under the registry
/// root; core doors take it read-only beside the `World` and ASSERT the names match (content
/// from one world must never resolve another's spawns). The six writers follow the door
/// contract (registry.move); the biome map still arrives in ≤16KB pure-argument slices — all
/// in one PTB, reads abort on a half-filled map (world_map owns that law).
module aresrpg_seed::world_content;

use aresrpg_math::world_map::{Self, DungeonRoom, MobRow, ResourceRow};
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, dynamic_field as dfield};

const DOMAIN: vector<u8> = b"world_content";
const EInvalidEntryLevel: u64 = 4401;

/// Claim key under the registry root — one per world name.
public struct WorldContentKey(String) has copy, drop, store;

public struct WorldContent has key {
  id: UID,
  name: String,
  data: world_map::WorldContent,
}

public struct EntryLevelKey() has copy, drop, store;

/// Once per world per seeding: born empty, RETURNED so the same PTB fills it with the
/// setters, then `share` seals the transaction (a shared object cannot be touched again in
/// the transaction that shares it — return-then-share keeps world seeding to ONE tx).
public fun create(cap: &AdminCap, root: &mut Registry, name: String, entry_level: u16, ctx: &TxContext): WorldContent {
  assert!(entry_level >= 1, EInvalidEntryLevel);
  let mut content = WorldContent {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), WorldContentKey(name)),
    name,
    data: world_map::empty_world_content(),
  };
  dfield::add(&mut content.id, EntryLevelKey(), entry_level);
  registry::bump(cap, root, DOMAIN.to_string(), name, ctx);
  content
}

/// The seeding PTB's last act on a fresh world content.
public fun share(wc: WorldContent) {
  transfer::share_object(wc);
}

public fun set_mobs(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, rows: vector<MobRow>, ctx: &TxContext) {
  world_map::set_mobs(&mut wc.data, rows);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun set_entry_level(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, entry_level: u16, ctx: &TxContext) {
  assert!(entry_level >= 1, EInvalidEntryLevel);
  if (dfield::exists(&wc.id, EntryLevelKey())) {
    *dfield::borrow_mut(&mut wc.id, EntryLevelKey()) = entry_level;
  } else {
    dfield::add(&mut wc.id, EntryLevelKey(), entry_level);
  };
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun set_biome_window(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, zone_x0: u32, zone_z0: u32, side: u16, ctx: &TxContext) {
  world_map::set_biome_map_window(&mut wc.data, zone_x0, zone_z0, side);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun append_biome_cells(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, cells: vector<u8>, ctx: &TxContext) {
  world_map::append_biome_map_cells(&mut wc.data, cells);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun clear_biome_map(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, ctx: &TxContext) {
  world_map::clear_biome_map(&mut wc.data);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun set_resources(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, rows: vector<ResourceRow>, ctx: &TxContext) {
  world_map::set_resources(&mut wc.data, rows);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun set_dungeon_key(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, item_type: String, ctx: &TxContext) {
  world_map::set_dungeon_key(&mut wc.data, item_type);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

public fun set_dungeon_rooms(cap: &AdminCap, root: &mut Registry, wc: &mut WorldContent, rooms: vector<DungeonRoom>, ctx: &TxContext) {
  world_map::set_dungeon_rooms(&mut wc.data, rooms);
  registry::bump(cap, root, DOMAIN.to_string(), wc.name, ctx);
}

/// Core's read seam — a dumb accessor, nothing else crosses the boundary.
public fun data(wc: &WorldContent): &world_map::WorldContent { &wc.data }

public fun name(wc: &WorldContent): String { wc.name }

public fun entry_level(wc: &WorldContent): u16 {
  if (dfield::exists(&wc.id, EntryLevelKey())) *dfield::borrow(&wc.id, EntryLevelKey()) else 1
}
