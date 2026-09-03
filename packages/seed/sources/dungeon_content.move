// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// One living content object per dungeon. Worlds reference the stable dungeon slug; ordinary
/// world and zone actions never load the key or ordered rooms.
module aresrpg_seed::dungeon_content;

use aresrpg_control::admin::AdminCap;
use aresrpg_math::dungeon_data::DungeonData;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, event};

const DOMAIN: vector<u8> = b"dungeon_content";
const EWrongDungeon: u64 = 4601;

public struct DungeonContentKey(String) has copy, drop, store;

public struct DungeonContent has key {
  id: UID,
  name: String,
  data: DungeonData,
}

public struct DungeonContentCreated has copy, drop { dungeon: ID, name: String }

public fun add(cap: &AdminCap, root: &mut Registry, name: String, data: DungeonData, ctx: &TxContext) {
  let dungeon = DungeonContent {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), DungeonContentKey(name)),
    name,
    data,
  };
  event::emit(DungeonContentCreated { dungeon: object::id(&dungeon), name });
  registry::bump(cap, root, DOMAIN.to_string(), name, ctx);
  transfer::share_object(dungeon);
}

public fun overwrite(cap: &AdminCap, root: &mut Registry, dungeon: &mut DungeonContent, name: String, data: DungeonData, ctx: &TxContext) {
  assert!(dungeon.name == name, EWrongDungeon);
  dungeon.data = data;
  registry::bump(cap, root, DOMAIN.to_string(), name, ctx);
}

public fun name(dungeon: &DungeonContent): String { dungeon.name }

public fun data(dungeon: &DungeonContent): &DungeonData { &dungeon.data }
