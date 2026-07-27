// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pet-power tests: one item per UTC day, a 60-feed template-max curve, and equipped-cache refresh.
#[test_only]
module aresrpg::pet_tests;

use aresrpg_foundation::spell;
use aresrpg::{
  admin::{Self, AdminCap},
  catalog::Catalog,
  character_link,
  config::GameConfig,
  equipment,
  extension,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  item_stats::{Self, ItemStatistics},
  pet::{Self, PetFeedConfig},
  test_world,
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};

const OWNER: address = @0xA;
const DAY_MS: u64 = 86_400_000;

const EUnknownFood: u64 = 101;
const ENotPet: u64 = 102;
const EAlreadyFedToday: u64 = 104;
const EFullyFed: u64 = 105;
const EInvalidFoodPower: u64 = 108;

// ╔════════════════ [ Harness ] ══════════════════════════════════════════════ ]

fun pet_max(): ItemStatistics {
  let c = item_stats::shift();
  item_stats::new(
    c, c, c + 70, c, c, c, c, c, c,
    c, c, c, c, c, c, c, c,
  )
}

fun author_pet(sc: &mut Scenario): ID {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let cat = sc.take_shared<Catalog>();
  let ver = sc.take_shared<Version>();
  let max = pet_max();
  let tid = admin::create_template(
    &cap, &cat, b"Wolf".to_string(), b"A growing test pet.".to_string(), b"wolf".to_string(),
    b"pet".to_string(), 1, option::some(max), option::some(max), vector[], option::none(), &ver, sc.ctx(),
  );
  ts::return_shared(cat);
  ts::return_shared(ver);
  sc.return_to_sender(cap);
  tid
}

/// Boot + character + a +70-strength pet template + a stackable food template.
fun stage(sc: &mut Scenario): (ID, ID, ID) {
  test_world::boot(sc);
  let cid = test_world::mint_character(sc, OWNER);
  test_world::whitelist(sc, b"pet");
  let pet_t = author_pet(sc);
  let food_t = test_world::make_template(sc, b"Meat", b"meat", b"resource", 1);
  (cid, pet_t, food_t)
}

fun set_food(sc: &mut Scenario, food: ID, power: u64) {
  sc.next_tx(OWNER);
  let cap = sc.take_from_sender<AdminCap>();
  let ver = sc.take_shared<Version>();
  let mut fc = sc.take_shared<PetFeedConfig>();
  pet::set_food_power(&cap, &ver, &mut fc, food, power, sc.ctx());
  ts::return_shared(ver);
  ts::return_shared(fc);
  sc.return_to_sender(cap);
}

/// Mirror the direct-sale path: generic shop rolling delegates the new-pet count-zero normalization to item_stats.
fun mint_lock_shop_pet(sc: &mut Scenario, pet_template: ID): ID {
  sc.next_tx(OWNER);
  let template = sc.take_shared_by_id<ItemTemplate>(pet_template);
  let version = sc.take_shared<Version>();
  let market = sc.take_shared<TransferPolicy<Item>>();
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let (mut pet_item, pledge) = extension::z502(&template, &version, sc.ctx());
  item_stats::attach_rolled(&mut pet_item, *item_stats::stats_max(&template));
  let pet_id = object::id(&pet_item);
  item::lock_in_kiosk(
    pledge, pet_item, &mut kiosk, personal_kiosk::borrow(&pkcap), &market,
  );
  ts::return_shared(template);
  ts::return_shared(version);
  ts::return_shared(market);
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  pet_id
}

