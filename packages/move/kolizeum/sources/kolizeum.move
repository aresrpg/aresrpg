module aresrpg_kolizeum::kolizeum;

use aresrpg::fight as core_fight;
use aresrpg_fight::{fight::{Self as engine, Fight}, fight_registry::{Self as fight_reg, FightRegistry}, participant, settlement::{Self as results, FightOutcome}, version::Version as FightVersion};
use aresrpg::{character_link, config::GameConfig};
use aresrpg::character::Character;
use aresrpg::version::Version;
use aresrpg_kolizeum::kolizeum_events;
use std::type_name::{Self, TypeName};
use aresrpg_social::friends::{Self, FriendList};
use kiosk::personal_kiosk::PersonalKioskCap;
use sui::{balance::{Self, Balance}, clock::Clock, coin::{Self, Coin}, kiosk::Kiosk, sui::SUI, tx_context::sender};


const STATUS_OPEN: u8 = 0; // accepting joins/exits (pledges refundable)
const STATUS_STARTED: u8 = 1; // fight running — no more joins/exits; pot awaits settlement
const STATUS_SETTLED: u8 = 2; // the fight resolved the pot (paid to the winners, OR fully refunded on a draw); husk awaits sweep
const STATUS_CANCELLED: u8 = 3; // every pledge refunded; husk awaits sweep

public fun status_open(): u8 { STATUS_OPEN }
public fun status_started(): u8 { STATUS_STARTED }
public fun status_settled(): u8 { STATUS_SETTLED }
public fun status_cancelled(): u8 { STATUS_CANCELLED }


const SIDE_A: u8 = 0; // the creator's side
const SIDE_B: u8 = 1; // the opposing side

public fun side_a(): u8 { SIDE_A }
public fun side_b(): u8 { SIDE_B }

const FORMAT_1V1: u64 = 1;
const FORMAT_3V3: u64 = 3;
const FORMAT_6V6: u64 = 6;

fun is_valid_format(slots: u64): bool { slots == FORMAT_1V1 || slots == FORMAT_3V3 || slots == FORMAT_6V6 }


const EBadFormat: u64 = 101; // create: format not in {1,3,6}, or above the GameConfig team-size bound
const EPledgeMismatch: u64 = 102; // create/join: the pledge coin's value != the lobby's pledge amount
const ELevelTooLow: u64 = 103; // create/join: character level below the kolizeum level gate (§17.30)
const ELevelDiffTooHigh: u64 = 104; // join: |joiner level − creator level| above the lobby's max-level-diff
const ENotOpen: u64 = 105; // join/exit/cancel/start: the lobby is no longer OPEN
const ENotFriend: u64 = 106; // join: a friends-only lobby, and the joiner is not in the creation snapshot
const EAlreadyJoined: u64 = 107; // join: this wallet OR this character already holds a seat (double-join guard)
const ESideFull: u64 = 108; // join: the assigned side is already at the format's slots-per-side
const ENotFriendListOwner: u64 = 109; // create_friends_only: the passed FriendList is not the creator's own
const ENotParticipant: u64 = 110; // exit: the sender holds no seat in this lobby
const ENotCreator: u64 = 111; // cancel: only the creator may cancel an OPEN lobby
const ENotStarted: u64 = 112; // settle: the lobby is not STARTED
const EBadSide: u64 = 113; // settle: winning_side is neither SIDE_A nor SIDE_B
const ENoWinners: u64 = 114; // settle: the declared winning side has zero fighters (an empty side cannot win)
const ENotSweepable: u64 = 115; // sweep: the lobby is not SETTLED or CANCELLED
const EWrongFight: u64 = 116; // start/seat/settle: the passed fight/result is not the one THIS lobby started (anti cross-settle)
const EWrongOutcomeBrand: u64 = 117; // open: the outcome was NOT minted under KolizeumBrand — this terminal only consumes arena outcomes (a PvM outcome consumed here would forfeit its xp/hp write-backs + strand the fight marker)


const PLATFORM_CUT_BPS: u64 = 1_000;
const BPS_DENOM: u64 = 10_000;

public fun platform_cut_of(amount: u64): u64 { amount.mul_div(PLATFORM_CUT_BPS, BPS_DENOM) }


public struct KolizeumBrand has drop {}

public fun brand_type(): TypeName { type_name::with_defining_ids<KolizeumBrand>() }


public struct Fighter has store, drop {
  owner: address, // the wallet that pledged + may act for / exit this seat
  character: ID, // the fighting character (one seat per character — double-join guard)
  level: u64, // snapshot at join (the level gate + max-diff read it once, here)
  join_order: u64,
}

