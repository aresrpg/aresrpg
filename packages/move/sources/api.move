// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The game's public composition surface (legacy api.move pattern — born the day a door
/// composed two modules). Single-module doors stay public in their own homes; doors that
/// CROSS modules live here. Every character lives KIOSK-LOCKED in a personal kiosk — public
/// doors take the kiosk and borrow through the owner's cap.
module aresrpg::api;

use aresrpg::{
  character::{Self, Character, NameRegistry},
  consumable,
  crafting::{Self, Recipe},
  dungeon,
  equipment,
  fight::{Self, Fight, FightBuild},
  forgemagie::{Self, CrushClaim},
  friends::{Self, FriendList, FriendRegistry},
  gathering,
  kolizeum::{Self, Kolizeum},
  item::{Self, Item, ItemTemplate},
  loot_box::{Self, LootRegistry, BoxClaim},
  mob_template::MobTemplate,
  naked_rule,
  party::{Self, Party},
  trade::{Self, Trade},
  pet,
  progression,
  protected_policy::AresRPG_TransferPolicy,
  shop::{Self, Airdrop, Giftcard, Sale},
  spell_template::SpellTemplate,
  version::Version,
  world::{Self, World},
  zone,
};
use aresrpg_math::world_map;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::{
  clock::Clock,
  coin::Coin,
  kiosk::{Kiosk, KioskOwnerCap, PurchaseCap},
  random::Random,
  sui::SUI,
  transfer::Receiving,
  transfer_policy::TransferPolicy,
};

const EDeleteWhileEquipped: u64 = 1101; // delete_character: unequip everything first
const EDeleteWhileAmbushed: u64 = 1102; // delete_character: face the protector first
const EManagedFight: u64 = 1103; // a managed fight (dungeon/kolizeum) joins/settles only through its module's doors
const EDeleteWhileInDungeon: u64 = 1104; // delete_character: finish or abandon the run first
const ENotOwnList: u64 = 1105; // create_kolizeum_friends: the FriendList is not the creator's own

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
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let mut chr = character::create_character(
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
  world::join_world(&mut chr, world_map::first_world(), clock);
  character::assert_personal_custody(kiosk); // soulbound custody — a personal kiosk only
  kiosk.lock(cap, policy, chr);
}

/// The star gate: walk to your current world's portal (the travel proof), materialize at the
/// destination's. The character stays kiosk-locked throughout — borrowed, never moved.
public fun join_world(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  world: String,
  version: &Version,
  clock: &Clock,
) {
  version.assert_latest();
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  world::join_world(chr, world, clock);
}

/// Discover (or refresh after the TTL) the zone at the character's claimed position — the
/// walk is proven, then fresh entropy draws what lives there. ENTRY: `&Random` law.
entry fun search_zone(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  w: &mut World,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  zone::search(chr, x, z, w, &mut gen, clock);
}

/// Spend level-up points into a characteristic (5 granted per level, spent 1:1).
public fun raise_stat(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  stat: String,
  amount: u16,
  version: &Version,
) {
  version.assert_latest();
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  character::raise_stat(chr, stat, amount);
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
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  progression::raise_spell(chr, spell);
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
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  equipment::equip(chr, slot, item);
  if (is_pet) equipment::set_slot_stats(chr, slot, pet_stats.destroy_some());
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
    let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
    equipment::unequip(chr, slot, receiving)
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
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  let chr: Character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  assert!(!equipment::has_any_equipped(&chr), EDeleteWhileEquipped);
  assert!(!gathering::has_fired_verdict(&chr), EDeleteWhileAmbushed);
  assert!(!dungeon::has_run(&chr), EDeleteWhileInDungeon);
  character::destroy(chr);
}

// ╔════════════════ [ Fights ] ═══════════════════════════════════════════════ ]

/// Walk to a live mob group and claim it — the character leaves the kiosk into fight
/// custody. Returns the build potato: `add_fight_mob` per member (exact order), then
/// `launch_fight` — one transaction.
public fun engage_fight(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  w: &mut World,
  zx: u32,
  zz: u32,
  group_index: u64,
  access: u8, // 0 public — anyone joins your side · 1 group-only
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  version.assert_latest();
  fight::engage(protected, kiosk, cap, character_id, w, zx, zz, group_index, access, clock, ctx)
}

public fun add_fight_mob(build: FightBuild, template: &MobTemplate): FightBuild {
  fight::add_mob(build, template)
}

public fun launch_fight(build: FightBuild, clock: &Clock, ctx: &mut TxContext) {
  fight::launch(build, clock, ctx)
}