/// #88 — force a pet's stored power PAST the 60-feed bound: the exact shape the pre-cadence `feed()` door
/// (now sealed, EUseFeedPet) could leave behind by writing arbitrary power×amount under the SAME PetPowerKey
/// the current 0-60 feed-count cadence reinterprets. `feed_pet`'s own EFullyFed gate makes 61+ physically
/// unreachable through the LIVE feed door (see `sixty_first_feed_aborts` above) — this reaches the identical
/// DF the legacy door wrote, via the package-private write `character_link` owns, so a pre-seal wallet's
/// state is reproducible without a real chain history.
fun force_legacy_power(sc: &mut Scenario, pet_id: ID, amount: u64) {
  sc.next_tx(OWNER);
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let ver = sc.take_shared<Version>();
  let pet = k.borrow_mut(personal_kiosk::borrow(&pkcap), pet_id);
  character_link::z9(pet, amount, &ver);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(ver);
}

/// Exercise the production extract → equipment::equip path rather than the raw testing attachment bypass.
fun equip_locked_pet(sc: &mut Scenario, character_id: ID, pet_id: ID, pet_template: ID) {
  sc.next_tx(OWNER);
  let mut kiosk = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(pet_template);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let version = sc.take_shared<Version>();
  let (pet_item, pledge) = extract::extract_for_equip(
    &mut kiosk, &pkcap, pet_id, &xpolicy, &version, sc.ctx(),
  );
  equipment::equip(
    &mut kiosk, &pkcap, character_id, pet_item, pledge, &template, &version,
  );
  ts::return_shared(kiosk);
  sc.return_to_sender(pkcap);
  ts::return_shared(template);
  ts::return_shared(xpolicy);
  ts::return_shared(version);
}

fun do_feed(sc: &mut Scenario, cid: ID, pet_id: ID, pet_template: ID, food_id: ID, now_ms: u64) {
  sc.next_tx(OWNER);
  let fc = sc.take_shared<PetFeedConfig>();
  let mut k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let template = sc.take_shared_by_id<ItemTemplate>(pet_template);
  let xpolicy = sc.take_shared<ItemExtractPolicy>();
  let cfg = sc.take_shared<GameConfig>();
  let ver = sc.take_shared<Version>();
  let mut clk = clock::create_for_testing(sc.ctx());
  clk.set_for_testing(now_ms);
  pet::feed_pet(
    &fc, &mut k, &pkcap, cid, pet_id, &template, food_id, &xpolicy, &cfg, &ver, &clk, sc.ctx(),
  );
  clk.destroy_for_testing();
  ts::return_shared(fc);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  ts::return_shared(template);
  ts::return_shared(xpolicy);
  ts::return_shared(cfg);
  ts::return_shared(ver);
}

fun current_strength(item: &Item): u64 {
  if (!item_stats::has_rolled_stats(item)) 0
  else ((item_stats::strength(item_stats::rolled_stats(item)) - item_stats::shift()) as u64)
}

fun loose_state(sc: &mut Scenario, pet_id: ID): (u64, u64, u64) {
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let item = k.borrow(personal_kiosk::borrow(&pkcap), pet_id);
  let feed_count = pet::feed_count(item);
  let strength = current_strength(item);
  let next_ms = pet::next_feed_available_ms(item);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  (feed_count, strength, next_ms)
}

fun equipped_state(sc: &mut Scenario, cid: ID, pet_id: ID): (u64, u64, u64) {
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  let character = k.borrow(personal_kiosk::borrow(&pkcap), cid);
  let item = extension::z30<ID, Item>(
    character, extension::z32(), pet_id,
  );
  let feed_count = pet::feed_count(item);
  let strength = current_strength(item);
  let folded_strength = spell::stat_strength(&equipment::folded_stats(character));
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  (feed_count, strength, folded_strength)
}

// ╔════════════════ [ Curve and happy paths ] ════════════════════════════════ ]

#[test]
fun curve_endpoints_are_neutral_and_template_max() {
  let max = pet_max();
  let base = item_stats::scale_from_center(&max, 0, 60);
  let full = item_stats::scale_from_center(&max, 60, 60);
  assert!(item_stats::strength(&base) == item_stats::shift());
  assert!(item_stats::strength(&full) == item_stats::strength(&max));
  assert!(item_stats::strength(&full) - item_stats::shift() == 70);
}

