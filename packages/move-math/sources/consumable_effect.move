// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The consumable EFFECT — a math value type so the seed package can author it on templates
/// and core can COPY it into every minted item (the owned-item split, owner ruling
/// 2026-08-23: the effect IS the item's value, frozen at mint; a template rebalance never
/// rewrites a bought potion). Validation lives with the type, constructor-only.
module aresrpg_math::consumable_effect;

const EZeroHeal: u64 = 1901; // a heal consumable must change state

public enum Effect has copy, drop, store {
  Heal(u32),
  ResetStats,
  ResetSpells,
  Recall,
  LootBox,
}

public fun heal(amount: u32): Effect {
  assert!(amount > 0, EZeroHeal);
  Effect::Heal(amount)
}

public fun reset_stats(): Effect { Effect::ResetStats }

public fun reset_spells(): Effect { Effect::ResetSpells }

public fun recall(): Effect { Effect::Recall }

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
