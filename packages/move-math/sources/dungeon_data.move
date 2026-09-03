// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Independent authored dungeon content. World cities reference dungeon slugs; keys and ordered
/// rooms live here so ordinary world actions never load an entire dungeon.
module aresrpg_math::dungeon_data;

use aresrpg_math::prng;
use std::string::String;

const EEmptyDungeon: u64 = 3301;
const EEmptyRoom: u64 = 3302;

public struct DungeonData has copy, drop, store {
  key: String,
  rooms: vector<DungeonRoomData>,
}

public struct DungeonRoomData has copy, drop, store { mobs: vector<DungeonMob> }

public struct DungeonMob has copy, drop, store { mob_type: String }

public fun new_dungeon(key: String, rooms: vector<DungeonRoomData>): DungeonData {
  assert!(!key.is_empty() && !rooms.is_empty(), EEmptyDungeon);
  DungeonData { key, rooms }
}

public fun new_room(mobs: vector<DungeonMob>): DungeonRoomData {
  assert!(!mobs.is_empty(), EEmptyRoom);
  DungeonRoomData { mobs }
}

public fun new_room_mob(mob_type: String): DungeonMob { DungeonMob { mob_type } }

public fun key(data: &DungeonData): String { data.key }

public fun room_count(data: &DungeonData): u64 { data.rooms.length() }

public fun room_at(data: &DungeonData, room: u64): vector<DungeonMob> { data.rooms[room - 1].mobs }

public fun mob_type(mob: &DungeonMob): String { mob.mob_type }

public fun level_scalar(room_seed: u64, seat: u64): u8 { (prng::mix(room_seed, seat) % 101) as u8 }
