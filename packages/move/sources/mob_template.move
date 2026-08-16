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
use aresrpg_math::{item_damages, spell_effect::SpellLevel};
use std::string::String;
use sui::{derived_object, event};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EInvalidLevelBand: u64 = 1201; // new: level_min > level_max
const ETooManySpells: u64 = 1202; // new: a kit carries at most 5 spells
const ETooMuchLoot: u64 = 1203; // new: a loot table carries at most 16 rows
const EInvalidElement: u64 = 1204; // new: element outside the 4
const EInvalidChance: u64 = 1205; // new_loot_entry: chance above 100% (10000 bp)
const EInvalidQty: u64 = 1206; // new_loot_entry: min_qty > max_qty or zero max

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

public struct MobTemplate has key {
  id: UID,
  name: String,
  mob_type: String, // the derivation key and exact seed model filename
  element: String,
  level_min: u8,
  level_max: u8,
  hp: u64,
  ap: u8,
  mp: u8,
  agility: u16,
  wisdom: u16,
  // centered at 32768 — below center is a WEAKNESS
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
  spells: vector<MobSpell>, // ≤5 — the whole kit, authored and frozen with the template
  loot: vector<LootEntry>, // ≤16 rows
  xp: u64,
}

/// One kit spell: the slug (art/client key) and 1..6 authored levels — the mob's rolled
/// level within its band picks which one it casts (owner 2026-08-10: a level-5 wooling's
/// croc bites harder than a level-1's). One authored level = no variance paid.
public struct MobSpell has copy, drop, store {
  name: String,
  levels: vector<SpellLevel>,
}

/// One loot row. Items are referenced by `item_type` slug — the claim door will take the
/// actual frozen template and assert the slug matches (derived addresses make it computable).
public struct LootEntry has copy, drop, store {
  item_type: String,
  chance_bp: u16,
  min_qty: u8,
  max_qty: u8,
}

/// Types the mob derivation under the shared content registry.
public struct MobKey(String) has copy, drop, store;

public struct MobTemplateCreated has copy, drop { template: ID, mob_type: String }

// ╔════════════════ [ Seeding constructors ] ═════════════════════════════════ ]

public fun new_loot_entry(item_type: String, chance_bp: u16, min_qty: u8, max_qty: u8): LootEntry {
  assert!(chance_bp <= 10000, EInvalidChance);
  assert!(min_qty <= max_qty && max_qty > 0, EInvalidQty);
  LootEntry { item_type, chance_bp, min_qty, max_qty }
}

/// Levels compose through `spell_effect`'s validated constructors in the seeding PTB.
public fun new_mob_spell(name: String, levels: vector<SpellLevel>): MobSpell {
  assert!(levels.length() >= 1 && levels.length() <= 6, ETooManySpells);
  MobSpell { name, levels }
}

/// The one mint — validated here, frozen right after (`seed::freeze_mob_template`).
public(package) fun new(
  registry: &mut TemplateRegistry,
  name: String,
  mob_type: String,
  element: String,
  level_min: u8,
  level_max: u8,
  hp: u64,
  ap: u8,
  mp: u8,
  agility: u16,
  wisdom: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
  spells: vector<MobSpell>,
  loot: vector<LootEntry>,
  xp: u64,
): MobTemplate {
  assert!(level_min <= level_max, EInvalidLevelBand);
  assert!(spells.length() <= 5, ETooManySpells);
  assert!(loot.length() <= 16, ETooMuchLoot);
  assert!(item_damages::is_element(&element), EInvalidElement);
  let template = MobTemplate {
    id: derived_object::claim(item::registry_uid_mut(registry), MobKey(mob_type)),
    name,
    mob_type,
    element,
    level_min,
    level_max,
    hp,
    ap,
    mp,
    agility,
    wisdom,
    earth_resistance,
    fire_resistance,
    water_resistance,
    air_resistance,
    spells,
    loot,
    xp,
  };
  event::emit(MobTemplateCreated { template: template.id.to_inner(), mob_type: template.mob_type });
  template
}

public(package) fun freeze_template(template: MobTemplate) {
  transfer::freeze_object(template);
}

// ╔════════════════ [ Reads (the fight and loot claim read these) ] ══════════ ]

public fun name(self: &MobTemplate): String { self.name }

public fun mob_type(self: &MobTemplate): String { self.mob_type }

public fun element(self: &MobTemplate): String { self.element }

public fun level_min(self: &MobTemplate): u8 { self.level_min }

public fun level_max(self: &MobTemplate): u8 { self.level_max }

public fun hp(self: &MobTemplate): u64 { self.hp }

public fun ap(self: &MobTemplate): u8 { self.ap }

public fun mp(self: &MobTemplate): u8 { self.mp }

public fun agility(self: &MobTemplate): u16 { self.agility }

public fun wisdom(self: &MobTemplate): u16 { self.wisdom }

public fun earth_resistance(self: &MobTemplate): u16 { self.earth_resistance }

public fun fire_resistance(self: &MobTemplate): u16 { self.fire_resistance }

public fun water_resistance(self: &MobTemplate): u16 { self.water_resistance }

public fun air_resistance(self: &MobTemplate): u16 { self.air_resistance }

public fun spells(self: &MobTemplate): vector<MobSpell> { self.spells }

public fun spell_name(spell: &MobSpell): String { spell.name }

public fun spell_levels(spell: &MobSpell): vector<SpellLevel> { spell.levels }

public fun loot(self: &MobTemplate): vector<LootEntry> { self.loot }

public fun xp(self: &MobTemplate): u64 { self.xp }

public fun loot_item_type(entry: &LootEntry): String { entry.item_type }

public fun loot_chance_bp(entry: &LootEntry): u16 { entry.chance_bp }

public fun loot_min_qty(entry: &LootEntry): u8 { entry.min_qty }

public fun loot_max_qty(entry: &LootEntry): u8 { entry.max_qty }
