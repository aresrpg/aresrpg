// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Immutable mob spell and loot rows embedded in frozen game templates.
module aresrpg_math::mob_data;

use aresrpg_math::{item_damages, spell_effect::{Self, SpellLevel}};
use std::string::String;

const ETooManySpells: u64 = 1202;
const EInvalidChance: u64 = 1205;
const EInvalidQty: u64 = 1206;
const EInvalidLevelBand: u64 = 1201;
const ETooMuchLoot: u64 = 1203;
const EInvalidElement: u64 = 1204;
const ETooMuchTurnWork: u64 = 1207;
const MAX_MOB_ROW_CASTS: u64 = 10;

public struct MobSpell has copy, drop, store {
  name: String,
  level: SpellLevel,
}

public struct LootEntry has copy, drop, store {
  item_type: String,
  chance_bp: u16,
  min_qty: u8,
  max_qty: u8,
}

/// The complete immutable payload embedded by a frozen MobTemplate. The game package owns the
/// object identity and freeze door; this module owns authored data and validation only.
public struct MobData has copy, drop, store {
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
}

public fun new_mob_data(
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
): MobData {
  assert!(level_min <= level_max, EInvalidLevelBand);
  assert!(spells.length() <= 5, ETooManySpells);
  assert_turn_work(ap, &spells);
  assert!(loot.length() <= 16, ETooMuchLoot);
  assert!(item_damages::is_element(&element), EInvalidElement);
  MobData {
    name, mob_type, element, level_min, level_max, hp, ap, mp, agility, wisdom,
    earth_resistance, fire_resistance, water_resistance, air_resistance, spells, loot, xp,
  }
}

/// Conservative authored ceiling: combine the cheapest cast with the largest effect branch.
/// Geometry separately caps every row at twelve fighter checks, so their product bounds a mob
/// turn without storing or charging a runtime work meter.
fun assert_turn_work(ap: u8, spells: &vector<MobSpell>) {
  if (spells.is_empty()) return;
  let mut cheapest = 256;
  let mut largest_branch = 0;
  let mut index = 0;
  while (index < spells.length()) {
    let level = &spells[index].level;
    let cost = spell_effect::ap_cost(level) as u64;
    assert!(cost > 0, ETooMuchTurnWork);
    if (cost < cheapest) cheapest = cost;
    let normal = spell_effect::effects(level).length();
    let critical = spell_effect::crit_effects(level).length();
    let rows = if (normal > critical) normal else critical;
    if (rows > largest_branch) largest_branch = rows;
    index = index + 1;
  };
  assert!((ap as u64) / cheapest * largest_branch <= MAX_MOB_ROW_CASTS, ETooMuchTurnWork);
}

public fun name(data: &MobData): String { data.name }

public fun mob_type(data: &MobData): String { data.mob_type }

public fun element(data: &MobData): String { data.element }

public fun level_min(data: &MobData): u8 { data.level_min }

public fun level_max(data: &MobData): u8 { data.level_max }

public fun hp(data: &MobData): u64 { data.hp }

public fun ap(data: &MobData): u8 { data.ap }

public fun mp(data: &MobData): u8 { data.mp }

public fun agility(data: &MobData): u16 { data.agility }

public fun wisdom(data: &MobData): u16 { data.wisdom }

public fun earth_resistance(data: &MobData): u16 { data.earth_resistance }

public fun fire_resistance(data: &MobData): u16 { data.fire_resistance }

public fun water_resistance(data: &MobData): u16 { data.water_resistance }

public fun air_resistance(data: &MobData): u16 { data.air_resistance }

public fun spells(data: &MobData): vector<MobSpell> { data.spells }

public fun loot(data: &MobData): vector<LootEntry> { data.loot }

public fun xp(data: &MobData): u64 { data.xp }

public fun new_loot_entry(item_type: String, chance_bp: u16, min_qty: u8, max_qty: u8): LootEntry {
  assert!(chance_bp <= 10_000, EInvalidChance);
  assert!(min_qty > 0 && min_qty <= max_qty, EInvalidQty);
  LootEntry { item_type, chance_bp, min_qty, max_qty }
}

public fun new_mob_spell(name: String, level: SpellLevel): MobSpell { MobSpell { name, level } }

public fun spell_name(spell: &MobSpell): String { spell.name }

public fun spell_level(spell: &MobSpell): SpellLevel { spell.level }

public fun loot_item_type(entry: &LootEntry): String { entry.item_type }

public fun loot_chance_bp(entry: &LootEntry): u16 { entry.chance_bp }

public fun loot_min_qty(entry: &LootEntry): u8 { entry.min_qty }

public fun loot_max_qty(entry: &LootEntry): u8 { entry.max_qty }
