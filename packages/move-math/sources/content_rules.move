// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Immutable identity rules shared by content authoring and gameplay validation.
module aresrpg_math::content_rules;

use std::string::String;

fun is_weapon(category: &String): bool {
  *category == b"longsword".to_string() ||
    *category == b"daggers".to_string() ||
    *category == b"battleaxe".to_string() ||
    *category == b"spear".to_string() ||
    *category == b"staff".to_string() ||
    *category == b"spellbook".to_string() ||
    *category == b"bow".to_string() ||
    *category == b"axe".to_string() ||
    *category == b"mace".to_string() ||
    *category == b"club".to_string() ||
    *category == b"sword".to_string()
}

fun is_tool(category: &String): bool {
  *category == b"tool_farmer".to_string() ||
    *category == b"tool_herbalist".to_string() ||
    *category == b"tool_miner".to_string()
}

public fun is_stackable(category: &String): bool {
  *category == b"consumable".to_string() ||
    *category == b"resource".to_string() ||
    *category == b"rune".to_string()
}

/// A pet diet is an authored list of resource item types, never a global food category.
public fun pet_accepts(food_types: &vector<String>, food_type: &String): bool {
  food_types.contains(food_type)
}

public fun is_category(category: &String): bool {
  *category == b"helmet".to_string() ||
    *category == b"chestplate".to_string() ||
    *category == b"belt".to_string() ||
    *category == b"gauntlets".to_string() ||
    *category == b"pants".to_string() ||
    *category == b"boots".to_string() ||
    *category == b"amulet".to_string() ||
    *category == b"ring".to_string() ||
    *category == b"pet".to_string() ||
    *category == b"relic".to_string() ||
    *category == b"title".to_string() ||
    *category == b"hat".to_string() ||
    *category == b"cloak".to_string() ||
    is_weapon(category) ||
    is_tool(category) ||
    is_stackable(category) ||
    *category == b"key".to_string()
}

public fun craft_job_of(category: &String): Option<String> {
  if (*category == b"longsword".to_string() || *category == b"sword".to_string() || *category == b"daggers".to_string()) option::some(b"SWORD_SMITH".to_string())
  else if (*category == b"axe".to_string() || *category == b"battleaxe".to_string()) option::some(b"AXE_SMITH".to_string())
  else if (*category == b"club".to_string() || *category == b"mace".to_string()) option::some(b"BLUNT_SMITH".to_string())
  else if (*category == b"staff".to_string() || *category == b"spellbook".to_string()) option::some(b"STAFF_CARVER".to_string())
  else if (*category == b"bow".to_string() || *category == b"spear".to_string()) option::some(b"BOWYER".to_string())
  else if (*category == b"helmet".to_string() || *category == b"chestplate".to_string()) option::some(b"ARMORSMITH".to_string())
  else if (*category == b"pants".to_string() || *category == b"boots".to_string()) option::some(b"TAILOR".to_string())
  else if (*category == b"belt".to_string() || *category == b"gauntlets".to_string()) option::some(b"TANNER".to_string())
  else if (*category == b"ring".to_string() || *category == b"amulet".to_string()) option::some(b"JEWELER".to_string())
  else if (*category == b"key".to_string()) option::some(b"HANDYMAN".to_string())
  else option::none()
}

public fun is_relic_slot(slot: &String): bool {
  *slot == b"relic_1".to_string() || *slot == b"relic_2".to_string() ||
    *slot == b"relic_3".to_string() || *slot == b"relic_4".to_string() ||
    *slot == b"relic_5".to_string() || *slot == b"relic_6".to_string()
}

public fun relic_slot(index: u8): String {
  if (index == 1) return b"relic_1".to_string();
  if (index == 2) return b"relic_2".to_string();
  if (index == 3) return b"relic_3".to_string();
  if (index == 4) return b"relic_4".to_string();
  if (index == 5) return b"relic_5".to_string();
  b"relic_6".to_string()
}

public fun category_fits(slot: &String, category: &String): bool {
  if (*slot == b"weapon".to_string()) return is_weapon(category);
  if (*slot == b"tool".to_string()) return is_tool(category);
  if (*slot == b"left_ring".to_string() || *slot == b"right_ring".to_string()) {
    return *category == b"ring".to_string()
  };
  if (is_relic_slot(slot)) return *category == b"relic".to_string();
  *slot == *category
}

public fun is_slot(slot: &String): bool {
  *slot == b"weapon".to_string() ||
    *slot == b"tool".to_string() ||
    *slot == b"helmet".to_string() ||
    *slot == b"chestplate".to_string() ||
    *slot == b"belt".to_string() ||
    *slot == b"gauntlets".to_string() ||
    *slot == b"pants".to_string() ||
    *slot == b"boots".to_string() ||
    *slot == b"amulet".to_string() ||
    *slot == b"left_ring".to_string() ||
    *slot == b"right_ring".to_string() ||
    *slot == b"pet".to_string() ||
    is_relic_slot(slot) ||
    *slot == b"title".to_string() ||
    *slot == b"hat".to_string() ||
    *slot == b"cloak".to_string()
}

public fun is_classe(classe: &String): bool {
  *classe == b"shugo".to_string() ||
    *classe == b"tomoda".to_string() ||
    *classe == b"rojin".to_string() ||
    *classe == b"yajin".to_string() ||
    *classe == b"tokei".to_string() ||
    *classe == b"asobi".to_string() ||
    *classe == b"iyashi".to_string() ||
    *classe == b"senshi".to_string() ||
    *classe == b"yogan".to_string() ||
    *classe == b"mori".to_string() ||
    *classe == b"ikari".to_string() ||
    *classe == b"shusen".to_string()
}

/// The character-name byte law, TOTAL: every byte printable ASCII [0x21, 0x7e] — no
/// whitespace, no control bytes, no DEL, and no multi-byte UTF-8 (a non-ASCII name would be
/// chain-legal yet unreproducible by the SDK's normalize, which enforces this exact range —
/// packages/sdk/src/character.ts `normalize_character_name`, the one client twin).
public fun is_printable_ascii(name: &String): bool {
  let bytes = name.as_bytes();
  let mut index = 0;
  while (index < bytes.length()) {
    let byte = bytes[index];
    if (byte < 33u8 || byte > 126u8) return false;
    index = index + 1;
  };
  true
}
