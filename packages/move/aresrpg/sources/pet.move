// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PET POWER — one item burned per UTC day grows a pet from neutral stats to its template maximum in 60 feeds.
/// The count and day stamp are additive item dynamic fields; the effective stat block itself is written onto the
/// pet Item after every feed. Equipped pets also refresh the character's folded-stat cache in the same transaction.
module aresrpg::pet;

use aresrpg::{
  admin::AdminCap,
  character_link,
  config::GameConfig,
  equipment,
  extension,
  version::Version
};
use aresrpg::{
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  item_stats::{Self, ItemStatistics}
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, event, kiosk::Kiosk, table::{Self, Table}, tx_context::sender};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EUnknownFood: u64 = 101; // feed: the consumed item's template is not a configured food (no power authored)
const ENotPet: u64 = 102; // target item/template category is not pet
const EUseFeedPet: u64 = 103; // frozen pre-cadence entry is sealed; callers must compose feed_pet
const EAlreadyFedToday: u64 = 104; // the pet already consumed its one feed in this UTC day
const EFullyFed: u64 = 105; // the pet already reached 60 feeds
const ETemplateMismatch: u64 = 106; // supplied pet template does not belong to the target item
const ETemplateHasNoStats: u64 = 107; // pet template has no authored maximum to grow toward
const EInvalidFoodPower: u64 = 108; // every configured food unit must grant exactly one feed
const ESameItem: u64 = 109; // the target pet cannot also be the food item
const EWrongBurnAmount: u64 = 110; // the one-unit extraction invariant was violated

const UTC_DAY_MS: u64 = 86_400_000;
const POWER_PER_FEED: u64 = 1;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Allowed food templates. The frozen table value remains for upgrade compatibility but is constrained to one;
/// absence means the template is not feedable.
public struct PetFeedConfig has key {
  id: UID,
  foods: Table<ID, u64>,
}

/// NS_ITEM key → the UTC-day index (`timestamp_ms / 86_400_000`) of the last successful feed.
public struct PetLastFeedDayKey has copy, drop, store {}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct FoodPowerSet has copy, drop { food_template: ID, power_per_unit: u64 }

public struct PetFed has copy, drop { pet: ID, feeder: address, food_template: ID, power: u64 }

public struct PetPowerAdvanced has copy, drop {
  pet: ID,
  feeder: address,
  feed_count: u64,
  next_feed_ms: u64,
}

// ╔════════════════ [ Init ] ═════════════════════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  transfer::share_object(PetFeedConfig { id: object::new(ctx), foods: table::new(ctx) });
}

// ╔════════════════ [ Admin (AdminCap + version gated — food powers authored while dark) ] ═ ]

/// Allow one food template. Uniform pet-power law: every consumed unit grants exactly one daily feed.
public fun set_food_power(cap: &AdminCap, version: &Version, config: &mut PetFeedConfig, food_template: ID, power_per_unit: u64, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(power_per_unit == POWER_PER_FEED, EInvalidFoodPower);
  if (config.foods.contains(food_template)) *config.foods.borrow_mut(food_template) = power_per_unit
  else config.foods.add(food_template, power_per_unit);
  event::emit(FoodPowerSet { food_template, power_per_unit });
}

// ╔════════════════ [ Feed ] ═════════════════════════════════════════════════ ]

/// Frozen pre-cadence ABI. Its arbitrary-stack/arbitrary-power behavior is sealed on the fresh lineage.
public fun feed(
  _feed_config: &PetFeedConfig,
  _kiosk: &mut Kiosk,
  _pkcap: &PersonalKioskCap,
  _character_id: ID,
  _pet_item_id: ID,
  _food_item_id: ID,
  _xpolicy: &ItemExtractPolicy,
  _config: &GameConfig,
  _version: &Version,
  _ctx: &mut TxContext,
) {
  abort EUseFeedPet
}