/// Challenge a DUEL at your proven spot — side B waits for an acceptor. ENTRY: `&Random`
/// law (the board rolls fresh). Duels never touch persistent hp, xp, or loot.
entry fun challenge_duel(
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  access: u8, // 0 public · 1 group-only
  protected: &AresRPG_TransferPolicy<Character>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  fight::challenge(protected, kiosk, cap, character_id, x, z, access, &mut gen, clock, ctx);
}

/// Join EITHER side of a fight during placement (walk proven, kiosk exit, custody). Any
/// side without mobs is a player side; its opener's access setting rules — opening an empty
/// side makes YOUR setting its rule.
public fun join_fight(
  f: &mut Fight,
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
  assert!(!fight::is_managed(f), EManagedFight);
  fight::join(f, protected, kiosk, cap, character_id, team, access, true, clock, ctx);
}

/// Join a GROUP-gated side — the presented party must hold both you and the side's opener.
public fun join_fight_grouped(
  f: &mut Fight,
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
  assert!(!fight::is_managed(f), EManagedFight);
  fight::join_grouped(f, protected, kiosk, cap, character_id, team, shared_party, true, clock, ctx);
}

/// Pick another of your side's start cells during placement.
public fun place_fighter(f: &mut Fight, fighter_idx: u64, cell: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::place(f, fighter_idx, cell, ctx);
}

public fun ready_fighter(f: &mut Fight, fighter_idx: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::ready(f, fighter_idx, ctx);
}

/// All ready — or anyone once the 60s window closes. Plants the crank entropy. ENTRY:
/// `&Random` law.
entry fun start_fight(f: &mut Fight, r: &Random, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest();
  // a wagered (kolizeum) fight must start through `start_kolizeum` so the 10% cut is taken —
  // the generic door would begin the fight and skip the cut. Dungeon fights are managed but
  // NOT wagered, so they still start here.
  assert!(!fight::is_wagered(f), EManagedFight);
  let mut gen = r.new_generator(ctx);
  fight::start(f, &mut gen, clock);
}

/// Cast a learned class spell at a cell — your turn only, previewable off the turn seed.
public fun cast_spell(
  f: &mut Fight,
  fighter_idx: u64,
  spell: &SpellTemplate,
  target_cell: u64,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  fight::cast(f, fighter_idx, spell, target_cell, ctx);
}

/// Swing the weapon — the strike is a spell assembled at seating.
public fun weapon_strike(f: &mut Fight, fighter_idx: u64, target_cell: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::strike(f, fighter_idx, target_cell, ctx);
}

/// Walk the acting fighter along the caller's exact orthogonal path — tackle tolls apply along
/// the way. Hidden displacement may stop the remaining route; the chain never chooses another.
public fun move_fighter(f: &mut Fight, path: vector<u64>, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  fight::move_fighter(f, &path, ctx);
}

entry fun end_fight_turn(f: &mut Fight, r: &Random, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest();
  // terminal &Random: the mob wave draws its entropy HERE, so it can't be composed + inspected +
  // aborted for a free re-roll, and no future turn is previewable from a stored stream.
  let mut gen = r.new_generator(ctx);
  fight::end_turn(f, &mut gen, clock, ctx);
}

/// Anyone clears a stall: a 45s-dead player turn force-passes (its mob wave resolves too),
/// a forfeited actor's turn advances free. Mob turns resolve on the pass — never here.
entry fun crank_fight(f: &mut Fight, r: &Random, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  fight::crank(f, &mut gen, clock);
}

