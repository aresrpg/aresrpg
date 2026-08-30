// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure level projection for authored mob loot and spell rows. Content stays immutable;
/// fight creation asks this owner for the resolved snapshot at the rolled mob level.
module aresrpg_math::mob_scaling;

use aresrpg_math::{
  fight_math,
  mob_data::{Self, LootEntry},
  spell_effect::{Self, Effect, SpellLevel},
};

const K_CHATIMENT: u8 = 7;
const K_REDUCE: u8 = 14;
const K_REFLECT: u8 = 15;

public fun loot(rows: vector<LootEntry>, low: u64, high: u64, level: u64): vector<LootEntry> {
  let mut scaled = vector[];
  let mut index = 0;
  while (index < rows.length()) {
    let row = &rows[index];
    scaled.push_back(mob_data::new_loot_entry(
      mob_data::loot_item_type(row),
      fight_math::mob_loot_chance_scaled(mob_data::loot_chance_bp(row) as u64, low, high, level) as u16,
      mob_data::loot_min_qty(row),
      mob_data::loot_max_qty(row),
    ));
    index = index + 1;
  };
  scaled
}

fun scalable(kind: u8): bool { kind <= K_CHATIMENT || kind == K_REDUCE || kind == K_REFLECT }

fun value(value: u32, low: u64, high: u64, level: u64): u32 {
  let scaled = fight_math::band_scaled(value as u64, low, high, level);
  if (value > 0 && scaled == 0) 1
  else if (scaled > 0xffff_ffff) 0xffff_ffff
  else scaled as u32
}

public fun effect(authored: &Effect, low: u64, high: u64, level: u64): Effect {
  let kind = authored.kind();
  let scales = scalable(kind);
  spell_effect::new_effect(
    kind,
    authored.element(),
    if (scales) value(authored.value(), low, high, level) else authored.value(),
    if (scales) value(authored.value_max(), low, high, level) else authored.value_max(),
    authored.area_shape(),
    authored.area_size(),
    authored.target_filter(),
    authored.chance_bp(),
    authored.turns(),
    authored.stat(),
  )
}

fun effects(rows: vector<Effect>, low: u64, high: u64, level: u64): vector<Effect> {
  rows.map!(|row| effect(&row, low, high, level))
}

public fun spell_level(authored: &SpellLevel, low: u64, high: u64, level: u64): SpellLevel {
  spell_effect::new_spell_level(
    authored.ap_cost(),
    authored.range_min(),
    authored.range_max(),
    authored.modifiable_range(),
    authored.line_of_sight(),
    authored.line_launch(),
    authored.free_cell(),
    authored.casts_per_turn(),
    authored.casts_per_target(),
    authored.cooldown_turns(),
    authored.crit_1_in(),
    effects(authored.effects(), low, high, level),
    effects(authored.crit_effects(), low, high, level),
  )
}