#[test]
fun configured_food_is_uniform_one_power() {
  let mut sc = ts::begin(OWNER);
  let (_cid, _pet_t, food_t) = stage(&mut sc);
  set_food(&mut sc, food_t, 1);
  sc.next_tx(OWNER);
  let fc = sc.take_shared<PetFeedConfig>();
  assert!(pet::has_food(&fc, food_t));
  assert!(pet::food_power(&fc, food_t) == 1);
  assert!(pet::full_feed_count() == 60);
  ts::return_shared(fc);
  sc.end();
}

#[test]
fun loose_pet_feed_burns_one_unit_and_writes_current_stats() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  let pet_id = test_world::mint_lock_gear(&mut sc, OWNER, pet_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 2);
  set_food(&mut sc, food_t, 1);
  do_feed(&mut sc, cid, pet_id, pet_t, food_id, DAY_MS);
  let (count, strength, next_ms) = loose_state(&mut sc, pet_id);
  assert!(count == 1);
  assert!(strength == 1); // floor(70 / 60)
  assert!(next_ms == 2 * DAY_MS);
  sc.next_tx(OWNER);
  let k = sc.take_shared<Kiosk>();
  let pkcap = sc.take_from_sender<PersonalKioskCap>();
  assert!(k.has_item(food_id)); // original stack id remains, now with one unit
  let food = k.borrow<Item>(personal_kiosk::borrow(&pkcap), food_id);
  assert!(item::amount(food) == 1);
  ts::return_shared(k);
  sc.return_to_sender(pkcap);
  sc.end();
}

#[test]
fun direct_sale_pet_is_neutral_at_count_zero_before_and_after_equip() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, _food_t) = stage(&mut sc);
  let pet_id = mint_lock_shop_pet(&mut sc, pet_t);
  let (loose_count, loose_strength, _loose_next) = loose_state(&mut sc, pet_id);
  assert!(loose_count == 0 && loose_strength == 0);
  equip_locked_pet(&mut sc, cid, pet_id, pet_t);
  let (equipped_count, equipped_strength, folded_strength) = equipped_state(&mut sc, cid, pet_id);
  assert!(equipped_count == 0 && equipped_strength == 0 && folded_strength == 0);
  sc.end();
}

#[test]
fun sixty_feeds_reach_max_and_fold_the_derived_item_stats() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  let pet_id = test_world::equip_item(&mut sc, OWNER, cid, pet_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 60);
  set_food(&mut sc, food_t, 1);
  let (base_count, base_item, base_fold) = equipped_state(&mut sc, cid, pet_id);
  assert!(base_count == 0 && base_item == 0 && base_fold == 0);
  let mut feed = 1;
  while (feed <= 60) {
    do_feed(&mut sc, cid, pet_id, pet_t, food_id, feed * DAY_MS);
    feed = feed + 1;
  };
  let (full_count, full_item, full_fold) = equipped_state(&mut sc, cid, pet_id);
  assert!(full_count == 60 && full_item == 70 && full_fold == 70);
  sc.end();
}

// ╔════════════════ [ Guards ] ═══════════════════════════════════════════════ ]

#[test, expected_failure(abort_code = EInvalidFoodPower, location = pet)]
fun non_uniform_food_power_aborts() {
  let mut sc = ts::begin(OWNER);
  let (_cid, _pet_t, food_t) = stage(&mut sc);
  set_food(&mut sc, food_t, 2);
  abort
}

#[test, expected_failure(abort_code = EAlreadyFedToday, location = pet)]
fun second_feed_in_same_utc_day_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  let pet_id = test_world::mint_lock_gear(&mut sc, OWNER, pet_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 2);
  set_food(&mut sc, food_t, 1);
  do_feed(&mut sc, cid, pet_id, pet_t, food_id, 7 * DAY_MS + 1);
  do_feed(&mut sc, cid, pet_id, pet_t, food_id, 7 * DAY_MS + 1000);
  abort
}

