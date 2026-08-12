// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Equipment — the legacy flow, verbatim mechanics: equipping SENDS the item to the character's
/// own address (true ownership, visible in every explorer); unequipping RECEIVES it back and
/// re-locks it in the kiosk. The slot map on the character records `{ item, template, stats }`
/// at equip time — the chain-side fight reads the RECORD, never the sent item (a sent object is
/// unreachable in-transaction; legacy's server read off-chain, our chain cannot). The record
/// cannot drift: the item is immobile while equipped and its stats immutable.
///
/// 18 combat slots (weapon · tool · helmet · chestplate · belt · gauntlets · pants · boots ·
/// amulet · left_ring · right_ring · pet · relic_1..6) + 3 cosmetic (title · hat · cloak).
module aresrpg::equipment;

use aresrpg::{character::{Self, Character}, item::{Self, Item}};
use aresrpg_math::{item_damages::ItemDamages, item_stats::{Self, ItemStatistics}};
use std::string::String;
use sui::{dynamic_field as dfield, event, transfer::Receiving, vec_map::{Self, VecMap}};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EInvalidSlot: u64 = 1001; // equip/unequip: not one of the 21 slots
const EWrongCategory: u64 = 1002; // equip: the item's category does not fit the slot
const ELevelTooLow: u64 = 1003; // equip: character level below the item's level
const ESlotTaken: u64 = 1004; // equip: the slot already holds an item
const ERelicDuplicate: u64 = 1005; // equip: a relic of the same template is already worn
const ENotEquipped: u64 = 1006; // unequip: the slot is empty
const EWrongItem: u64 = 1007; // unequip: the received item is not the slot's record

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// DF key on the character → the slot map.
public struct EquipmentKey() has copy, drop, store;

/// DF key on the character → the folded gear-stat total. TWO writers only (equip, unequip)
/// over immutable inputs — a denormalization that cannot drift.
public struct FoldedKey() has copy, drop, store;

/// What a slot remembers about its sent-away item — everything the fight will ever read.
/// `damages` is the weapon's line snapshot (empty for everything else).
public struct EquippedRecord has copy, drop, store {
  item: ID,
  template: ID,
  category: String, // the fight reads weapon physics (range/AP law table) off this
  stats: Option<ItemStatistics>,
  damages: vector<ItemDamages>,
}

public struct ItemEquipped has copy, drop { character: ID, slot: String, item: ID }

public struct ItemUnequipped has copy, drop { character: ID, slot: String, item: ID }

// ╔════════════════ [ Package doors ] ═════════════════════════════════════════ ]

/// Equip: record the snapshot, send the item to the character's address. The caller picked the
/// slot (that is how a ring chooses a hand); the door checks it is legal for the category.
public(package) fun equip(chr: &mut Character, slot: String, item: Item) {
  verify_slot(slot);
  assert!(category_fits(&slot, &item.category()), EWrongCategory);
  assert!((chr.level() as u64) >= (item.level() as u64), ELevelTooLow);

  let character_id = chr.id();
  let character_address = character_id.to_address();
  let map = borrow_map_mut(chr);
  assert!(!map.contains(&slot), ESlotTaken);

  // A relic of the same TEMPLATE can be worn only once across the six slots.
  if (is_relic_slot(&slot)) {
    let mut i = 1u8;
    while (i <= 6) {
      let key = relic_slot(i);
      if (map.contains(&key)) {
        assert!(map[&key].template != item.template(), ERelicDuplicate);
      };
      i = i + 1;
    };
  };

  let record = EquippedRecord {
    item: object::id(&item),
    template: item.template(),
    category: item.category(),
    stats: if (item.has_stats()) option::some(item.stats()) else option::none(),
    damages: if (item.has_damages()) item.damages() else vector[],
  };
  map.insert(slot, record);
  refold(chr);
  event::emit(ItemEquipped { character: character_id, slot, item: object::id(&item) });
  transfer::public_transfer(item, character_address);
}

/// Unequip: receive the item back off the character, erase the record, hand the item to the
/// caller (the api door re-locks it in the kiosk).
public(package) fun unequip(chr: &mut Character, slot: String, receiving: Receiving<Item>): Item {
  verify_slot(slot);
  let character_id = chr.id();
  let map = borrow_map_mut(chr);
  assert!(map.contains(&slot), ENotEquipped);
  let (_, record) = map.remove(&slot);

  let item = transfer::public_receive(character::uid_mut(chr), receiving);
  assert!(object::id(&item) == record.item, EWrongItem);
  refold(chr);
  event::emit(ItemUnequipped { character: character_id, slot, item: record.item });
  item
}

/// Rewrite one slot's stat snapshot and refold — the PET seam: feeding scales the pet's
/// stats, and the sent-away item can't be re-read, so the feeder hands the fresh numbers in.
public(package) fun set_slot_stats(chr: &mut Character, slot: String, stats: ItemStatistics) {
  let map = borrow_map_mut(chr);
  assert!(map.contains(&slot), ENotEquipped);
  let record = map.get_mut(&slot);
  record.stats = option::some(stats);
  refold(chr);
}

/// Is a pet on the pet slot? (The travel checkpoint's ×1.5 flag reads this.)
public(package) fun pet_equipped(chr: &Character): bool {
  equipped(chr).contains(&b"pet".to_string())
}

