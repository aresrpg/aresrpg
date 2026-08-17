// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Frozen mob content — same seeding, same registry, same seal as items (a `MobKey` types the
/// derivation, so mob and item slugs never collide). Everything fits the struct: no dynamic
/// fields, one mint call, then the freeze — INCLUDING the spell kit (ruling 2026-08-09): a mob
/// spell is authored data inside its template, never a separate object. The stat block is the
/// ruled minimum: hp/ap/mp, agility (tackle), wisdom (dodge), 4 centered resistances (below
/// center = a WEAKNESS), and the element identity.
module aresrpg::mob_template;

use aresrpg::item::{Self, TemplateRegistry};
use aresrpg_math::mob_data::{Self, MobData};
use std::string::String;
use sui::{derived_object, event};

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct MobTemplate has key {
  id: UID,
  data: MobData,
}

/// One kit spell: the slug (art/client key) and 1..6 authored levels — the mob's rolled
/// level within its band picks which one it casts (owner 2026-08-10: a level-5 wooling's
/// croc bites harder than a level-1's). One authored level = no variance paid.
/// Types the mob derivation under the shared content registry.
public struct MobKey(String) has copy, drop, store;

public struct MobTemplateCreated has copy, drop { template: ID, mob_type: String }

/// The one mint — validated here, frozen right after (`seed::freeze_mob_template`).
public(package) fun new(
  registry: &mut TemplateRegistry,
  data: MobData,
): MobTemplate {
  let mob_type = mob_data::mob_type(&data);
  let template = MobTemplate {
    id: derived_object::claim(item::registry_uid_mut(registry), MobKey(mob_type)),
    data,
  };
  event::emit(MobTemplateCreated { template: template.id.to_inner(), mob_type });
  template
}

public(package) fun freeze_template(template: MobTemplate) {
  transfer::freeze_object(template);
}

public(package) fun data(self: &MobTemplate): &MobData { &self.data }
