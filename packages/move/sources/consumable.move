// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUMABLES — the instant single-transaction use (owner 2026-08-10). One unit burns off a
/// kiosk-locked stack and its authored effect fires on the character. FOUR sealed kinds, no
/// randomness: 0 HEAL (power hp, capped) · 1 RESET_STAT_POINTS (refund the six, keep gear)
/// · 2 RESET_SPELL_POINTS (clear the raised book, refund) · 3 TELEPORT_TO_CENTER (recall to
/// the world portal). The effect is frozen on the item template; this module is only the
/// resolver — it reads the effect and composes the progression/character/world doors.
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
use sui::{clock::Clock, kiosk::{Kiosk, KioskOwnerCap}};

const ENotConsumable: u64 = 2601; // the burned stack is not a consumable
const ETemplateMismatch: u64 = 2602; // the passed template is not the item's template
const ERooted: u64 = 2603; // a gather-time root or a fired ambush verdict is holding you

const K_HEAL: u8 = 0;
const K_RESET_STATS: u8 = 1;
const K_RESET_SPELLS: u8 = 2;
const K_TELEPORT_CENTER: u8 = 3;
const EGachaBox: u64 = 2604; // kind 4 (gacha lootbox) is OPENED via loot_box, never consumed here

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

  let (kind, power) = item::consumable_of(template);
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  if (kind == K_HEAL) {
    progression::heal(chr, power as u64, clock);
  } else if (kind == K_RESET_STATS) {
    character::reset_stats(chr);
  } else if (kind == K_RESET_SPELLS) {
    progression::reset_spells(chr);
  } else if (kind == K_TELEPORT_CENTER) {
    world::teleport_center(chr, clock);
  } else {
    abort EGachaBox // kind 4 — a gacha box opens through `loot_box`, not the plain consume (reverts the burn)
  };
}