/// Leave as a loss — legal from placement on; the fighter reads as killed, hp lands at 1.
public fun forfeit_fight(
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_latest();
  assert!(!fight::is_managed(f), EManagedFight); // dungeon rooms give up via the dungeon door
  fight::forfeit(f, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Walk out of an ended fight: hp writes back, winners take xp and roll their drops off
/// FRESH entropy (the loot draw is value-bearing — the RANDOMNESS LAW). ENTRY: `&Random`.
entry fun settle_fight(
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  assert!(!fight::is_managed(f), EManagedFight); // dungeon rooms settle via the dungeon door
  let mut gen = r.new_generator(ctx);
  fight::settle(f, fighter_idx, kiosk, cap, policy, &mut gen, clock, ctx);
}

/// Mint one rolled drop straight into your kiosk (the item's stats roll HERE); pass your
/// held stack of the same resource as `existing` to grow it instead (the no-dust law).
/// ENTRY: `&Random` law.
entry fun claim_fight_drop(
  f: &mut Fight,
  fighter_idx: u64,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  item_policy: &TransferPolicy<Item>,
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  fight::claim_drop(f, fighter_idx, template, existing, kiosk, cap, item_policy, &mut gen, ctx);
}

/// Destroy an ended fight once every fighter settled and every drop is claimed.
public fun close_fight(f: Fight, version: &Version) {
  version.assert_latest();
  fight::close(f);
}

// ╔════════════════ [ Party ] ════════════════════════════════════════════════ ]
// Each door borrows the acting character out of the sender's kiosk (custody = the proof),
// then hands the reference to party. A wallet may hold several characters, hence several slots.

public fun create_party(kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  let chr: &Character = kiosk.borrow(cap, character_id);
  party::create(chr, ctx);
}

public fun party_invite(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, invited_character: ID, version: &Version) {
  version.assert_latest();
  let leader: &Character = kiosk.borrow(cap, leader_id);
  party::invite(p, leader, invited_character);
}

public fun party_accept(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  let chr: &Character = kiosk.borrow(cap, character_id);
  party::accept(p, chr, ctx);
}

public fun party_decline(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version) {
  version.assert_latest();
  let chr: &Character = kiosk.borrow(cap, character_id);
  party::decline(p, chr);
}

public fun party_rescind(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, invited_character: ID, version: &Version) {
  version.assert_latest();
  let leader: &Character = kiosk.borrow(cap, leader_id);
  party::rescind(p, leader, invited_character);
}

public fun party_leave(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, version: &Version) {
  version.assert_latest();
  let chr: &Character = kiosk.borrow(cap, character_id);
  party::leave(p, chr);
}

public fun party_kick(p: &mut Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, target_character: ID, version: &Version) {
  version.assert_latest();
  let leader: &Character = kiosk.borrow(cap, leader_id);
  party::kick(p, leader, target_character);
}

public fun party_disband(p: Party, kiosk: &Kiosk, cap: &KioskOwnerCap, leader_id: ID, version: &Version) {
  version.assert_latest();
  let leader: &Character = kiosk.borrow(cap, leader_id);
  party::disband(p, leader);
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

// ╔════════════════ [ Gathering ] ════════════════════════════════════════════ ]

/// Harvest ONE node off a resource pack: walk proven, tool + tier gated, yield rolled off
/// the job level, node consumed, the stack locked into the kiosk — then the golden-gather
/// draw and the GAS-UNIFORM protector verdict (a fired verdict roots you until
/// `resolve_ambush`). ENTRY: `&Random` law. Pass the base template again as `rare_template`
/// when the row has no link.
entry fun gather(
  w: &mut World,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zz: u32,
  pack_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  existing: Option<ID>,
  existing_rare: Option<ID>,
  item_policy: &TransferPolicy<Item>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  gathering::gather(
    w,
    kiosk,
    cap,
    character_id,
    zx,
    zz,
    pack_index,
    template,
    rare_template,
    existing,
    existing_rare,
    item_policy,
    &mut gen,
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
    clock,
    ctx,
  );
}

// ╔════════════════ [ Crafting ] ═════════════════════════════════════════════ ]

/// Craft a frozen recipe: the exact ingredient tally burns (success OR failure), the roll
/// runs off your job level, a success mints into your kiosk (merged into `existing` under
/// the no-dust law). ENTRY: `&Random` law.
entry fun craft(
  recipe: &Recipe,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  input_item_ids: vector<ID>,
  output_template: &ItemTemplate,
  existing: Option<ID>,
  protected_item: &AresRPG_TransferPolicy<Item>,
  item_policy: &TransferPolicy<Item>,
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  crafting::craft(
    recipe,
    kiosk,
    cap,
    character_id,
    input_item_ids,
    output_template,
    existing,
    protected_item,
    item_policy,
    &mut gen,
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
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  forgemagie::scribe(
    kiosk,
    cap,
    character_id,
    gear_id,
    gear_template,
    rune_item_id,
    protected_item,
    &mut gen,
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
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  forgemagie::crush(kiosk, cap, gear_ids, protected_item, &mut gen, ctx);
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
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  loot_box::open_box(registry, kiosk, cap, box_item_id, box_template, protected_item, &mut gen, ctx);
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
  r: &Random,
  version: &Version,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  loot_box::claim_loot(claim, rolled_template, existing, kiosk, cap, item_policy, &mut gen, ctx);
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

// ╔════════════════ [ Shop / airdrops / giftcards (no randomness — stat-less) ] ]

/// Buy from a seeded sale: exact payment × quantity to the treasury, the stack lands in
/// your kiosk (merged into `existing` under the no-dust law).
public fun buy(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u32,
  payment: Coin<SUI>,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  shop::buy(sale, template, quantity, payment, existing, kiosk, cap, item_policy, ctx);
}

/// Claim your airdrop share — once only, your address leaves the whitelist.
public fun claim_airdrop(
  drop: &mut Airdrop,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  shop::claim_airdrop(drop, template, existing, kiosk, cap, item_policy, ctx);
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
  shop::redeem_giftcard(card, template, existing, kiosk, cap, item_policy, ctx);
}

// ╔════════════════ [ Dungeons ] ═════════════════════════════════════════════ ]

/// Consume the world's dungeon key at a live portal — begin a run (staged at room 1, rooted).
entry fun enter_dungeon(
  w: &World,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zz: u32,
  key_id: ID,
  protected_item: &AresRPG_TransferPolicy<Item>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  // the run's board seed is drawn HERE from Sui randomness (terminal) — the room boards derive
  // from it, so no caller can enumerate a favorable dungeon layout.
  let mut gen = r.new_generator(ctx);
  dungeon::enter(w, protected_item, kiosk, cap, character_id, zx, zz, key_id, gen.generate_u64(), clock, ctx);
}

/// Birth the run's current room fight — returns the build potato: `add_fight_mob` × the
/// room's mobs (exact order), then `launch_fight`.
public fun engage_dungeon_room(
  w: &World,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  access: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  version.assert_latest();
  dungeon::engage_room(w, protected, kiosk, cap, character_id, access, clock, ctx)
}

/// Join a PUBLIC dungeon room fight — your run must be at the fight's room.
public fun join_dungeon_room(
  f: &mut Fight,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protected: &AresRPG_TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  dungeon::join_room(f, protected, kiosk, cap, character_id, clock, ctx);
}

/// Join a GROUP-locked dungeon room — the opener's party gates it.
public fun join_dungeon_room_grouped(
  f: &mut Fight,
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
  dungeon::join_room_grouped(f, protected, kiosk, cap, character_id, shared_party, clock, ctx);
}

/// Leave an ended room: settle + normal loot, then advance the run (win) or end it (win-last
/// or loss). ENTRY: `&Random` law (the loot draw).
entry fun settle_dungeon_room(
  w: &World,
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  dungeon::settle_room(w, f, fighter_idx, kiosk, cap, policy, &mut gen, clock, ctx);
}

/// Give up the current room mid-fight — forfeit and end the run (the key is already gone).
public fun give_up_dungeon_room(
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_latest();
  dungeon::give_up_room(f, fighter_idx, kiosk, cap, policy, clock, ctx);
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
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  kolizeum::create(pledge, format, level_min, level_max, access, option::none(), protected, kiosk, cap, character_id, gen.generate_u64(), clock, ctx);
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
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  assert!(friends::owner(list) == ctx.sender(), ENotOwnList); // snapshot only your OWN list
  let mut gen = r.new_generator(ctx);
  let allowed = option::some(friends::snapshot(list));
  kolizeum::create(pledge, format, level_min, level_max, access, allowed, protected, kiosk, cap, character_id, gen.generate_u64(), clock, ctx);
}

/// Stake the matching pledge and seat on a side (format-capped, level-gated, whitelist-gated).
public fun join_kolizeum(
  lobby: &mut Kolizeum,
  f: &mut Fight,
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
  kolizeum::join(lobby, f, pledge, side, protected, kiosk, cap, character_id, clock, ctx);
}

/// Begin the arena fight — the 10% cut goes to the treasury. ENTRY: `&Random` law.
entry fun start_kolizeum(lobby: &mut Kolizeum, f: &mut Fight, r: &Random, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  kolizeum::start(lobby, f, &mut gen, clock, ctx);
}

/// Settle out of the ended arena — a winner is paid their pot share. ENTRY: `&Random` law.
entry fun settle_kolizeum(
  lobby: &mut Kolizeum,
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  personal: &PersonalKioskCap,
  policy: &TransferPolicy<Character>,
  r: &Random,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the packed cap unpacks HERE — a &Random door admits no PTB-side borrow (Sui law)
  let cap = personal_kiosk::borrow(personal);
  version.assert_latest();
  let mut gen = r.new_generator(ctx);
  kolizeum::settle(lobby, f, fighter_idx, kiosk, cap, policy, &mut gen, clock, ctx);
}

/// Leave before the fight starts — full pledge refund.
public fun exit_kolizeum(
  lobby: &mut Kolizeum,
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  kolizeum::exit(lobby, f, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Forfeit a STARTED kolizeum fight — leave, abandoning the pot claim (the stalemate escape;
/// nobody is ever stuck). Wagered fights only.
public fun forfeit_kolizeum(
  f: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_latest();
  kolizeum::forfeit(f, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Delete the empty kolizeum husk (pot fully paid or refunded).
public fun sweep_kolizeum(lobby: Kolizeum, version: &Version) {
  version.assert_latest();
  kolizeum::sweep(lobby);
}

// ╔════════════════ [ Friends ] ══════════════════════════════════════════════ ]
// Address-bound self-signed whitelist — no custody proof needed, the doors only carry the
// version gate. The list itself is soulbound (key-only) and owner-checked inside friends.

public fun create_friend_list(registry: &mut FriendRegistry, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  friends::create(registry, ctx);
}

public fun add_friend(list: &mut FriendList, addr: address, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  friends::add(list, addr, ctx);
}

public fun remove_friend(list: &mut FriendList, addr: address, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  friends::remove(list, addr, ctx);
}

// ╔════════════════ [ Trade — the p2p escrow ] ═══════════════════════════════ ]
// Replaces transferred PurchaseCaps (owner 2026-08-12). Caps are created 0-price by the
// caller's own kiosk in the SAME PTB (`list_with_purchase_cap` via the kiosk sdk) and parked
// here; claiming chains the 0-price purchase + royalty floor + relock, also one PTB. The
// generator models no generics, so the two tradable types each get concrete doors.

public fun trade_create(counterparty: address, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  trade::create(counterparty, ctx);
}

public fun trade_deposit_item_cap(t: &mut Trade, cap: PurchaseCap<Item>, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade::deposit_cap(t, cap, ctx);
}

/// A character trades NAKED (naked_rule law): the fail-fast twin of the policy rule — an
/// equipped character parked here would pass the lock and then abort every claim, locked
/// forever. The depositor's own kiosk proves the state (immutable borrow works while listed).
public fun trade_deposit_character_cap(
  t: &mut Trade,
  cap: PurchaseCap<Character>,
  kiosk: &Kiosk,
  kiosk_cap: &KioskOwnerCap,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  let chr: &Character = kiosk.borrow(kiosk_cap, sui::kiosk::purchase_cap_item(&cap));
  naked_rule::assert_naked(chr);
  trade::deposit_cap(t, cap, ctx);
}

/// Chain `kiosk::return_purchase_cap` on the returned cap in the same PTB to unlist the item.
public fun trade_withdraw_item_cap(t: &mut Trade, item: ID, version: &Version, ctx: &TxContext): PurchaseCap<Item> {
  version.assert_latest();
  trade::withdraw_cap(t, item, ctx)
}

public fun trade_withdraw_character_cap(
  t: &mut Trade,
  item: ID,
  version: &Version,
  ctx: &TxContext,
): PurchaseCap<Character> {
  version.assert_latest();
  trade::withdraw_cap(t, item, ctx)
}

public fun trade_deposit_sui(t: &mut Trade, coin: Coin<SUI>, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade::deposit_sui(t, coin, ctx);
}

public fun trade_withdraw_sui(t: &mut Trade, amount: u64, version: &Version, ctx: &mut TxContext): Coin<SUI> {
  version.assert_latest();
  trade::withdraw_sui(t, amount, ctx)
}

/// `seen_version` is the trade version the caller READ — a stale accept aborts (never lock
/// on a state you did not see).
public fun trade_accept(t: &mut Trade, seen_version: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade::accept(t, seen_version, ctx);
}

/// Post-lock: chain the 0-price `purchase_with_cap` + royalty floor + relock in the same PTB.
public fun trade_claim_item_cap(t: &mut Trade, item: ID, version: &Version, ctx: &TxContext): PurchaseCap<Item> {
  version.assert_latest();
  trade::claim_cap(t, item, ctx)
}

public fun trade_claim_character_cap(
  t: &mut Trade,
  item: ID,
  version: &Version,
  ctx: &TxContext,
): PurchaseCap<Character> {
  version.assert_latest();
  trade::claim_cap(t, item, ctx)
}

public fun trade_claim_sui(t: &mut Trade, version: &Version, ctx: &mut TxContext): Coin<SUI> {
  version.assert_latest();
  trade::claim_sui(t, ctx)
}

/// Sweep a drained trade (either party, any phase once empty).
public fun trade_destroy(t: Trade, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade::destroy(t, ctx);
}
