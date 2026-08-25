// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Equipment — the legacy flow, verbatim mechanics: equipping SENDS the item to the character's
/// own address (true ownership, visible in every explorer); unequipping RECEIVES it back and
/// re-locks it in the kiosk. The slot map on the character records `{ item, template, stats }`
/// at equip time — the chain-side fight reads the RECORD, never the sent item (a sent object is
/// unreachable in-transaction; legacy's server read off-chain, our chain cannot). The record
/// cannot drift: the item is immobile while equipped and its stats immutable.
///
/// 17 equipment slots: weapon · tool · hat · cloak · belt · boots · amulet · left_ring ·
/// right_ring · pet · title · relic_1..6.
module aresrpg::equipment;

use aresrpg::{character::{Self, Character}, item::{Self, Item}};
use aresrpg_math::{content_rules, item_damages::ItemDamages, item_stats::{Self, ItemStatistics}};
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
  assert!(content_rules::is_slot(&slot), EInvalidSlot);
  assert!(content_rules::category_fits(&slot, &item.category()), EWrongCategory);
  assert!((chr.level() as u64) >= (item.level() as u64), ELevelTooLow);

  let character_id = chr.id();
  let character_address = character_id.to_address();
  let map = bmm(chr);
  assert!(!map.contains(&slot), ESlotTaken);

  // A relic of the same TEMPLATE can be worn only once across the six slots.
  if (content_rules::is_relic_slot(&slot)) {
    let mut i = 1u8;
    while (i <= 6) {
      let key = content_rules::relic_slot(i);
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
  r1(chr);
  event::emit(ItemEquipped { character: character_id, slot, item: object::id(&item) });
  transfer::public_transfer(item, character_address);
}

/// Unequip: receive the item back off the character, erase the record, hand the item to the
/// caller (the api door re-locks it in the kiosk).
public(package) fun unequip(chr: &mut Character, slot: String, receiving: Receiving<Item>): Item {
  assert!(content_rules::is_slot(&slot), EInvalidSlot);
  let character_id = chr.id();
  let map = bmm(chr);
  assert!(map.contains(&slot), ENotEquipped);
  let (_, record) = map.remove(&slot);

  let item = transfer::public_receive(character::uid_mut(chr), receiving);
  assert!(object::id(&item) == record.item, EWrongItem);
  r1(chr);
  event::emit(ItemUnequipped { character: character_id, slot, item: record.item });
  item
}

/// Rewrite one slot's stat snapshot and refold — the PET seam: feeding scales the pet's
/// stats, and the sent-away item can't be re-read, so the feeder hands the fresh numbers in.
public(package) fun set_slot_stats(chr: &mut Character, slot: String, stats: ItemStatistics) {
  let map = bmm(chr);
  assert!(map.contains(&slot), ENotEquipped);
  let record = map.get_mut(&slot);
  record.stats = option::some(stats);
  r1(chr);
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

// borrow_map_mut
fun bmm(chr: &mut Character): &mut VecMap<String, EquippedRecord> {
  let uid = character::uid_mut(chr);
  if (!dfield::exists(uid, EquipmentKey())) {
    dfield::add(uid, EquipmentKey(), vec_map::empty<String, EquippedRecord>());
  };
  dfield::borrow_mut(uid, EquipmentKey())
}

// refold
/// Recompute the folded total from the slot map — called by the two writers only.
fun r1(chr: &mut Character) {
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
