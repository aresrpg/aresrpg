// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// LIVING item content (the door contract — registry.move): one SHARED template per
/// item_type, derived by `ItemKey` under the registry root, rebalanceable through the
/// overwrite/attach doors until `freeze_forever`. Stat ranges, damage lines, and the
/// consumable effect attach as dynamic fields exactly as the seal era authored them — the
/// module-split attachment pattern survives, only the owner package and the doors change.
/// Minted items COPY what they need at mint (stats roll into the item, the consumable
/// effect imprints) — a rebalance tunes FUTURE mints, never a bought item.
module aresrpg_seed::item_rows;

use aresrpg_math::{
  consumable_effect::Effect,
  content_rules,
  item_damages::ItemDamages,
  item_stats::ItemStatistics,
};
use aresrpg_control::admin::AdminCap;
use aresrpg_seed::registry::{Self, Registry};
use std::string::String;
use sui::{derived_object, dynamic_field as dfield, event};

const EWrongCategory: u64 = 4501; // add: a category outside the sealed set
const EStackableStats: u64 = 4502; // stats/damages: a stackable carries neither
const EInvalidStatRange: u64 = 4503; // a min above its max would poison every mint
const ENotConsumable: u64 = 4504; // effect: only a consumable carries one

const DOMAIN: vector<u8> = b"items";

/// Types the item derivation under the registry root.
public struct ItemKey(String) has copy, drop, store;

public struct ItemTemplate has key {
  id: UID,
  name: String,
  item_type: String,
  category: String,
  level: u8,
  pet_foods: vector<String>,
}

/// Attachment keys — the same three facts the seal era attached, plus the consumable effect.
public struct StatsMinKey() has copy, drop, store;
public struct StatsMaxKey() has copy, drop, store;
public struct DamagesKey() has copy, drop, store;
public struct EffectKey() has copy, drop, store;

public struct TemplateCreated has copy, drop { template: ID, item_type: String }

/// Author one item — RETURNED so the same PTB attaches stats/damages/effect, then
/// `share_item` seals the transaction (a shared object cannot be touched again in the
/// transaction that shares it). The category law asserts here; the derived address makes a
/// duplicate item_type abort.
public fun add_item(
  cap: &AdminCap,
  root: &mut Registry,
  name: String,
  item_type: String,
  category: String,
  level: u8,
  pet_foods: vector<String>,
  ctx: &TxContext,
): ItemTemplate {
  assert!(content_rules::is_category(&category), EWrongCategory);
  let template = ItemTemplate {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), ItemKey(item_type)),
    name,
    item_type,
    category,
    level,
    pet_foods,
  };
  event::emit(TemplateCreated { template: template.id.to_inner(), item_type: template.item_type });
  registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
  template
}

/// The authoring PTB's last act on a fresh template.
public fun share_item(template: ItemTemplate) {
  transfer::share_object(template);
}

/// Rebalance the flat half in place — identity (item_type, category) is immutable: the
/// category decides mint/stack/policy law and the derived address IS the item_type.
public fun overwrite_item(
  cap: &AdminCap,
  root: &mut Registry,
  template: &mut ItemTemplate,
  name: String,
  level: u8,
  pet_foods: vector<String>,
  ctx: &TxContext,
) {
  template.name = name;
  template.level = level;
  template.pet_foods = pet_foods;
  registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
}

/// Author or rebalance the stat RANGES (gear only; every min ≤ its max asserts before
/// anything can poison a mint). Overwrite-legal: the living era replaces, never freezes.
public fun set_stats(
  cap: &AdminCap,
  root: &mut Registry,
  template: &mut ItemTemplate,
  min: ItemStatistics,
  max: ItemStatistics,
  ctx: &TxContext,
) {
  assert!(!content_rules::is_stackable(&template.category), EStackableStats);
  let (lo, hi) = (min.to_vector(), max.to_vector());
  let mut i = 0;
  while (i < lo.length()) {
    assert!(lo[i] <= hi[i], EInvalidStatRange);
    i = i + 1;
  };
  if (dfield::exists(&template.id, StatsMinKey())) {
    *dfield::borrow_mut(&mut template.id, StatsMinKey()) = min;
    *dfield::borrow_mut(&mut template.id, StatsMaxKey()) = max;
  } else {
    dfield::add(&mut template.id, StatsMinKey(), min);
    dfield::add(&mut template.id, StatsMaxKey(), max);
  };
  registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
}