public struct Kolizeum has key {
  id: UID,
  creator: address,
  status: u8,
  format_slots: u64, // per-side cap (1/3/6)
  pledge_amount: u64, // every seat pledges EXACTLY this (0 allowed — a friendly duel)
  pot: Balance<SUI>,
  is_public: bool,
  allow: vector<address>, // friends snapshot (empty ⇔ public)
  max_level_diff: u64, // anti-HL-farming: |joiner − creator| level cap
  creator_level: u64,
  gate_snapshot: u64, // the kolizeum_level_gate value AT creation
  side_a: vector<Fighter>,
  side_b: vector<Fighter>,
  join_seq: u64, // next join_order to hand out
  fight_id: Option<ID>, // the PvP `Fight` id spawned at `start`; settlement asserts a result's `fight_id` matches it (no foreign fight settles this pot); `none` until start
}


public fun create_public(
  config: &GameConfig,
  format_slots: u64,
  pledge_amount: u64,
  max_level_diff: u64,
  character: &Character,
  pledge: Coin<SUI>,
  version: &Version,
  ctx: &mut TxContext,
) {
  let level = character_link::level(character);
  create_internal(config, format_slots, pledge_amount, true, vector[], max_level_diff, level, object::id(character), pledge, version, ctx);
}

public fun create_friends_only(
  config: &GameConfig,
  format_slots: u64,
  pledge_amount: u64,
  max_level_diff: u64,
  friend_list: &FriendList,
  character: &Character,
  pledge: Coin<SUI>,
  version: &Version,
  ctx: &mut TxContext,
) {
  assert!(friends::owner(friend_list) == sender(ctx), ENotFriendListOwner);
  let allow = friends::friends(friend_list); // the SNAPSHOT — a copy, frozen for this lobby's life
  let level = character_link::level(character);
  create_internal(config, format_slots, pledge_amount, false, allow, max_level_diff, level, object::id(character), pledge, version, ctx);
}

fun create_internal(
  config: &GameConfig,
  format_slots: u64,
  pledge_amount: u64,
  is_public: bool,
  allow: vector<address>,
  max_level_diff: u64,
  creator_level: u64,
  character_id: ID,
  pledge: Coin<SUI>,
  version: &Version,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  config.assert_domain(aresrpg::config::domain_pvp()); // S-46 kill-switch bit
  version.assert_enabled();
  let gate = config.pvp_level_gate();
  assert!(is_valid_format(format_slots) && format_slots <= config.team_size_bound(), EBadFormat);
  assert!(creator_level >= gate, ELevelTooLow);
  assert!(pledge.value() == pledge_amount, EPledgeMismatch);

  let creator = sender(ctx);
  let k = Kolizeum {
    id: object::new(ctx),
    creator,
    status: STATUS_OPEN,
    format_slots,
    pledge_amount,
    pot: pledge.into_balance(),
    is_public,
    allow,
    max_level_diff,
    creator_level,
    gate_snapshot: gate,
    side_a: vector[Fighter { owner: creator, character: character_id, level: creator_level, join_order: 0 }],
    side_b: vector[],
    join_seq: 1,
    fight_id: option::none(),
  };
  kolizeum_events::emit_created(object::id(&k), creator, format_slots, pledge_amount, is_public);
  transfer::share_object(k);
}


public fun join(
  kolizeum: &mut Kolizeum,
  character: &Character,
  pledge: Coin<SUI>,
  config: &GameConfig,
  version: &Version,
  ctx: &TxContext,
) {
  config.assert_domain(aresrpg::config::domain_pvp()); // S-46 kill-switch bit
  let level = character_link::level(character);
  join_internal(kolizeum, level, object::id(character), pledge, version, ctx);
}

