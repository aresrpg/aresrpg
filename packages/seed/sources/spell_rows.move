// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LIVING spell content (the door contract — registry.move): one SHARED template per spell,
/// derived by `SpellKey` under the registry root, rebalanceable through the overwrite door
/// until `freeze_forever`. CHARACTER spells only (a mob's kit is authored data inside its own
/// template). Casts LIVE-READ the template — the sanctioned live-read (owner ruling
/// 2026-08-23): a mid-fight rebalance lands on the next cast, abort-clean, and the kolizeum
/// wager guard keeps money out of that window.
module aresrpg_seed::spell_rows;

use aresrpg_math::{content_rules, spell_effect::SpellLevel};
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, event};

const EBadClasse: u64 = 4401; // add: not one of the 12 classes
const EBadLevels: u64 = 4402; // add/overwrite: every player spell carries exactly six levels

const DOMAIN: vector<u8> = b"spells";

/// Types the spell derivation under the registry root.
public struct SpellKey(String) has copy, drop, store;

public struct SpellTemplate has key {
  id: UID,
  name: String, // the stable slug — also the derivation key and the art/i18n key
  classe: String, // one of the 12
  unlock_level: u8, // character level at which the spell is learned
  levels: vector<SpellLevel>,
}

public struct SpellCreated has copy, drop { template: ID, name: String, classe: String }

/// Author one spell — levels were built by `spell_effect::new_spell_level` (the validated
/// constructor); the classe and level-count laws assert here, exactly as seeding always did.
public fun add_spell(
  cap: &AdminCap,
  root: &mut Registry,
  name: String,
  classe: String,
  unlock_level: u8,
  levels: vector<SpellLevel>,
  ctx: &TxContext,
) {
  assert!(content_rules::is_classe(&classe), EBadClasse);
  assert!(levels.length() == 6, EBadLevels);
  let template = SpellTemplate {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), SpellKey(name)),
    name,
    classe,
    unlock_level,
    levels,
  };
  event::emit(SpellCreated { template: template.id.to_inner(), name: template.name, classe: template.classe });
  registry::bump(cap, root, DOMAIN.to_string(), template.name, ctx);
  transfer::share_object(template);
}

/// Rebalance one spell in place — identity is name, classe, AND unlock level (owner
/// 2026-08-24: a written spell keeps its slot on the class ladder forever); the six level
/// payloads are the only tuning surface.
public fun overwrite_spell(
  cap: &AdminCap,
  root: &mut Registry,
  template: &mut SpellTemplate,
  levels: vector<SpellLevel>,
  ctx: &TxContext,
) {
  assert!(levels.length() == 6, EBadLevels);
  template.levels = levels;
  registry::bump(cap, root, DOMAIN.to_string(), template.name, ctx);
}

// ╔════════════════ [ Reads — core's dumb-accessor seam ] ════════════════════ ]

public fun name(self: &SpellTemplate): String { self.name }

public fun classe(self: &SpellTemplate): String { self.classe }

public fun unlock_level(self: &SpellTemplate): u8 { self.unlock_level }

public fun max_spell_level(self: &SpellTemplate): u64 { self.levels.length() }

/// The level that resolves for an invested level `n` (1-based).
public fun level_of(self: &SpellTemplate, n: u64): SpellLevel { self.levels[n - 1] }