public fun clear_stats(cap: &AdminCap, root: &mut Registry, template: &mut ItemTemplate, ctx: &TxContext) {
  if (dfield::exists(&template.id, StatsMinKey())) {
    let _: ItemStatistics = dfield::remove(&mut template.id, StatsMinKey());
    let _: ItemStatistics = dfield::remove(&mut template.id, StatsMaxKey());
    registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
  };
}

/// Author or rebalance the damage lines (weapons). Same stackable law, same replace rule.
public fun set_damages(
  cap: &AdminCap,
  root: &mut Registry,
  template: &mut ItemTemplate,
  lines: vector<ItemDamages>,
  ctx: &TxContext,
) {
  assert!(!content_rules::is_stackable(&template.category), EStackableStats);
  if (dfield::exists(&template.id, DamagesKey())) {
    *dfield::borrow_mut(&mut template.id, DamagesKey()) = lines;
  } else {
    dfield::add(&mut template.id, DamagesKey(), lines);
  };
  registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
}

public fun clear_damages(cap: &AdminCap, root: &mut Registry, template: &mut ItemTemplate, ctx: &TxContext) {
  if (dfield::exists(&template.id, DamagesKey())) {
    let _: vector<ItemDamages> = dfield::remove(&mut template.id, DamagesKey());
    registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
  };
}

/// Author or rebalance the current live consumable effect.
public fun set_effect(
  cap: &AdminCap,
  root: &mut Registry,
  template: &mut ItemTemplate,
  effect: Effect,
  ctx: &TxContext,
) {
  assert!(template.category == b"consumable".to_string(), ENotConsumable);
  if (dfield::exists(&template.id, EffectKey())) {
    *dfield::borrow_mut(&mut template.id, EffectKey()) = effect;
  } else {
    dfield::add(&mut template.id, EffectKey(), effect);
  };
  registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
}

public fun clear_effect(cap: &AdminCap, root: &mut Registry, template: &mut ItemTemplate, ctx: &TxContext) {
  if (dfield::exists(&template.id, EffectKey())) {
    let _: Effect = dfield::remove(&mut template.id, EffectKey());
    registry::bump(cap, root, DOMAIN.to_string(), template.item_type, ctx);
  };
}

// ╔════════════════ [ Reads — core's dumb-accessor seam ] ════════════════════ ]

public fun template_id(template: &ItemTemplate): ID { template.id.to_inner() }

public fun template_name(template: &ItemTemplate): String { template.name }

public fun template_type(template: &ItemTemplate): String { template.item_type }

public fun template_category(template: &ItemTemplate): String { template.category }

public fun template_level(template: &ItemTemplate): u8 { template.level }

public fun pet_foods(template: &ItemTemplate): vector<String> { template.pet_foods }

public fun has_stats(template: &ItemTemplate): bool {
  dfield::exists(&template.id, StatsMinKey())
}

public fun stats_min(template: &ItemTemplate): ItemStatistics {
  *dfield::borrow(&template.id, StatsMinKey())
}

public fun stats_max(template: &ItemTemplate): ItemStatistics {
  *dfield::borrow(&template.id, StatsMaxKey())
}

public fun damage_lines(template: &ItemTemplate): vector<ItemDamages> {
  if (dfield::exists(&template.id, DamagesKey())) *dfield::borrow(&template.id, DamagesKey())
  else vector[]
}

public fun consumable_effect(template: &ItemTemplate): Option<Effect> {
  if (dfield::exists(&template.id, EffectKey())) option::some(*dfield::borrow(&template.id, EffectKey()))
  else option::none()
}

#[test_only]
public fun template_for_testing(item_type: String, category: String, ctx: &mut TxContext): ItemTemplate {
  ItemTemplate {
    id: object::new(ctx),
    name: item_type,
    item_type,
    category,
    level: 1,
    pet_foods: vector[],
  }
}

#[test_only]
public fun destroy_for_testing(template: ItemTemplate) {
  let ItemTemplate { id, .. } = template;
  id.delete();
}
