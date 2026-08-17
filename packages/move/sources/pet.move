// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PET POWER — the legacy law, verbatim (owner 2026-08-10: "unchanged"): one food unit per
/// UTC day grows a pet from NEUTRAL stats to its rolled maximum in 60 feeds — power is
/// linear, `stat = center + (rolled − center) × feeds / 60`, signed magnitudes scaling away
/// from the centered encoding's neutral point. Feed state lives ON THE PET ITEM (a traded
/// pet carries its power). Each frozen pet template authors the resource item types it eats;
/// there is no global food category or mutable config object.
///
/// ONE feed door — the pet feeds in the KIOSK. An equipped pet feeds through a FRONTEND PTB
/// that composes existing doors (`unequip_item` → `feed_kiosk_pet` → `equip_item`), so no
/// equipped-path code lives here (owner 2026-08-10: unbloat). The equip door reads
/// `scaled_stats` to fold the pet's power, so re-equipping picks up the new feed for free.
module aresrpg::pet;

use aresrpg::{item::{Self, Item, ItemTemplate}, protected_policy::AresRPG_TransferPolicy};
use aresrpg_math::{content_rules, item_stats::{Self, ItemStatistics}};
use sui::{clock::Clock, dynamic_field as dfield, event, kiosk::{Kiosk, KioskOwnerCap}};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENotPet: u64 = 2501; // feed: the target item is not a pet
const ENotFood: u64 = 2502; // feed: the resource item_type is absent from this pet's diet
const EAlreadyFedToday: u64 = 2503; // one feed per UTC day
const EFullyFed: u64 = 2504; // 60 feeds = the maximum
const EWrongTemplate: u64 = 2505; // feed: the supplied frozen template is not the pet's template

const MAX_FEEDS: u64 = 60;
const DAY_MS: u64 = 86_400_000; // UTC-day index = timestamp / this

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// DF key on the pet Item → its feed state.
public struct FeedKey() has copy, drop, store;

public struct FeedState has copy, drop, store {
  count: u64, // 0..=60
  last_day: u64, // UTC-day index of the last feed
}

public struct PetFed has copy, drop { pet: ID, feeder: address, power: u64 }

// ╔════════════════ [ Door (api gates the version, then calls) ] ═════════════ ]

/// Feed a pet where it sits in the kiosk — one authored resource unit per UTC day.
public(package) fun feed_kiosk_pet(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  pet_template: &ItemTemplate,
  protected_item: &AresRPG_TransferPolicy<Item>,
  pet_id: ID,
  food_id: ID,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let pet_template_id = {
    let pet: &Item = kiosk.borrow(cap, pet_id);
    pet.template()
  };
  assert!(pet_template_id == item::template_id(pet_template), EWrongTemplate);
  let (food_type, food_category) = {
    let food: &Item = kiosk.borrow(cap, food_id);
    (food.item_type(), food.category())
  };
  assert!(food_category == b"resource".to_string(), ENotFood);
  assert!(content_rules::pet_accepts(item::template_pet_foods(pet_template), &food_type), ENotFood);
  item::burn(kiosk, cap, protected_item, food_id, 1, ctx);
  let pet: &mut Item = kiosk.borrow_mut(cap, pet_id);
  feed(pet, clock, ctx);
}

// ╔════════════════ [ Reads (the equip door folds through `scaled_stats`) ] ══ ]

/// Feeds so far (0..=60) — the pet's POWER.
public fun power(pet: &Item): u64 {
  if (!dfield::exists(item::uid(pet), FeedKey())) return 0;
  dfield::borrow<FeedKey, FeedState>(item::uid(pet), FeedKey()).count
}

/// The pet's LIVE stats: every rolled magnitude scaled `count/60` away from the neutral
/// center. A stat-less or never-fed pet folds as neutral.
public fun scaled_stats(pet: &Item): ItemStatistics {
  let count = power(pet);
  if (!pet.has_stats()) return item_stats::zero();
  pet.stats().scale_from_center(count, MAX_FEEDS)
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

/// One feed: today's UTC day must be NEW, the pet not maxed. State initializes lazily.
fun feed(pet: &mut Item, clock: &Clock, ctx: &TxContext) {
  assert!(pet.category() == b"pet".to_string(), ENotPet);
  let today = clock.timestamp_ms() / DAY_MS;
  let uid = item::uid_mut(pet);
  if (!dfield::exists(uid, FeedKey())) {
    dfield::add(uid, FeedKey(), FeedState { count: 0, last_day: 0 });
  };
  let state: &mut FeedState = dfield::borrow_mut(uid, FeedKey());
  assert!(state.count < MAX_FEEDS, EFullyFed);
  assert!(today > state.last_day, EAlreadyFedToday);
  state.count = state.count + 1;
  state.last_day = today;
  let count = state.count;
  event::emit(PetFed { pet: object::id(pet), feeder: ctx.sender(), power: count });
}