#[test, expected_failure(abort_code = EFullyFed, location = pet)]
fun sixty_first_feed_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  let pet_id = test_world::mint_lock_gear(&mut sc, OWNER, pet_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 61);
  set_food(&mut sc, food_t, 1);
  let mut feed = 1;
  while (feed <= 60) {
    do_feed(&mut sc, cid, pet_id, pet_t, food_id, feed * DAY_MS);
    feed = feed + 1;
  };
  do_feed(&mut sc, cid, pet_id, pet_t, food_id, 61 * DAY_MS);
  abort
}

#[test, expected_failure(abort_code = EUnknownFood, location = pet)]
fun unconfigured_food_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  let pet_id = test_world::mint_lock_gear(&mut sc, OWNER, pet_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 1);
  do_feed(&mut sc, cid, pet_id, pet_t, food_id, DAY_MS);
  abort
}

#[test, expected_failure(abort_code = ENotPet, location = pet)]
fun non_pet_target_aborts() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, food_t) = stage(&mut sc);
  test_world::whitelist(&mut sc, b"sword");
  let sword_t = test_world::make_template(&mut sc, b"Blade", b"blade", b"sword", 1);
  let sword_id = test_world::equip_item(&mut sc, OWNER, cid, sword_t);
  let food_id = test_world::mint_lock_stack(&mut sc, OWNER, food_t, 1);
  set_food(&mut sc, food_t, 1);
  do_feed(&mut sc, cid, sword_id, pet_t, food_id, DAY_MS);
  abort
}

// ╔════════════════ [ #88 — legacy-encoded PetPowerKey vs the equip-time scale (RED-FIRST) ] ═ ]
// Root cause (issue #88): the pre-cadence `feed()` door stored arbitrary power×amount in the unversioned
// PetPowerKey; the current cadence reinterprets that SAME key as a bounded 0-60 feed count.
// `equipment::equip` normalizes a pet's stats off the stored count BEFORE slot placement
// (item_stats::z43 → scale_from_center asserts numerator <= denominator) — a legacy value past
// 60 aborts item_stats::EInvalidScale(101) inside that normalization, and because the PTB
// (extract_for_equip + equipment::equip) is one atomic transaction, the abort reverts the whole thing: the
// item is never detached, so it lands right back where the player found it — loose, unequipped, in the
// kiosk. This is the "on-chain abort" half of the stalled fork; the "silent non-submission" half is RULED
// OUT by equip_ptb (packages/sdk/src/sui/write/items_extract.js) composing the identical two-call sequence
// for every equippable category, pets included — there is no category branch that skips a pet leg.
#[test, expected_failure(abort_code = 101, location = item_stats)]
fun legacy_overscaled_pet_power_aborts_equip_one_past_the_bound() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, _food_t) = stage(&mut sc);
  let pet_id = mint_lock_shop_pet(&mut sc, pet_t);
  force_legacy_power(&mut sc, pet_id, 61); // one past PET_FULL_FEEDS(60) — the exact boundary #88 crosses
  equip_locked_pet(&mut sc, cid, pet_id, pet_t);
  abort
}

#[test, expected_failure(abort_code = 101, location = item_stats)]
fun legacy_overscaled_pet_power_aborts_equip_realistic_magnitude() {
  let mut sc = ts::begin(OWNER);
  let (cid, pet_t, _food_t) = stage(&mut sc);
  let pet_id = mint_lock_shop_pet(&mut sc, pet_t);
  // A realistic OLD arbitrary-power magnitude (not just the tightest boundary) — same abort, same module.
  force_legacy_power(&mut sc, pet_id, 70);
  equip_locked_pet(&mut sc, cid, pet_id, pet_t);
  abort
}