fun join_internal(
  kolizeum: &mut Kolizeum,
  level: u64,
  character_id: ID,
  pledge: Coin<SUI>,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  assert!(kolizeum.status == STATUS_OPEN, ENotOpen);
  assert!(pledge.value() == kolizeum.pledge_amount, EPledgeMismatch);
  assert!(level >= kolizeum.gate_snapshot, ELevelTooLow);
  assert!(abs_diff(level, kolizeum.creator_level) <= kolizeum.max_level_diff, ELevelDiffTooHigh);

  let joiner = sender(ctx);
  if (!kolizeum.is_public) assert!(kolizeum.allow.contains(&joiner), ENotFriend);
  assert!(!contains_owner(kolizeum, joiner) && !contains_character(kolizeum, character_id), EAlreadyJoined);

  let side = choose_side(kolizeum);
  let seat = Fighter { owner: joiner, character: character_id, level, join_order: kolizeum.join_seq };
  let order = kolizeum.join_seq;
  kolizeum.join_seq = kolizeum.join_seq + 1;
  kolizeum.pot.join(pledge.into_balance());
  if (side == SIDE_A) {
    assert!(kolizeum.side_a.length() < kolizeum.format_slots, ESideFull);
    kolizeum.side_a.push_back(seat);
  } else {
    assert!(kolizeum.side_b.length() < kolizeum.format_slots, ESideFull);
    kolizeum.side_b.push_back(seat);
  };
  kolizeum_events::emit_joined(object::id(kolizeum), joiner, character_id, side, order);
}


public fun exit(kolizeum: &mut Kolizeum, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  assert!(kolizeum.status == STATUS_OPEN, ENotOpen);
  let who = sender(ctx);
  assert!(remove_fighter(kolizeum, who), ENotParticipant);
  let refund = refund_one(kolizeum, who, ctx);
  if (kolizeum.side_a.is_empty() && kolizeum.side_b.is_empty()) kolizeum.status = STATUS_CANCELLED;
  kolizeum_events::emit_exited(object::id(kolizeum), who, refund);
}


public fun cancel(kolizeum: &mut Kolizeum, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  assert!(kolizeum.status == STATUS_OPEN, ENotOpen);
  assert!(sender(ctx) == kolizeum.creator, ENotCreator);
  let refunded = refund_all(kolizeum, ctx);
  kolizeum.status = STATUS_CANCELLED;
  kolizeum_events::emit_cancelled(object::id(kolizeum), refunded);
}


const FIGHT_NONCE: u64 = 0;
const KOLIZEUM_WORLD_SEED: u64 = 0x4B4F4C495A45554D; // "KOLIZEUM" — the arena world-seed (world-independent, §17.9)

public fun start(
  kolizeum: &mut Kolizeum,
  registry: &mut FightRegistry,
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  fight_version: &FightVersion,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  config.assert_domain(aresrpg::config::domain_pvp()); // S-46 kill-switch bit
  let who = sender(ctx);
  assert!(who == kolizeum.creator, ENotCreator);
  assert!(member_side(kolizeum, who, character_id).is_some(), ENotParticipant);

  let scope = object::id(kolizeum);
  let (anchor_x, anchor_z) = board_anchor(scope);
  let per_side = kolizeum.format_slots;
  kolizeum.fight_id = option::some(object::id_from_address(fight_reg::fight_address(registry, scope, FIGHT_NONCE)));
  mark_started(kolizeum);

  let creator = participant::with_full_hp(core_fight::combat_snapshot(kiosk, pkcap, character_id, raised_spell_ids, config, clock));
  engine::create_pvp(
    KolizeumBrand {}, registry, scope, FIGHT_NONCE, KOLIZEUM_WORLD_SEED, anchor_x, anchor_z, per_side,
    creator, core_fight::dial_snapshot(config), fight_version, clock, ctx,
  );
}

public fun seat(
  kolizeum: &Kolizeum,
  fight: &mut Fight,
  fight_registry: &mut FightRegistry,
  kiosk: &Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  version: &Version,
  fight_version: &FightVersion,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_enabled();
  config.assert_domain(aresrpg::config::domain_pvp()); // S-46 kill-switch bit
  assert!(kolizeum.status == STATUS_STARTED, ENotStarted);
  assert!(kolizeum.fight_id.is_some() && *kolizeum.fight_id.borrow() == object::id(fight), EWrongFight);
  let side = member_side(kolizeum, sender(ctx), character_id);
  assert!(side.is_some(), ENotParticipant); // a non-member (or wrong character) cannot seat
  let joiner = core_fight::combat_snapshot(kiosk, pkcap, character_id, raised_spell_ids, config, clock);
  engine::join(KolizeumBrand {}, fight, fight_registry, joiner, vector[], option::none(), *side.borrow(), true, fight_version, ctx);
}

public(package) fun mark_started(kolizeum: &mut Kolizeum) {
  assert!(kolizeum.status == STATUS_OPEN, ENotOpen);
  kolizeum.status = STATUS_STARTED;
  kolizeum_events::emit_started(object::id(kolizeum), kolizeum.side_a.length(), kolizeum.side_b.length());
}


public fun settle(kolizeum: &mut Kolizeum, result: &FightOutcome, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  settle_internal(kolizeum, results::fight_id(result), results::winner_team(result), ctx);
}

