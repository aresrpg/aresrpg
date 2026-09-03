// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Address-wide daily dungeon progression. One soulbound Mastery is derived per sender; an
/// owned Character proves access when the quest starts, while any owned winner may complete it.
/// Offers mint ordinary statless templates into the personal kiosk. Loot boxes retain their
/// existing open/claim randomness; direct consumables remain direct rewards.
module aresrpg::mastery;

use aresrpg::{
  character::Character,
  fight::{Self, Fight},
  friends::{Self, FriendRegistry},
  item::{Self, Item},
};
use aresrpg_control::admin::AdminCap;
use aresrpg_math::{city_map, dungeon_data, world_map};
use aresrpg_seed::{
  dungeon_content::{Self, DungeonContent},
  item_rows::{Self, ItemTemplate},
  registry::{Self, Registry},
  world_content::{Self, WorldContent},
};
use std::string::String;
use sui::{
  clock::Clock,
  derived_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

const EMasteryExists: u64 = 3101;
const ENotOwner: u64 = 3102;
const EQuestAlreadyStarted: u64 = 3103;
const ENoDungeon: u64 = 3104;
const ELevelTooLow: u64 = 3105;
const EWrongTemplate: u64 = 3106;
const EOfferDisabled: u64 = 3107;
const EInsufficientPoints: u64 = 3108;
const EInvalidCost: u64 = 3109;
const EOfferNeedsPlainTemplate: u64 = 3110;

const MAX_LEVEL: u16 = 200;

public struct MasteryKey(address) has copy, drop, store;
public struct MasteryOfferKey(String) has copy, drop, store;

public struct Mastery has key {
  id: UID,
  owner: address,
  points: u64,
  last_completed_epoch: Option<u64>,
  quest_epoch: u64,
  quest_started_ms: u64,
  quest_world: String,
  quest_dungeon: ID,
  quest_reward: u8,
  quest_completed: bool,
}

public struct MasteryOffer has key {
  id: UID,
  item_type: String,
  template: ID,
  cost: u64,
  enabled: bool,
}

/// One full receipt projection for every player write. Consumers fold this one shape regardless
/// of whether assignment, completion, or redemption caused it.
public struct MasteryUpdated has copy, drop {
  mastery: ID,
  owner: address,
  points: u64,
  last_completed_epoch: Option<u64>,
  quest_epoch: u64,
  quest_started_ms: u64,
  quest_world: String,
  quest_dungeon: ID,
  quest_reward: u8,
  quest_completed: bool,
}

/// A mastery offer is living supply content. Its stable identity is the statless item type;
/// disabling retires it without deleting a callable object or changing supply history.
public fun new_offer(
  cap: &AdminCap,
  root: &mut Registry,
  template: &ItemTemplate,
  cost: u64,
  enabled: bool,
  ctx: &TxContext,
) {
  assert!(cost > 0, EInvalidCost);
  assert!(!item_rows::has_stats(template), EOfferNeedsPlainTemplate);
  let item_type = item_rows::template_type(template);
  transfer::share_object(MasteryOffer {
    id: derived_object::claim(registry::uid_mut(cap, root, ctx), MasteryOfferKey(item_type)),
    item_type,
    template: item_rows::template_id(template),
    cost,
    enabled,
  });
  registry::bump(cap, root, b"mastery_offers".to_string(), item_rows::template_type(template), ctx);
}

public fun set_offer(
  cap: &AdminCap,
  root: &mut Registry,
  offer: &mut MasteryOffer,
  cost: u64,
  enabled: bool,
  ctx: &TxContext,
) {
  assert!(cost > 0, EInvalidCost);
  offer.cost = cost;
  offer.enabled = enabled;
  registry::bump(cap, root, b"mastery_offers".to_string(), offer.item_type, ctx);
}

public(package) fun start_first(
  registry: &mut FriendRegistry,
  world: &WorldContent,
  character: &Character,
  generator: &mut RandomGenerator,
  clock: &Clock,
  ctx: &TxContext,
) {
  let owner = ctx.sender();
  assert!(!derived_object::exists(friends::uid(registry), MasteryKey(owner)), EMasteryExists);
  let mut mastery = Mastery {
    id: derived_object::claim(friends::uid_mut(registry), MasteryKey(owner)),
    owner,
    points: 0,
    last_completed_epoch: option::none(),
    quest_epoch: 0,
    quest_started_ms: 0,
    quest_world: b"".to_string(),
    quest_dungeon: @0x0.to_id(),
    quest_reward: 0,
    quest_completed: false,
  };
  assign(&mut mastery, world, character, generator, clock, ctx);
  transfer::transfer(mastery, owner);
}

public(package) fun start(
  mastery: &mut Mastery,
  world: &WorldContent,
  character: &Character,
  generator: &mut RandomGenerator,
  clock: &Clock,
  ctx: &TxContext,
) {
  assert_owner(mastery, ctx);
  assign(mastery, world, character, generator, clock, ctx);
}

fun assign(
  mastery: &mut Mastery,
  world: &WorldContent,
  character: &Character,
  generator: &mut RandomGenerator,
  clock: &Clock,
  ctx: &TxContext,
) {
  let epoch = ctx.epoch();
  assert!(mastery.quest_epoch != epoch, EQuestAlreadyStarted);
  let entry_level = world_content::entry_level(world);
  assert!(character.level() >= entry_level, ELevelTooLow);
  let cities = world_map::cities(world_content::data(world));
  assert!(!cities.is_empty(), ENoDungeon);
  normalize_points(mastery, epoch);
  let city = &cities[generator.generate_u64_in_range(0, cities.length() - 1)];
  mastery.quest_epoch = epoch;
  mastery.quest_started_ms = clock.timestamp_ms();
  mastery.quest_world = world_content::name(world);
  mastery.quest_dungeon = city_map::dungeon(city);
  mastery.quest_reward = reward(entry_level);
  mastery.quest_completed = false;
  emit_update(mastery);
}

/// Try to validate the current quest against an ended final-room fight. Eligibility races are
/// data, not settlement failures: a stale epoch or mismatched quest simply returns false. Forged
/// ownership still aborts through both the Mastery owner and Fight authority checks.
public(package) fun complete_if_eligible(
  mastery: &mut Mastery,
  fight_object: &Fight,
  fighter_idx: u64,
  dungeon: &DungeonContent,
  ctx: &TxContext,
): bool {
  assert_owner(mastery, ctx);
  let character = fight::fighter_character(fight_object, fighter_idx);
  fight::assert_controlled_character(fight_object, fighter_idx, character, ctx);
  let tag = fight::dungeon_tag(fight_object);
  if (
    mastery.quest_completed ||
    mastery.quest_epoch != ctx.epoch() ||
    !completion_started_after_assignment(
      mastery.quest_started_ms,
      &mastery.quest_world,
      fight::placement_started_ms(fight_object),
      &fight::fight_world(fight_object),
    ) ||
    !fight::fighter_won(fight_object, fighter_idx) ||
    tag.is_none()
  ) return false;
  let tag = tag.borrow();
  if (
    mastery.quest_dungeon != object::id(dungeon) ||
    fight::dungeon_name(tag) != dungeon_content::name(dungeon) ||
    fight::dungeon_room(tag) != dungeon_data::room_count(dungeon_content::data(dungeon))
  ) return false;
  let epoch = ctx.epoch();
  let consecutive = mastery.last_completed_epoch.is_some() && *mastery.last_completed_epoch.borrow() + 1 == epoch;
  mastery.points = if (consecutive) mastery.points + (mastery.quest_reward as u64)
    else mastery.quest_reward as u64;
  mastery.last_completed_epoch = option::some(epoch);
  mastery.quest_completed = true;
  emit_update(mastery);
  true
}

public(package) fun redeem(
  mastery: &mut Mastery,
  offer: &MasteryOffer,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  assert_owner(mastery, ctx);
  assert!(offer.enabled, EOfferDisabled);
  assert!(object::id(template) == offer.template, EWrongTemplate);
  normalize_points(mastery, ctx.epoch());
  assert!(mastery.points >= offer.cost, EInsufficientPoints);
  mastery.points = mastery.points - offer.cost;
  item::deposit(kiosk, cap, policy, existing, item::mint_plain(template, 1, ctx));
  emit_update(mastery);
}

fun normalize_points(mastery: &mut Mastery, epoch: u64) {
  if (mastery.last_completed_epoch.is_some() && epoch > *mastery.last_completed_epoch.borrow() + 1)
    mastery.points = 0;
}

fun reward(entry_level: u16): u8 {
  if (entry_level >= MAX_LEVEL) 5 else (1 + ((entry_level - 1) / 50)) as u8
}

fun assert_owner(mastery: &Mastery, ctx: &TxContext) {
  assert!(mastery.owner == ctx.sender(), ENotOwner);
}

fun completion_started_after_assignment(
  quest_started_ms: u64,
  quest_world: &String,
  fight_started_ms: u64,
  fight_world: &String,
): bool {
  fight_started_ms > quest_started_ms && fight_world == quest_world
}

fun emit_update(mastery: &Mastery) {
  event::emit(MasteryUpdated {
    mastery: mastery.id.to_inner(),
    owner: mastery.owner,
    points: mastery.points,
    last_completed_epoch: mastery.last_completed_epoch,
    quest_epoch: mastery.quest_epoch,
    quest_started_ms: mastery.quest_started_ms,
    quest_world: mastery.quest_world,
    quest_dungeon: mastery.quest_dungeon,
    quest_reward: mastery.quest_reward,
    quest_completed: mastery.quest_completed,
  });
}

#[test_only]
public fun reward_for_testing(entry_level: u16): u8 { reward(entry_level) }

#[test_only]
public fun completion_scope_for_testing(
  quest_started_ms: u64,
  quest_world: String,
  fight_started_ms: u64,
  fight_world: String,
): bool {
  completion_started_after_assignment(quest_started_ms, &quest_world, fight_started_ms, &fight_world)
}
