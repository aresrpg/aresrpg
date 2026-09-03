// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The consumable effect value authored live on one ItemTemplate. Stackable items keep only
/// their template identity, so split and merge cannot create conflicting behavior; core reads
/// this current value when one unit burns. Validation lives with the constructor-only type.
module aresrpg_math::consumable_effect;

use std::string::String;

const EZeroHeal: u64 = 1901; // a heal consumable must change state
const EEmptyCity: u64 = 1902;

public enum Effect has copy, drop, store {
  Heal(u32),
  ResetStats,
  ResetSpells,
  Recall,
  City(String),
  LootBox,
}

public fun heal(amount: u32): Effect {
  assert!(amount > 0, EZeroHeal);
  Effect::Heal(amount)
}

public fun reset_stats(): Effect { Effect::ResetStats }

public fun reset_spells(): Effect { Effect::ResetSpells }

public fun recall(): Effect { Effect::Recall }

public fun city(city: String): Effect {
  assert!(!city.is_empty(), EEmptyCity);
  Effect::City(city)
}

public fun loot_box(): Effect { Effect::LootBox }

public fun is_loot_box(effect: &Effect): bool {
  match (effect) {
    Effect::LootBox => true,
    _ => false,
  }
}

/// The one resolver seam — core matches on this to apply the effect.
public fun heal_amount(effect: &Effect): Option<u32> {
  match (effect) {
    Effect::Heal(amount) => option::some(*amount),
    _ => option::none(),
  }
}

public fun is_reset_stats(effect: &Effect): bool {
  match (effect) { Effect::ResetStats => true, _ => false }
}

public fun is_reset_spells(effect: &Effect): bool {
  match (effect) { Effect::ResetSpells => true, _ => false }
}

public fun is_recall(effect: &Effect): bool {
  match (effect) { Effect::Recall => true, _ => false }
}

public fun city_name(effect: &Effect): Option<String> {
  match (effect) { Effect::City(city) => option::some(*city), _ => option::none() }
}