public fun open(outcome: FightOutcome) {
  assert!(results::brand(&outcome) == brand_type(), EWrongOutcomeBrand);
  let (_brand, fight, _world, character, _status, _hp, _xp, _aged, _chance, _mobs, _loot, _pvp, _team, _winner, _mult) =
    results::unpack(outcome);
  kolizeum_events::emit_outcome_opened(fight, character);
}

public(package) fun settle_internal(kolizeum: &mut Kolizeum, fight_id: ID, winner: Option<u8>, ctx: &mut TxContext) {
  assert!(kolizeum.status == STATUS_STARTED, ENotStarted);
  assert!(kolizeum.fight_id.is_some() && *kolizeum.fight_id.borrow() == fight_id, EWrongFight);
  if (winner.is_some()) {
    distribute_pot(kolizeum, *winner.borrow(), ctx);
  } else {
    let refunded = refund_all(kolizeum, ctx);
    kolizeum.status = STATUS_SETTLED;
    kolizeum_events::emit_drawn(object::id(kolizeum), refunded);
  };
}

public(package) fun distribute_pot(kolizeum: &mut Kolizeum, winning_side: u8, ctx: &mut TxContext) {
  assert!(kolizeum.status == STATUS_STARTED, ENotStarted);
  assert!(winning_side == SIDE_A || winning_side == SIDE_B, EBadSide);
  let n = if (winning_side == SIDE_A) kolizeum.side_a.length() else kolizeum.side_b.length();
  assert!(n > 0, ENoWinners);

  let gross = kolizeum.pot.value();
  let fee = platform_cut_of(gross);
  if (fee > 0) transfer::public_transfer(coin::from_balance(kolizeum.pot.split(fee), ctx), @treasury);

  let total = kolizeum.pot.value(); // the winners' share = gross − fee
  let per = total / n;
  let rem = total % n;
  let mut i = 0;
  while (i < n) {
    let owner = { let f = if (winning_side == SIDE_A) kolizeum.side_a.borrow(i) else kolizeum.side_b.borrow(i); f.owner };
    let amt = if (i == 0) per + rem else per; // the remainder rides the first winner by join order
    if (amt > 0) {
      let payout = kolizeum.pot.split(amt);
      transfer::public_transfer(coin::from_balance(payout, ctx), owner);
    };
    i = i + 1;
  };
  kolizeum.status = STATUS_SETTLED;
  kolizeum_events::emit_settled(object::id(kolizeum), winning_side, gross, fee, n);
}


public fun sweep(kolizeum: Kolizeum) {
  assert!(kolizeum.status == STATUS_SETTLED || kolizeum.status == STATUS_CANCELLED, ENotSweepable);
  let id = object::id(&kolizeum);
  let Kolizeum {
    id: uid, creator: _, status: _, format_slots: _, pledge_amount: _, pot, is_public: _, allow: _,
    max_level_diff: _, creator_level: _, gate_snapshot: _, side_a: _, side_b: _, join_seq: _, fight_id: _,
  } = kolizeum;
  pot.destroy_zero();
  object::delete(uid);
  kolizeum_events::emit_swept(id);
}


fun abs_diff(a: u64, b: u64): u64 { if (a >= b) a - b else b - a }

fun member_side(k: &Kolizeum, who: address, character: ID): Option<u8> {
  if (seat_in_side(&k.side_a, who, character)) option::some(SIDE_A)
  else if (seat_in_side(&k.side_b, who, character)) option::some(SIDE_B)
  else option::none()
}

fun seat_in_side(side: &vector<Fighter>, who: address, character: ID): bool {
  let mut i = 0;
  while (i < side.length()) {
    let f = side.borrow(i);
    if (f.owner == who && f.character == character) return true;
    i = i + 1;
  };
  false
}

fun board_anchor(scope: ID): (u32, u32) {
  let b = object::id_to_bytes(&scope);
  (u32_at(&b, 0), u32_at(&b, 4))
}

fun u32_at(b: &vector<u8>, off: u64): u32 {
  let v = ((*b.borrow(off) as u64) << 24) | ((*b.borrow(off + 1) as u64) << 16)
    | ((*b.borrow(off + 2) as u64) << 8) | (*b.borrow(off + 3) as u64);
  v as u32
}

fun choose_side(k: &Kolizeum): u8 {
  if (k.side_b.length() < k.side_a.length()) SIDE_B else SIDE_A
}

