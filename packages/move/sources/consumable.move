// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUMABLES — one typed effect frozen on every consumable template. Character effects burn
/// one kiosk-locked unit and resolve immediately. Loot boxes share the same authored type but
/// open through `loot_box`, which preserves its terminal-randomness claim flow.
///
/// A consumable can't be used mid-fight BY CONSTRUCTION: fight custody means the character is
/// not in the kiosk, so there is nothing for `borrow_mut` to reach.
module aresrpg::consumable;

use aresrpg::{
  character::{Self, Character},
  item::{Self, Item, ItemTemplate},
  progression,
  protected_policy::AresRPG_TransferPolicy,
  world,
};
use sui::{clock::Clock, dynamic_field as dfield, kiosk::{Kiosk, KioskOwnerCap}};

const ENotConsumable: u64 = 2601; // the burned stack is not a consumable
const ETemplateMismatch: u64 = 2602; // the passed template is not the item's template
const ERooted: u64 = 2603; // a gather-time root or a fired ambush verdict is holding you
const ELootBox: u64 = 2604; // loot boxes open through `loot_box`, never the plain consume door
const EZeroHeal: u64 = 2605; // a heal consumable must change state

public struct EffectKey() has copy, drop, store;

public enum Effect has copy, drop, store {
  Heal(u32),
  ResetStats,
  ResetSpells,
  Recall,
  LootBox,
}

fun set_effect(template: &mut ItemTemplate, effect: Effect) {
  assert!(item::template_category(template) == b"consumable".to_string(), ENotConsumable);
  dfield::add(item::template_uid_mut(template), EffectKey(), effect);
}

public(package) fun set_heal(template: &mut ItemTemplate, amount: u32) {
  assert!(amount > 0, EZeroHeal);
  set_effect(template, Effect::Heal(amount));
}

public(package) fun set_reset_stats(template: &mut ItemTemplate) {
  set_effect(template, Effect::ResetStats);
}

public(package) fun set_reset_spells(template: &mut ItemTemplate) {
  set_effect(template, Effect::ResetSpells);
}

public(package) fun set_recall(template: &mut ItemTemplate) {
  set_effect(template, Effect::Recall);
}

public(package) fun set_loot_box(template: &mut ItemTemplate) {
  set_effect(template, Effect::LootBox);
}

public(package) fun is_loot_box(template: &ItemTemplate): bool {
  if (item::template_category(template) != b"consumable".to_string()) return false;
  let effect: &Effect = dfield::borrow(item::template_uid(template), EffectKey());
  match (effect) {
    Effect::LootBox => true,
    _ => false,
  }
}

/// Use one unit of `item_id` on the character: burn it, read the template's effect, apply.
public(package) fun consume(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected_item: &AresRPG_TransferPolicy<Item>,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // a rooted character (gather-time OR a fired protector verdict) is occupied — no acting,
  // so a recall potion can never wipe the root and dodge the ambush.
  assert!(!world::is_rooted(kiosk.borrow(cap, character_id), clock), ERooted);
  // the passed template must be the item's own — the effect is read off it
  assert!({ let it: &Item = kiosk.borrow(cap, item_id); it.template() } == object::id(template), ETemplateMismatch);
  let category = item::burn(kiosk, cap, protected_item, item_id, 1, ctx);
  assert!(category == b"consumable".to_string(), ENotConsumable);

  let effect: Effect = *dfield::borrow(item::template_uid(template), EffectKey());
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  match (effect) {
    Effect::Heal(amount) => progression::heal(chr, amount as u64, clock),
    Effect::ResetStats => character::reset_stats(chr),
    Effect::ResetSpells => progression::reset_spells(chr),
    Effect::Recall => world::teleport_center(chr, clock),
    Effect::LootBox => abort ELootBox,
  };
}
