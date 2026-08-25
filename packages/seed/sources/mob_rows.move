// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LIVING mob content (the door contract — registry.move): one SHARED template per mob type,
/// derived by `MobKey` under the registry root, rebalanceable through the overwrite door until
/// `freeze_forever`. Fights SNAPSHOT a template at engage (copy-at-boundary), so a rebalance
/// never rewrites a running fight. The stat block and kit are authored data inside the
/// template — `mob_data` (math) owns the shape and its validation; the doors just store.
module aresrpg_seed::mob_rows;

use aresrpg_math::mob_data::{Self, MobData};
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, event};

const EWrongMob: u64 = 4301; // overwrite: the payload names a different mob_type

const DOMAIN: vector<u8> = b"mobs";

/// Types the mob derivation under the registry root (mob and item slugs never collide).
public struct MobKey(String) has copy, drop, store;

public struct MobTemplate has key {
  id: UID,
  data: MobData,
}

public struct MobTemplateCreated has copy, drop { template: ID, mob_type: String }

/// Author one mob — `data` was built by `mob_data::new_mob_data` in the same PTB (the one
/// validated constructor). The derived address makes a duplicate mob_type abort.
public fun add_mob(cap: &AdminCap, root: &mut Registry, data: MobData, ctx: &TxContext) {
  let mob_type = mob_data::mob_type(&data);
  let template = MobTemplate {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), MobKey(mob_type)),
    data,
  };
  event::emit(MobTemplateCreated { template: template.id.to_inner(), mob_type });
  registry::bump(cap, root, DOMAIN.to_string(), mob_type, ctx);
  transfer::share_object(template);
}

/// Rebalance one mob in place — identity is immutable (the derived address IS the mob_type;
/// live fights are untouched, they snapshotted at engage).
public fun overwrite_mob(cap: &AdminCap, root: &mut Registry, template: &mut MobTemplate, data: MobData, ctx: &TxContext) {
  assert!(mob_data::mob_type(&data) == mob_data::mob_type(&template.data), EWrongMob);
  template.data = data;
  registry::bump(cap, root, DOMAIN.to_string(), mob_data::mob_type(&template.data), ctx);
}

/// Core's read seam — a dumb accessor, nothing else crosses the boundary.
public fun data(self: &MobTemplate): &MobData { &self.data }