fun contains_owner(k: &Kolizeum, who: address): bool {
  side_has_owner(&k.side_a, who) || side_has_owner(&k.side_b, who)
}

fun contains_character(k: &Kolizeum, character: ID): bool {
  side_has_character(&k.side_a, character) || side_has_character(&k.side_b, character)
}

fun side_has_owner(side: &vector<Fighter>, who: address): bool {
  let mut i = 0;
  while (i < side.length()) { if (side.borrow(i).owner == who) return true; i = i + 1; };
  false
}

fun side_has_character(side: &vector<Fighter>, character: ID): bool {
  let mut i = 0;
  while (i < side.length()) { if (side.borrow(i).character == character) return true; i = i + 1; };
  false
}

fun remove_fighter(k: &mut Kolizeum, who: address): bool {
  let (found_a, ia) = find_owner(&k.side_a, who);
  if (found_a) { k.side_a.remove(ia); return true };
  let (found_b, ib) = find_owner(&k.side_b, who);
  if (found_b) { k.side_b.remove(ib); return true };
  false
}

fun find_owner(side: &vector<Fighter>, who: address): (bool, u64) {
  let mut i = 0;
  while (i < side.length()) { if (side.borrow(i).owner == who) return (true, i); i = i + 1; };
  (false, 0)
}

fun refund_one(k: &mut Kolizeum, to: address, ctx: &mut TxContext): u64 {
  let amt = k.pledge_amount;
  if (amt > 0) {
    let r = k.pot.split(amt);
    transfer::public_transfer(coin::from_balance(r, ctx), to);
  };
  amt
}

fun refund_all(k: &mut Kolizeum, ctx: &mut TxContext): u64 {
  let mut total = 0;
  while (!k.side_a.is_empty()) { let f = k.side_a.pop_back(); total = total + refund_one(k, f.owner, ctx); };
  while (!k.side_b.is_empty()) { let f = k.side_b.pop_back(); total = total + refund_one(k, f.owner, ctx); };
  total
}


public fun creator(k: &Kolizeum): address { k.creator }
public fun status(k: &Kolizeum): u8 { k.status }
public fun format_slots(k: &Kolizeum): u64 { k.format_slots }
public fun pledge_amount(k: &Kolizeum): u64 { k.pledge_amount }
public fun pot_value(k: &Kolizeum): u64 { k.pot.value() }
public fun is_public(k: &Kolizeum): bool { k.is_public }
public fun max_level_diff(k: &Kolizeum): u64 { k.max_level_diff }
public fun creator_level(k: &Kolizeum): u64 { k.creator_level }
public fun allow_snapshot(k: &Kolizeum): vector<address> { k.allow }
public fun side_a_size(k: &Kolizeum): u64 { k.side_a.length() }
public fun side_b_size(k: &Kolizeum): u64 { k.side_b.length() }
public fun fighter_count(k: &Kolizeum): u64 { k.side_a.length() + k.side_b.length() }


#[test_only]
public fun create_for_testing(
  config: &GameConfig,
  format_slots: u64,
  pledge_amount: u64,
  is_public: bool,
  allow: vector<address>,
  max_level_diff: u64,
  creator_level: u64,
  character_id: ID,
  pledge: Coin<SUI>,
  version: &Version,
  ctx: &mut TxContext,
) {
  create_internal(config, format_slots, pledge_amount, is_public, allow, max_level_diff, creator_level, character_id, pledge, version, ctx);
}

#[test_only]
public fun join_for_testing(kolizeum: &mut Kolizeum, level: u64, character_id: ID, pledge: Coin<SUI>, version: &Version, ctx: &TxContext) {
  join_internal(kolizeum, level, character_id, pledge, version, ctx);
}

#[test_only]
public fun start_for_testing(kolizeum: &mut Kolizeum) { mark_started(kolizeum); }

#[test_only]
public fun settle_for_testing(kolizeum: &mut Kolizeum, winning_side: u8, ctx: &mut TxContext) { distribute_pot(kolizeum, winning_side, ctx); }

#[test_only]
public fun bind_fight_for_testing(kolizeum: &mut Kolizeum, fight_id: ID) { kolizeum.fight_id = option::some(fight_id); }

#[test_only]
public fun settle_bound_for_testing(kolizeum: &mut Kolizeum, fight_id: ID, winner: Option<u8>, ctx: &mut TxContext) {
  settle_internal(kolizeum, fight_id, winner, ctx);
}

#[test_only]
public fun member_side_for_testing(kolizeum: &Kolizeum, who: address, character: ID): Option<u8> { member_side(kolizeum, who, character) }
