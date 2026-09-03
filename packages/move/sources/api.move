// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The game's public composition surface (legacy api.move pattern — born the day a door
/// composed two modules). Single-module doors stay public in their own homes; doors that
/// CROSS modules live here. Character authority follows custody: ordinary doors borrow from
/// the personal kiosk, while explicit Fight variants prove the controlled custody seat.
module aresrpg::api;

use aresrpg_seed::{item_rows::{Self, ItemTemplate}, recipe_rows::Recipe};
use aresrpg::{
  character::{Self, Character, NameRegistry},
  consumable,
  crafting,
  distribution::{Self, Airdrop, Giftcard},
  dungeon,
  equipment,
  fight::{Self, Fight, FightBuild},
  forgemagie::{Self, CrushClaim},
  friends::{Self, FriendList, FriendRegistry},
  gathering,
  kolizeum::{Self, Kolizeum},
  item::{Self, Item, PM},
  loot_box::{Self, LootRegistry, BoxClaim},
  mastery::{Self, Mastery, MasteryOffer},
  naked_rule,
  party::{Self, Party},
  trade::{Self, Trade},
  pet,
  progression,
  protected_policy::AresRPG_TransferPolicy,
  version::Version,
  world::{Self, World},
  zone,
};
use aresrpg_seed::{
  dungeon_content::DungeonContent,
  mob_rows::MobTemplate,
  spell_rows::SpellTemplate,
  board_catalog::BoardCatalog,
  world_content::WorldContent,
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::{
  clock::Clock,
  coin::Coin,
  kiosk::{Kiosk, KioskOwnerCap, PurchaseCap},
  random::Random,
  sui::SUI,
  transfer::Receiving,
  transfer_policy::{TransferPolicy, TransferRequest},
};

const EDeleteWhileEquipped: u64 = 1101; // delete_character: unequip everything first
const EDeleteWhileAmbushed: u64 = 1102; // delete_character: face the protector first
const EDeleteWhileInDungeon: u64 = 1104; // delete_character: finish or abandon the run first

fun personal_cap(personal: &PersonalKioskCap, version: &Version): &KioskOwnerCap {
  version.assert_latest();
  personal_kiosk::borrow(personal)
}

public fun split_stack(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  item_id: ID,
  amount: u32,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  version.assert_latest();
  let source: &mut Item = kiosk.borrow_mut<Item>(cap, item_id);
  let lot = source.split(amount, ctx);
  let lot_id = object::id(&lot);
  kiosk.lock(cap, policy, lot);
  lot_id
}

public fun merge_stacks(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected: &AresRPG_TransferPolicy<Item>,
  target_id: ID,
  source_id: ID,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let source = protected.extract_from_kiosk(kiosk, cap, source_id, ctx);
  let target: &mut Item = kiosk.borrow_mut<Item>(cap, target_id);
  target.merge(source);
}

/// Mint a character for exactly 1 SUI, join it to the first world, and LOCK it into the
/// sender's personal kiosk — one act. A character is never world-less and never wallet-loose:
/// it is born inside the market constitution (personal-kiosk, royalty, lock rules).
public fun create_character(
  registry: &mut NameRegistry,
  payment: Coin<SUI>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  raw_name: String,
  classe: String,
  male: bool,
  color_1: u32,
  color_2: u32,
  color_3: u32,
  first_world: &WorldContent,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  world::assert_start_world(first_world);
  let mut character = character::create_character(
    registry,
    payment,
    raw_name,
    classe,
    male,
    color_1,
    color_2,
    color_3,
    ctx,
  );
  world::join_world(&mut character, first_world, clock);
  character::assert_personal_custody(kiosk); // soulbound custody — a personal kiosk only
  kiosk.lock(cap, policy, character);
}

/// The star gate: walk to your current world's portal (the travel proof), materialize at the
/// destination's. The character stays kiosk-locked throughout — borrowed, never moved.
public fun join_world(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  destination: &WorldContent,
  version: &Version,
  clock: &Clock,
) {
  version.assert_latest();
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  world::join_world(character, destination, clock);
}

/// Discover (or refresh after the TTL) the zone at the character's claimed position — the
/// walk is proven, then fresh entropy draws what lives there. ENTRY: `&Random` law.
entry fun search_zone(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  world_object: &mut World,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  zone::search(character, x, z, world_object, &mut generator, clock);
}

/// Spend exact available capital through the character class's characteristic ladder.
public fun raise_stat(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  stat: String,
  points: u16,
  version: &Version,
) {
  version.assert_latest();
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  character::raise_stat(character, stat, points);
}

/// Raise a spell one level (n → n+1 costs n points; 1 point granted per level from 2).
public fun raise_spell(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  spell: &SpellTemplate,
  version: &Version,
) {
  version.assert_latest();
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  progression::raise_spell(character, spell);
}

/// Equip: the item leaves the kiosk through the protected policy (royalty-safe by
/// construction) and is SENT to the character's own address — the character owns its gear.
public fun equip_item(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  slot: String,
  item_id: ID,
  protected: &AresRPG_TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let item = protected.extract_from_kiosk(kiosk, cap, item_id, ctx);
  // A PET folds its POWER-scaled stats (not the raw roll). The ×1.5 travel boost is NOT set
  // here — it derives live in `prove_move` (both-end rule), so no flag can go stale.
  let is_pet = item.category() == b"pet".to_string();
  let pet_stats = if (is_pet) option::some(pet::scaled_stats(&item)) else option::none();
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  equipment::equip(character, slot, item);
  if (is_pet) equipment::set_slot_stats(character, slot, pet_stats.destroy_some());
}

/// Unequip: RECEIVE the item back off the character, re-lock it in the kiosk under the real
/// marketplace rules.
public fun unequip_item(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  slot: String,
  receiving: Receiving<Item>,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
) {
  version.assert_latest();
  let item = {
    let character: &mut Character = kiosk.borrow_mut(cap, character_id);
    equipment::unequip(character, slot, receiving)
  };
  kiosk.lock(cap, item_policy, item);
}

/// Feed a pet in the kiosk — one resource from its authored diet per UTC day, 60 feeds to max. An equipped
/// pet feeds by a frontend PTB: unequip_item → feed_kiosk_pet → equip_item.
public fun feed_kiosk_pet(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  pet_template: &ItemTemplate,
  pet_id: ID,
  food_id: ID,
  protected_item: &AresRPG_TransferPolicy<Item>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  pet::feed_kiosk_pet(kiosk, cap, pet_template, protected_item, pet_id, food_id, clock, ctx);
}

/// Delete a character: out of the kiosk through the protected policy, guarded (nothing may
/// be equipped — a sent item would be orphaned player value; no FIRED protector verdict —
/// death was the last dodge, audit 2026-08-10), then destroyed. Its derived name stays reserved.
public fun delete_character(
  registry: &FriendRegistry,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  party::assert_membership_available(registry, character_id);
  let character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  assert!(!equipment::has_any_equipped(&character), EDeleteWhileEquipped);
  assert!(!gathering::has_fired_verdict(&character), EDeleteWhileAmbushed);
  assert!(!dungeon::has_run(&character), EDeleteWhileInDungeon);
  character::destroy(character);
}

// ╔════════════════ [ Fights ] ═══════════════════════════════════════════════ ]

/// Walk to a live mob group and claim it — the character leaves the kiosk into fight
/// custody. Returns the build potato: `add_fight_mob` per member (exact order), then
/// `launch_fight` — one transaction.
public fun engage_fight(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  world_object: &mut World,
  world_content: &WorldContent,
  zone_x: u32,
  zone_z: u32,
  group_index: u64,
  access: u8, // 0 public — anyone joins your side · 1 group-only
  protected: &AresRPG_TransferPolicy<Character>,
  catalog: &BoardCatalog,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  version.assert_latest();
  fight::engage(
    protected, kiosk, cap, character_id, world_object, world_content, zone_x, zone_z,
    group_index, access, catalog, clock, ctx,
  )
}

public fun add_fight_mob(build: FightBuild, template: &MobTemplate): FightBuild {
  fight::add_mob(build, template)
}

public fun launch_fight(build: FightBuild, clock: &Clock, ctx: &mut TxContext) {
  fight::launch(build, clock, ctx)
}

/// Challenge a DUEL at your proven spot — side B is RESERVED for `target`, so the challenge
/// itself is the invitation and no bystander can take that seat. ENTRY: `&Random` law (the
/// board rolls fresh). Duels never touch persistent hp, xp, or loot.
entry fun challenge_duel(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  target: ID,
  x: u32,
  z: u32,
  access: u8, // 0 public · 1 group-only
  protected: &AresRPG_TransferPolicy<Character>,
  catalog: &BoardCatalog,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  fight::challenge(
    protected, kiosk, cap, character_id, target, x, z, access, catalog, &mut generator, clock, ctx,
  );
}

/// Join EITHER side of a fight during placement (walk proven, kiosk exit, custody). Any
/// side without mobs is a player side; its opener's access setting rules — opening an empty
/// side makes YOUR setting its rule.
public fun join_fight(
  fight_object: &mut Fight,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  access: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  fight::assert_join_door_open(fight_object);
  fight::join(fight_object, protected, kiosk, cap, character_id, team, access, true, clock, ctx);
}

/// Join a GROUP-gated side — the presented party must hold both you and the side's opener.
public fun join_fight_grouped(
  fight_object: &mut Fight,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  shared_party: &Party,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  fight::assert_join_door_open(fight_object);
  fight::join_grouped(
    fight_object, protected, kiosk, cap, character_id, team, shared_party, true, clock, ctx,
  );
}

/// Pick another of your side's start cells during placement.
public fun place_fighter(
  fight_object: &mut Fight,
  fighter_idx: u64,
  cell: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::place(fight_object, fighter_idx, cell, ctx);
}

/// Non-final Ready used before the one terminal Random-consuming Ready in a batched PTB.
public fun ready_fight(
  fight_object: &mut Fight,
  fighter_idx: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::assert_start_door_open(fight_object);
  fight::ready_non_final(fight_object, fighter_idx, ctx);
}

/// Ready this seat and atomically start an ordinary/dungeon fight when it was the final
/// missing player. The decision reads current shared truth, so concurrent ready transactions
/// cannot both stop on the stale belief that somebody else remains unready.
entry fun ready_and_start_fight(
  fight_object: &mut Fight,
  fighter_idx: u64,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  fight::assert_start_door_open(fight_object);
  if (fight::ready(fight_object, fighter_idx, ctx)) {
    let mut generator = randomness.new_generator(ctx);
    fight::start(fight_object, &mut generator, clock);
  };
}

/// All ready — or anyone once the 60s window closes. Plants the crank entropy. ENTRY:
/// `&Random` law.
entry fun start_fight(
  fight_object: &mut Fight,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  fight::assert_start_door_open(fight_object);
  let mut generator = randomness.new_generator(ctx);
  fight::start(fight_object, &mut generator, clock);
}

/// Cast a learned class spell at a cell — your turn only, previewable off the turn seed.
public fun cast_spell(
  fight_object: &mut Fight,
  fighter_idx: u64,
  spell: &SpellTemplate,
  target_cell: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::cast(fight_object, fighter_idx, spell, target_cell, ctx);
}

/// Swing the weapon — the strike is a spell assembled at seating.
public fun weapon_strike(
  fight_object: &mut Fight,
  fighter_idx: u64,
  target_cell: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::strike(fight_object, fighter_idx, target_cell, ctx);
}

/// Walk the acting fighter along the caller's exact orthogonal path — tackle tolls apply along
/// the way. Hidden displacement may stop the remaining route; the chain never chooses another.
public fun move_fighter(fight_object: &mut Fight, path: vector<u64>, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::move_fighter(fight_object, &path, ctx);
}

entry fun end_fight_turn(
  fight_object: &mut Fight,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  // terminal &Random: the mob wave draws its entropy HERE, so it can't be composed + inspected +
  // aborted for a free re-roll, and no future turn is previewable from a stored stream.
  let mut generator = randomness.new_generator(ctx);
  fight::end_turn(fight_object, &mut generator, clock, ctx);
}

/// Anyone clears a stall: a 45s-dead player turn force-passes (its mob wave resolves too),
/// a forfeited actor's turn advances free. Mob turns resolve on the pass — never here.
entry fun crank_fight(
  fight_object: &mut Fight,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let mut generator = randomness.new_generator(ctx);
  fight::crank(fight_object, &mut generator, clock);
}

/// Leave as a loss — legal from placement on; the fighter reads as killed, hp lands at 1.
public fun forfeit_fight(
  fight_object: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::assert_forfeit_door_open(fight_object);
  fight::forfeit(fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Walk out of an ended fight: hp writes back, winners take xp and roll their drops off
/// FRESH entropy (the loot draw is value-bearing — the RANDOMNESS LAW). ENTRY: `&Random`.
public fun prepare_fight_loot(template: &ItemTemplate, existing: Option<ID>): PM {
  item::prepare_plan(template, existing)
}

/// Start the sender's first address-wide daily quest and bind its derived Mastery object.
entry fun start_first_daily_quest(
  registry: &mut FriendRegistry,
  world_content: &WorldContent,
  kiosk: &Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  mastery::start_first(
    registry, world_content, kiosk.borrow<Character>(cap, character_id), &mut generator, clock, ctx,
  );
}

/// Replace an older quest with one random city dungeon from the chosen accessible world.
entry fun start_daily_quest(
  mastery_object: &mut Mastery,
  world_content: &WorldContent,
  kiosk: &Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  mastery::start(
    mastery_object, world_content, kiosk.borrow<Character>(cap, character_id), &mut generator, clock, ctx,
  );
}

/// Optional pre-settlement composition: false eligibility never blocks the terminal settle.
public fun complete_daily_quest_if_eligible(
  mastery_object: &mut Mastery,
  fight_object: &Fight,
  fighter_idx: u64,
  dungeon_content: &DungeonContent,
  version: &Version,
  ctx: &TxContext,
): bool {
  version.assert_latest();
  mastery::complete_if_eligible(mastery_object, fight_object, fighter_idx, dungeon_content, ctx)
}

/// Exchange points for one statless seeded item in the sender's personal kiosk.
public fun redeem_mastery_offer(
  mastery_object: &mut Mastery,
  offer: &MasteryOffer,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  mastery::redeem(mastery_object, offer, template, existing, kiosk, cap, item_policy, ctx);
}

fun settle_fight_batch(
  fight_object: &mut Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  fight::assert_settle_door_open(fight_object);
  let mut generator = randomness.new_generator(ctx);
  fight::settle_many(
    fight_object, fighter_indices, plan_lengths, plan, kiosk, cap, policy, item_policy,
    &mut generator, clock, ctx,
  );
}

/// Settle one or more supplied same-kiosk fighters in one invisible reward transaction.
entry fun settle_fight(
  fight_object: &mut Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  settle_fight_batch(
    fight_object, fighter_indices, plan_lengths, plan, kiosk, personal, policy, item_policy,
    randomness, version, clock, ctx,
  );
}

/// Final same-kiosk batch: settle every supplied character and reclaim the fight in one transaction.
entry fun settle_last_fight(
  fight_object: Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut fight_object = fight_object;
  fight::assert_last_settlers(&fight_object, &fighter_indices, ctx);
  settle_fight_batch(
    &mut fight_object, fighter_indices, plan_lengths, plan, kiosk, personal, policy, item_policy,
    randomness, version, clock, ctx,
  );
  fight::close(fight_object, ctx);
}

/// Reclaim a spent fight's storage deposit — any of its players, once every seat settled.
/// The rebate lands on the closer's gas coin; a lost race against another closer costs only
/// the transaction floor.
entry fun close_fight(fight_object: Fight, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::assert_close_door_open(&fight_object);
  fight::close(fight_object, ctx);
}

// ╔════════════════ [ Party ] ════════════════════════════════════════════════ ]
// Every door hands a custody-proven character id to Party. Kiosk variants borrow through the
// owner's cap; Fight variants validate sender + seat + expected character id.

fun kiosk_actor(kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID): ID {
  character::id(kiosk.borrow<Character>(cap, character_id))
}

/// The first invitation creates the shared party and its pending target in one transaction.
/// Acceptance remains the same custody-proven door used by every later invitation.
public fun create_party_invitation(
  registry: &mut FriendRegistry,
  kiosk: &Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  invited_character: ID,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  party::create_inviting(registry, kiosk_actor(kiosk, cap, character_id), invited_character, ctx);
}

public fun party_invitation(
  registry: &FriendRegistry,
  party_object: &mut Party,
  kiosk: &Kiosk,
  cap: &KioskOwnerCap,
  actor_id: ID,
  invited_character: ID,
  present: bool,
  version: &Version,
) {
  version.assert_latest();
  party::update_invitation(
    registry, party_object, kiosk_actor(kiosk, cap, actor_id), invited_character, present,
  );
}

public fun party_invitation_from_fight(
  registry: &FriendRegistry,
  party_object: &mut Party,
  fight_object: &Fight,
  fighter_idx: u64,
  actor_id: ID,
  invited_character: ID,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::assert_controlled_character(fight_object, fighter_idx, actor_id, ctx);
  party::update_invitation(registry, party_object, actor_id, invited_character, true);
}

public fun party_accept(registry: &mut FriendRegistry, party_object: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version) {
  version.assert_latest();
  party::accept(registry, party_object, kiosk_actor(kiosk, cap, character_id));
}

public fun party_leave(registry: &mut FriendRegistry, party_object: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version) {
  version.assert_latest();
  party::leave(registry, party_object, kiosk_actor(kiosk, cap, character_id));
}

public fun party_kick(registry: &mut FriendRegistry, party_object: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, target_character: ID, version: &Version) {
  version.assert_latest();
  party::kick(registry, party_object, kiosk_actor(kiosk, cap, leader_id), target_character);
}

public fun party_disband(registry: &mut FriendRegistry, party_object: Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, version: &Version) {
  version.assert_latest();
  party::disband(registry, party_object, kiosk_actor(kiosk, cap, leader_id));
}

/// Use one unit of a consumable on your character — heal, reset stat/spell points, or recall
/// to the world portal. No randomness. Out-of-fight only (custody makes mid-fight impossible).
public fun use_consumable(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  protected_item: &AresRPG_TransferPolicy<Item>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  consumable::consume(kiosk, cap, protected_item, character_id, item_id, template, clock, ctx);
}

/// Use a city-specific potion inside the character's current world. The item's effect owns the
/// city slug; the caller supplies no destination or coordinates.
public fun use_city_consumable(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  world_content: &WorldContent,
  protected_item: &AresRPG_TransferPolicy<Item>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  consumable::consume_city(
    kiosk, cap, protected_item, character_id, item_id, template, world_content, clock, ctx,
  );
}

// ╔════════════════ [ Gathering ] ════════════════════════════════════════════ ]

/// Harvest ONE node off a resource pack: walk proven, tool + tier gated, yield rolled off
/// the job level, node consumed, the stack locked into the kiosk — then the golden-gather
/// draw and the GAS-UNIFORM protector verdict (a fired verdict roots you until
/// `resolve_ambush`). ENTRY: `&Random` law. Pass the base template again as `rare_template`
/// when the row has no link.
entry fun gather(
  world_object: &mut World,
  world_content: &WorldContent,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  zone_x: u32,
  zone_z: u32,
  pack_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  existing: Option<ID>,
  existing_rare: Option<ID>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  gathering::gather(
    world_object,
    world_content,
    kiosk,
    cap,
    character_id,
    zone_x,
    zone_z,
    pack_index,
    template,
    rare_template,
    existing,
    existing_rare,
    item_policy,
    &mut generator,
    clock,
    ctx,
  );
}

/// Face the pending protector — the ONLY exit from a fired verdict's root. No randomness:
/// everything was drawn at the gather, so aborting this re-rolls nothing.
public fun resolve_ambush(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protector_template: &MobTemplate,
  catalog: &BoardCatalog,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  gathering::resolve_ambush(
    protected,
    kiosk,
    cap,
    character_id,
    protector_template,
    catalog,
    clock,
    ctx,
  );
}

// ╔════════════════ [ Crafting ] ═════════════════════════════════════════════ ]

/// Craft a bounded batch: aggregate inputs burn once, each attempt rolls against the job
/// level reached by its preceding XP, and successes mint with the fewest legal objects.
/// ENTRY: `&Random` law.
entry fun craft(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  existing: Option<ID>,
  attempts: u16,
  protected_item: &AresRPG_TransferPolicy<Item>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  crafting::craft(
    recipe,
    kiosk,
    cap,
    character_id,
    input_item_ids,
    output_template,
    existing,
    attempts,
    protected_item,
    item_policy,
    &mut generator,
    ctx,
  );
}

// ╔════════════════ [ Forgemagie — scribe + staged crush ] ═══════════════════ ]

/// Apply one rune to a kiosk-held gear item (consumes 1 rune unit; the gear's category names
/// the forgery job that must be ≥ 70). Terminal `&Random`.
entry fun scribe_rune(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  gear_id: ID,
  gear_template: &ItemTemplate,
  rune_item_id: ID,
  protected_item: &AresRPG_TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  forgemagie::scribe(
    kiosk,
    cap,
    character_id,
    gear_id,
    gear_template,
    rune_item_id,
    protected_item,
    &mut generator,
    ctx,
  );
}

/// Open the staged crush with the rune-template ids the closing PTB supplies positionally.
/// Phase 1 — burn gear and ROLL the runes into a soulbound claim (terminal `&Random`, so the roll
/// can't be composed + inspected + aborted for a free re-roll).
entry fun crush_gear(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  gear_ids: vector<ID>,
  protected_item: &AresRPG_TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  forgemagie::crush(kiosk, cap, gear_ids, protected_item, &mut generator, ctx);
}

/// Phase 2 — redeem ONE owed rune type off its real template (no randomness). Called once per
/// yielded rune type in the redeem PTB, then `discard_crush_claim` consumes the emptied claim.
public fun redeem_rune(
  claim: &mut CrushClaim,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  forgemagie::redeem_rune(claim, template, existing, kiosk, cap, item_policy, ctx);
}

/// Consume an emptied crush claim (aborts if any owed rune is still unredeemed).
public fun discard_crush_claim(claim: CrushClaim, version: &Version) {
  version.assert_latest();
  forgemagie::discard_claim(claim);
}

/// Open a gacha box — burn one unit, roll, receive a soulbound claim. Terminal `&Random`.
entry fun open_loot_box(
  registry: &LootRegistry,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  box_item_id: ID,
  box_template: &ItemTemplate,
  protected_item: &AresRPG_TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  loot_box::open_box(
    registry, kiosk, cap, box_item_id, box_template, protected_item, &mut generator, ctx,
  );
}

/// Claim the rolled quantity from a box claim (any category; gear stats roll here). Terminal
/// `&Random`. `existing` merges a stackable result into your held stack (no dust).
entry fun claim_loot(
  claim: BoxClaim,
  rolled_template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  loot_box::claim_loot(
    claim, rolled_template, existing, kiosk, cap, item_policy, &mut generator, ctx,
  );
}

/// Delete (burn) `amount` units of an item you own — a whole stack or part of one; the remainder
/// (if any) stays kiosk-locked. Free disposal of unwanted gear / resources.
public fun burn_item(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  protected_item: &AresRPG_TransferPolicy<Item>,
  item_id: ID,
  amount: u32,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  item::burn(kiosk, cap, protected_item, item_id, amount, ctx);
}

// ╔════════════════ [ Airdrops / giftcards (portable distribution) ] ════════ ]

/// Claim your airdrop share as a voucher sent to the chosen game-wallet address.
public fun claim_airdrop(
  drop: &mut Airdrop,
  template: &ItemTemplate,
  recipient: address,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  distribution::claim_airdrop(drop, template, recipient, ctx);
}

/// Redeem a giftcard voucher (zksend-portable): it burns, the item is born in YOUR kiosk.
public fun redeem_giftcard(
  card: Giftcard,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  distribution::redeem_giftcard(card, template, existing, kiosk, cap, item_policy, ctx);
}

// ╔════════════════ [ Dungeons ] ═════════════════════════════════════════════ ]

/// Consume the world's dungeon key at a live portal — begin a run (staged at room 1, rooted).
entry fun enter_dungeon(
  world_object: &World,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  world_content: &WorldContent,
  dungeon_content: &DungeonContent,
  key_id: ID,
  protected_item: &AresRPG_TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  // the run's board seed is drawn HERE from Sui randomness (terminal) — the room boards derive
  // from it, so no caller can enumerate a favorable dungeon layout.
  let mut generator = randomness.new_generator(ctx);
  dungeon::enter(
    world_object, world_content, dungeon_content, protected_item, kiosk, cap, character_id,
    key_id, generator.generate_u64(), clock, ctx,
  );
}

/// Birth the run's current room fight — returns the build potato: `add_fight_mob` × the
/// room's mobs (exact order), then `launch_fight`.
public fun engage_dungeon_room(
  world_object: &World,
  world_content: &WorldContent,
  dungeon_content: &DungeonContent,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  access: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  catalog: &BoardCatalog,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  version.assert_latest();
  dungeon::engage_room(
    world_object, world_content, dungeon_content, protected, kiosk, cap, character_id, access,
    catalog, clock, ctx,
  )
}

/// Join a PUBLIC dungeon room fight — your run must be at the fight's room.
public fun join_dungeon_room(
  fight_object: &mut Fight,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  dungeon::join_room(fight_object, protected, kiosk, cap, character_id, clock, ctx);
}

/// Join a GROUP-locked dungeon room — the opener's party gates it.
public fun join_dungeon_room_grouped(
  fight_object: &mut Fight,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  shared_party: &Party,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  dungeon::join_room_grouped(
    fight_object, protected, kiosk, cap, character_id, shared_party, clock, ctx,
  );
}

fun settle_dungeon_batch(
  dungeon_content: &DungeonContent,
  fight_object: &mut Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  dungeon::settle_many_rooms(
    dungeon_content, fight_object, fighter_indices, plan_lengths, plan, kiosk, cap, policy,
    item_policy, &mut generator, clock, ctx,
  );
}

/// One or more same-kiosk dungeon participants advance and collect through one Random boundary.
entry fun settle_dungeon_room(
  dungeon_content: &DungeonContent,
  fight_object: &mut Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  settle_dungeon_batch(
    dungeon_content, fight_object, fighter_indices, plan_lengths, plan, kiosk, personal, policy,
    item_policy, randomness, version, clock, ctx,
  );
}

/// Final same-kiosk dungeon batch: run progression, loot settlement, and Fight deletion are atomic.
entry fun settle_last_dungeon_room(
  dungeon_content: &DungeonContent,
  fight_object: Fight,
  fighter_indices: vector<u64>,
  plan_lengths: vector<u64>,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut fight_object = fight_object;
  fight::assert_last_settlers(&fight_object, &fighter_indices, ctx);
  settle_dungeon_batch(
    dungeon_content, &mut fight_object, fighter_indices, plan_lengths, plan, kiosk, personal, policy,
    item_policy, randomness, version, clock, ctx,
  );
  fight::close(fight_object, ctx);
}

/// Give up the current room mid-fight — forfeit and end the run (the key is already gone).
public fun give_up_dungeon_room(
  fight_object: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_latest();
  dungeon::give_up_room(fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Abandon a run while staging (entered, no live room fight).
public fun abandon_dungeon_run(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  version: &Version,
  clock: &Clock,
) {
  version.assert_latest();
  dungeon::abandon_run(kiosk, cap, character_id, clock);
}

// ╔════════════════ [ Kolizeum — wagered arena duels ] ═══════════════════════ ]

/// Open a PUBLIC wagered arena (the board rolls from fresh entropy). ENTRY: `&Random` law.
entry fun create_kolizeum(
  pledge: Coin<SUI>,
  format: u64,
  level_min: u16,
  level_max: u16,
  access: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  catalog: &BoardCatalog,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  kolizeum::create(
    pledge, format, level_min, level_max, access, option::none(), protected, kiosk, cap,
    character_id, generator.generate_u64(), catalog, clock, ctx,
  );
}

/// Open a FRIENDS-ONLY wagered arena — only the creator's whitelist may join. ENTRY: `&Random`.
entry fun create_kolizeum_friends(
  pledge: Coin<SUI>,
  format: u64,
  level_min: u16,
  level_max: u16,
  access: u8,
  list: &FriendList,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  catalog: &BoardCatalog,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_cap(personal, version);
  let mut generator = randomness.new_generator(ctx);
  let allowed = option::some(friends::snapshot(list));
  kolizeum::create(
    pledge, format, level_min, level_max, access, allowed, protected, kiosk, cap,
    character_id, generator.generate_u64(), catalog, clock, ctx,
  );
}

/// Stake the matching pledge and seat on a side (format-capped, level-gated, whitelist-gated).
public fun join_kolizeum(
  lobby: &mut Kolizeum,
  fight_object: &mut Fight,
  pledge: Coin<SUI>,
  side: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  kolizeum::join(
    lobby, fight_object, pledge, side, protected, kiosk, cap, character_id, clock, ctx,
  );
}

/// Ready this arena seat and atomically take the cut + start from current shared truth when
/// it was the final missing player. The non-starting ready door is deliberately not public.
entry fun ready_and_start_kolizeum(
  lobby: &mut Kolizeum,
  fight_object: &mut Fight,
  fighter_idx: u64,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  if (fight::ready(fight_object, fighter_idx, ctx)) {
    let mut generator = randomness.new_generator(ctx);
    kolizeum::start(lobby, fight_object, &mut generator, clock, ctx);
  };
}

/// Begin the arena fight — the 10% cut goes to the treasury. ENTRY: `&Random` law.
entry fun start_kolizeum(
  lobby: &mut Kolizeum,
  fight_object: &mut Fight,
  randomness: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let mut generator = randomness.new_generator(ctx);
  kolizeum::start(lobby, fight_object, &mut generator, clock, ctx);
}

/// Settle out of the ended arena — pot payout only; PvP has no loot or Random work.
public fun settle_kolizeum(
  lobby: &mut Kolizeum,
  fight_object: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  kolizeum::settle(lobby, fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Final participant settlement — payout and both managed objects close atomically.
public fun settle_last_kolizeum(
  lobby: Kolizeum,
  fight_object: Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let cap = personal_cap(personal, version);
  // last-settler control is asserted inside kolizeum::settle_last
  kolizeum::settle_last(lobby, fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Leave before the fight starts — full pledge refund.
public fun exit_kolizeum(
  lobby: &mut Kolizeum,
  fight_object: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  kolizeum::exit(lobby, fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Final placement exit — refund and both managed objects close atomically.
public fun exit_last_kolizeum(
  lobby: Kolizeum,
  fight_object: Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  // last-live-player control is asserted inside kolizeum::exit_last
  kolizeum::exit_last(lobby, fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Forfeit a STARTED kolizeum fight — leave, abandoning the pot claim (the stalemate escape;
/// nobody is ever stuck). Wagered fights only.
public fun forfeit_kolizeum(
  fight_object: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  kolizeum::forfeit(fight_object, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Explicit recovery for legacy fully-settled managed pairs.
public fun close_kolizeum(lobby: Kolizeum, fight_object: Fight, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  kolizeum::close(lobby, fight_object, ctx);
}

// ╔════════════════ [ Friends ] ══════════════════════════════════════════════ ]
// Address-bound self-signed whitelist — no custody proof needed, the doors only carry the
// version gate. The list itself is soulbound (key-only) and owner-checked inside friends.

public fun create_friend_list(registry: &mut FriendRegistry, first: address, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  friends::create(registry, first, ctx);
}

public fun set_friend(list: &mut FriendList, addr: address, present: bool, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  friends::set(list, addr, present, ctx);
}

// ╔════════════════ [ Trade — the p2p escrow ] ═══════════════════════════════ ]
// Replaces transferred PurchaseCaps (owner 2026-08-12). Caps are created 0-price by the
// caller's own kiosk in the SAME PTB (`list_with_purchase_cap` via the kiosk sdk) and parked
// here; claiming chains the 0-price purchase + royalty floor + relock, also one PTB. The
// Trade is item-and-SUI-only; characters change owners through the marketplace.

public fun trade_put_item(
  trade_object: &mut Trade,
  cap: PurchaseCap<Item>,
  seen_offer_revision: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  trade::put_item(trade_object, cap, seen_offer_revision, ctx);
}

/// Withdraw the caller's own offer. The SDK returns this cap to its source kiosk atomically.
public fun trade_take_item(
  trade_object: &mut Trade,
  item: ID,
  seen_offer_revision: u64,
  version: &Version,
  ctx: &TxContext,
): PurchaseCap<Item> {
  version.assert_latest();
  trade::take_item(trade_object, item, seen_offer_revision, ctx)
}

/// Post-lock: consume the counterparty's cap inside this door. The returned TransferRequest
/// is a hot potato, so the caller must resolve every policy rule and lock the asset atomically.
public fun trade_claim_item(
  trade_object: &mut Trade,
  item: ID,
  source: &mut Kiosk,
  version: &Version,
  ctx: &mut TxContext,
): (Item, TransferRequest<Item>) {
  version.assert_latest();
  trade::claim_item(trade_object, item, source, ctx)
}

public fun trade_recover_item(
  trade_object: &mut Trade,
  item: ID,
  version: &Version,
  ctx: &TxContext,
): PurchaseCap<Item> {
  version.assert_latest();
  trade::recover_item(trade_object, item, ctx)
}