/// Burn exactly one configured food unit and advance a loose or equipped pet once per UTC day. The authoritative
/// current item stats are `template max × feed_count / 60`, scaling signed magnitudes away from the neutral center.
public fun feed_pet(
  feed_config: &PetFeedConfig,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  pet_item_id: ID,
  pet_template: &ItemTemplate,
  food_item_id: ID,
  xpolicy: &ItemExtractPolicy,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  version.assert_enabled();
  assert!(pet_item_id != food_item_id, ESameItem);

  let (food, pledge) = extract::extract_one_for_burn(kiosk, pkcap, food_item_id, xpolicy, version, ctx);
  let (food_template, amount) = extract::burn(pledge, food, version);
  assert!(amount == 1, EWrongBurnAmount);

  assert!(feed_config.foods.contains(food_template), EUnknownFood);
  assert!(*feed_config.foods.borrow(food_template) == POWER_PER_FEED, EInvalidFoodPower);

  let owner_cap = personal_kiosk::borrow(pkcap);
  let day = clock.timestamp_ms() / UTC_DAY_MS;
  let feed_count = if (kiosk.has_item(pet_item_id)) {
    let pet = kiosk.borrow_mut(owner_cap, pet_item_id);
    let (feed_count, stats) = advance_pet(pet, pet_template, day, version);
    item_stats::set_rolled(pet, stats);
    feed_count
  } else {
    let character = kiosk.borrow_mut(owner_cap, character_id);
    let (feed_count, stats) = {
      let pet = equipment::borrow_equipped_mut(character, pet_item_id, version);
      advance_pet(pet, pet_template, day, version)
    };
    equipment::set_equipped_stats(character, pet_item_id, stats, version);
    feed_count
  };

  event::emit(PetFed { pet: pet_item_id, feeder: sender(ctx), food_template, power: POWER_PER_FEED });
  event::emit(PetPowerAdvanced {
    pet: pet_item_id,
    feeder: sender(ctx),
    feed_count,
    next_feed_ms: (day + 1) * UTC_DAY_MS,
  });
}

fun advance_pet(pet: &mut Item, template: &ItemTemplate, day: u64, version: &Version): (u64, ItemStatistics) {
  assert!(item::category(pet) == b"pet".to_string(), ENotPet);
  assert!(item::template_category(template) == b"pet".to_string(), ENotPet);
  assert!(item::template(pet) == item::template_id(template), ETemplateMismatch);
  assert!(item_stats::has_ranges(template), ETemplateHasNoStats);

  let feed_count = character_link::pet_power(pet);
  assert!(feed_count < item_stats::pet_full_feed_count(), EFullyFed);
  let ns = extension::ns_item();
  let key = PetLastFeedDayKey {};
  if (extension::item_field_exists(pet, ns, key)) {
    let last = *extension::borrow_item_field<PetLastFeedDayKey, u64>(pet, ns, key);
    assert!(last < day, EAlreadyFedToday);
    *extension::borrow_item_field_mut(ns, pet, key, version) = day;
  } else {
    extension::add_item_field(ns, pet, key, day, version);
  };

  let next_count = feed_count + POWER_PER_FEED;
  character_link::grow_pet_power(pet, POWER_PER_FEED, version);
  (next_count, item_stats::pet_stats_at_count(template, next_count))
}

// ╔════════════════ [ Getters ] ══════════════════════════════════════════════ ]

public fun has_food(config: &PetFeedConfig, food_template: ID): bool { config.foods.contains(food_template) }

public fun food_power(config: &PetFeedConfig, food_template: ID): u64 { *config.foods.borrow(food_template) }

public fun feed_count(pet: &Item): u64 { character_link::pet_power(pet) }

public fun full_feed_count(): u64 { item_stats::pet_full_feed_count() }

public fun has_last_feed_day(pet: &Item): bool {
  extension::item_field_exists(pet, extension::ns_item(), PetLastFeedDayKey {})
}

public fun last_feed_day(pet: &Item): u64 {
  *extension::borrow_item_field<PetLastFeedDayKey, u64>(pet, extension::ns_item(), PetLastFeedDayKey {})
}

public fun next_feed_available_ms(pet: &Item): u64 {
  if (!has_last_feed_day(pet)) 0 else (last_feed_day(pet) + 1) * UTC_DAY_MS
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