/// The delete guard reads this: a character with anything equipped cannot die.
public(package) fun has_any_equipped(chr: &Character): bool {
  let uid = chr.uid();
  dfield::exists(uid, EquipmentKey()) &&
    !dfield::borrow<EquipmentKey, VecMap<String, EquippedRecord>>(uid, EquipmentKey()).is_empty()
}

/// The gathering gate's read: the equipped tool's category (`tool_farmer` | `tool_herbalist`
/// | `tool_miner`), or empty when the tool slot is bare — the honest "no tool" state.
public(package) fun tool_of(chr: &Character): String {
  let map = equipped(chr);
  let slot = b"tool".to_string();
  if (!map.contains(&slot)) return b"".to_string();
  map[&slot].category
}

/// The fight's read: every equipped record (stats fold there, not here).
public(package) fun equipped(chr: &Character): VecMap<String, EquippedRecord> {
  let uid = chr.uid();
  if (!dfield::exists(uid, EquipmentKey())) return vec_map::empty();
  *dfield::borrow(uid, EquipmentKey())
}

/// The folded gear total — every reader's door (hp regen, fight entry, UI). Neutral when bare.
public(package) fun folded(chr: &Character): ItemStatistics {
  let uid = chr.uid();
  if (!dfield::exists(uid, FoldedKey())) return item_stats::zero();
  *dfield::borrow(uid, FoldedKey())
}

public(package) fun record_category(record: &EquippedRecord): String { record.category }

public(package) fun record_damages(record: &EquippedRecord): vector<ItemDamages> { record.damages }

// ╔════════════════ [ Private ] ══════════════════════════════════════════════ ]

fun borrow_map_mut(chr: &mut Character): &mut VecMap<String, EquippedRecord> {
  let uid = character::uid_mut(chr);
  if (!dfield::exists(uid, EquipmentKey())) {
    dfield::add(uid, EquipmentKey(), vec_map::empty<String, EquippedRecord>());
  };
  dfield::borrow_mut(uid, EquipmentKey())
}

/// Recompute the folded total from the slot map — called by the two writers only.
fun refold(chr: &mut Character) {
  let mut blocks = vector[];
  let map = equipped(chr);
  let keys = map.keys();
  let mut i = 0;
  while (i < keys.length()) {
    let record = &map[&keys[i]];
    if (record.stats.is_some()) blocks.push_back(*record.stats.borrow());
    i = i + 1;
  };
  let folded = item_stats::fold(&blocks);
  let uid = character::uid_mut(chr);
  if (dfield::exists(uid, FoldedKey())) {
    *dfield::borrow_mut(uid, FoldedKey()) = folded;
  } else {
    dfield::add(uid, FoldedKey(), folded);
  };
}

fun is_relic_slot(slot: &String): bool {
  *slot == b"relic_1".to_string() || *slot == b"relic_2".to_string() ||
  *slot == b"relic_3".to_string() || *slot == b"relic_4".to_string() ||
  *slot == b"relic_5".to_string() || *slot == b"relic_6".to_string()
}

fun relic_slot(i: u8): String {
  if (i == 1) return b"relic_1".to_string();
  if (i == 2) return b"relic_2".to_string();
  if (i == 3) return b"relic_3".to_string();
  if (i == 4) return b"relic_4".to_string();
  if (i == 5) return b"relic_5".to_string();
  b"relic_6".to_string()
}

/// Which categories a slot accepts. Weapons are UNIVERSAL (any class); tools have their own
/// slot (ruling 2026-08-09 — never the weapon slot).
fun category_fits(slot: &String, category: &String): bool {
  if (*slot == b"weapon".to_string()) {
    return *category == b"longsword".to_string() || *category == b"daggers".to_string() ||
      *category == b"battleaxe".to_string() || *category == b"spear".to_string() ||
      *category == b"staff".to_string() || *category == b"spellbook".to_string() ||
      *category == b"bow".to_string() || *category == b"axe".to_string() ||
      *category == b"mace".to_string() || *category == b"club".to_string() ||
      *category == b"sword".to_string()
  };
  if (*slot == b"tool".to_string()) {
    return *category == b"tool_farmer".to_string() || *category == b"tool_herbalist".to_string() ||
      *category == b"tool_miner".to_string()
  };
  if (*slot == b"left_ring".to_string() || *slot == b"right_ring".to_string()) {
    return *category == b"ring".to_string()
  };
  if (is_relic_slot(slot)) return *category == b"relic".to_string();
  // every remaining slot's name IS its category (helmet, chestplate, belt, gauntlets, pants,
  // boots, amulet, pet, title, hat, cloak)
  *slot == *category
}

fun verify_slot(slot: String) {
  assert!(
    slot == b"weapon".to_string() ||
      slot == b"tool".to_string() ||
      slot == b"helmet".to_string() ||
      slot == b"chestplate".to_string() ||
      slot == b"belt".to_string() ||
      slot == b"gauntlets".to_string() ||
      slot == b"pants".to_string() ||
      slot == b"boots".to_string() ||
      slot == b"amulet".to_string() ||
      slot == b"left_ring".to_string() ||
      slot == b"right_ring".to_string() ||
      slot == b"pet".to_string() ||
      is_relic_slot(&slot) ||
      slot == b"title".to_string() ||
      slot == b"hat".to_string() ||
      slot == b"cloak".to_string(),
    EInvalidSlot,
  );
}
