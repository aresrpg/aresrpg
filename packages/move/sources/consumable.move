// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUMABLES — stackable behavior is LIVE content: every unit of one template adopts that
/// template's current effect, so split and merge remain amount-only. Loot boxes use the same
/// authority through their own terminal-randomness flow.
///
/// A consumable can't be used mid-fight BY CONSTRUCTION: fight custody means the character is
/// not in the kiosk, so there is nothing for `borrow_mut` to reach.
module aresrpg::consumable;

use aresrpg::{
  character::{Self, Character},
  item::{Self, Item},
  progression,
  protected_policy::AresRPG_TransferPolicy,
  world,
};
use aresrpg_math::consumable_effect;
use aresrpg_seed::{item_rows::{Self, ItemTemplate}, world_content::WorldContent};
use sui::{clock::Clock, kiosk::{Kiosk, KioskOwnerCap}};

const ENotConsumable: u64 = 2601; // the burned stack is not a consumable
const ERooted: u64 = 2603; // a gather-time root or a fired ambush verdict is holding you
const ELootBox: u64 = 2604; // loot boxes open through `loot_box`, never the plain consume door
const ECityConsumable: u64 = 2605; // city potions use the WorldContent-gated city door

/// Use one unit of `item_id` on the character through its current template effect.
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
  let effect = burn_one(
    kiosk, cap, protected_item, character_id, item_id, template, clock, ctx,
  );
  assert!(!consumable_effect::is_loot_box(&effect), ELootBox);
  assert!(consumable_effect::city_name(&effect).is_none(), ECityConsumable);

  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  let heal = consumable_effect::heal_amount(&effect);
  if (heal.is_some()) progression::heal(character, heal.destroy_some() as u64, clock)
  else if (consumable_effect::is_reset_stats(&effect)) character::reset_stats(character)
  else if (consumable_effect::is_reset_spells(&effect)) progression::reset_spells(character)
  else if (consumable_effect::is_recall(&effect)) world::teleport_center(character, clock)
  else abort ELootBox
}

public(package) fun consume_city(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected_item: &AresRPG_TransferPolicy<Item>,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  content: &WorldContent,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let effect = burn_one(
    kiosk, cap, protected_item, character_id, item_id, template, clock, ctx,
  );
  let city = consumable_effect::city_name(&effect);
  assert!(city.is_some(), ECityConsumable);
  world::teleport_city(kiosk.borrow_mut(cap, character_id), content, city.borrow(), clock);
}

fun burn_one(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected_item: &AresRPG_TransferPolicy<Item>,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  clock: &Clock,
  ctx: &mut TxContext,
): aresrpg_math::consumable_effect::Effect {
  // a rooted character (gather-time OR a fired protector verdict) is occupied — no acting,
  // so a recall potion can never wipe the root and dodge the ambush.
  assert_available(kiosk.borrow(cap, character_id), clock);
  let held_template = { let it: &Item = kiosk.borrow(cap, item_id); it.template() };
  assert!(held_template == item_rows::template_id(template), ENotConsumable);
  let effect = item_rows::consumable_effect(template);
  assert!(effect.is_some(), ENotConsumable);
  let effect = effect.destroy_some();
  let category = item::burn(kiosk, cap, protected_item, item_id, 1, ctx);
  assert!(category == b"consumable".to_string(), ENotConsumable);
  effect
}

fun assert_available(character: &Character, clock: &Clock) {
  assert!(!world::is_rooted(character, clock), ERooted);
}

#[test_only]
public(package) fun assert_available_for_testing(character: &Character, clock: &Clock) {
  assert_available(character, clock);
}
