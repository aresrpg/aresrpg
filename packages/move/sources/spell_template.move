// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Frozen spell content — one object per spell, same seeding, same registry, same seal.
/// CHARACTER spells only (a mob's kit is authored data inside its own template): each carries
/// its class slug. A spell has 1..6 levels; the caster's invested level (progression) picks
/// which one resolves.
module aresrpg::spell_template;

use aresrpg::{character, item::{Self, TemplateRegistry}};
use aresrpg_math::spell_effect::SpellLevel;
use std::string::String;
use sui::{derived_object, event};

const EBadClasse: u64 = 1501; // new: not one of the 12 classes
const EBadLevels: u64 = 1502; // new: a spell carries 1..6 levels

public struct SpellTemplate has key {
  id: UID,
  name: String, // the stable slug — also the derivation key and the art/i18n key
  classe: String, // one of the 12
  unlock_level: u8, // character level at which the spell is learned
  levels: vector<SpellLevel>,
}

/// Types the spell derivation under the shared content registry.
public struct SpellKey(String) has copy, drop, store;

public struct SpellCreated has copy, drop { template: ID, name: String, classe: String }

/// The one mint — validated here, frozen right after (`seed::freeze_spell`).
public(package) fun new(
  registry: &mut TemplateRegistry,
  name: String,
  classe: String,
  unlock_level: u8,
  levels: vector<SpellLevel>,
): SpellTemplate {
  assert!(character::is_classe(&classe), EBadClasse);
  assert!(levels.length() >= 1 && levels.length() <= 6, EBadLevels);
  let template = SpellTemplate {
    id: derived_object::claim(item::registry_uid_mut(registry), SpellKey(name)),
    name,
    classe,
    unlock_level,
    levels,
  };
  event::emit(SpellCreated { template: template.id.to_inner(), name: template.name, classe: template.classe });
  template
}

public(package) fun freeze_template(template: SpellTemplate) {
  transfer::freeze_object(template);
}

// ╔════════════════ [ Reads ] ════════════════════════════════════════════════ ]

public fun name(self: &SpellTemplate): String { self.name }

public fun classe(self: &SpellTemplate): String { self.classe }

public fun unlock_level(self: &SpellTemplate): u8 { self.unlock_level }

public fun max_spell_level(self: &SpellTemplate): u64 { self.levels.length() }

/// The level that resolves for an invested level `n` (1-based).
public fun level_of(self: &SpellTemplate, n: u64): SpellLevel { self.levels[n - 1] }
