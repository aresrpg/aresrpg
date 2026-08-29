// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// KOLIZEUM — a wagered arena duel (owner 2026-08-11): a plain PvP fight with a PRIZE POT and
/// room-creation settings. The fight is MANAGED and stays 100% wager-blind — it never sees a
/// coin; this module is the escrow + the settings gate, composing the shipped fight doors.
///
/// The pot flow is fully DERIVED, nothing about it stored beyond the balance itself:
///   · CREATE stakes the creator's pledge and births the managed arena fight (board from
///     fresh entropy — neither player picks it); the lobby links the fight id.
///   · JOIN stakes a matching pledge and seats a challenger on a side (format-capped), gated
///     by level range and — if friends-only — the creator's SNAPSHOTTED whitelist.
///   · START takes the 10% platform cut to @treasury (once, off the full pot) and begins.
///   · SETTLE pays each winner `pot / winners-still-unsettled` — the last takes the remainder,
///     so the pot empties exactly, no dust, no stored share.
///   · EXIT refunds a full pledge before the fight starts (no cut was taken yet).
/// There is never a draw (owner: someone always dies first in the loop), so settle always has
/// a winning team.
///
/// Payouts and refunds go to `ctx.sender()` on purpose — the winner/leaver IS the caller — so
/// the self-transfer lint is suppressed module-wide.
#[allow(lint(self_transfer))]
module aresrpg::kolizeum;

use aresrpg::{
  character::{Self, Character},
  dungeon,
  fight::{Self, Fight},
  friends::{Self, FriendList},
  protected_policy::AresRPG_TransferPolicy,
  world,
};
use aresrpg_seed::board_catalog::BoardCatalog;
use sui::{
  balance::Balance,
  clock::Clock,
  coin::{Self, Coin},
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  sui::SUI,
  transfer_policy::TransferPolicy,
  vec_set::{Self, VecSet},
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const CUT_BPS: u64 = 1_000; // the 10% platform cut, taken at start

const EBadFormat: u64 = 2801; // format not in {1,3,6}
const EPledgeMismatch: u64 = 2802; // the coin's value != the lobby's pledge
const ELevelOutOfRange: u64 = 2803; // character level outside the creator's [min,max]
const ERooted: u64 = 2804; // a gather-time root / fired ambush verdict holds the character
const ESideFull: u64 = 2805; // the side is at the format's per-side cap
const ENotFriend: u64 = 2806; // a friends-only lobby, sender not on the creation snapshot
const EWrongFight: u64 = 2808; // the passed fight is not this lobby's fight
const ENotEmpty: u64 = 2809; // sweep: the pot still holds money
const ENotWagered: u64 = 2810; // forfeit: the fight is not a wagered kolizeum fight

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The lobby + escrow. The fight owns the phase (placement/ended); the pot owns the money
/// state — no status field duplicates them.
public struct Kolizeum has key {
  id: UID,
  pot: Balance<SUI>,
  pledge: u64, // the per-seat stake every fighter matches
  fight: ID, // the managed arena fight this lobby owns
  format: u64, // 1 | 3 | 6 players per side
  level_min: u16,
  level_max: u16,
  allowed: Option<VecSet<address>>, // some = friends-only, the creator's snapshot; none = public
}

public struct KolizeumCreated has copy, drop { kolizeum: ID, fight: ID, pledge: u64, format: u64 }

public struct KolizeumPaid has copy, drop { kolizeum: ID, winner: address, amount: u64 }

// ╔════════════════ [ Create ] ═══════════════════════════════════════════════ ]

/// Open a wagered arena. `allowed` = none is public; some(set) is friends-only (the api
/// builds the snapshot from the creator's own list — the two entry doors exist only because
/// Move has no optional reference for the `&FriendList`). `board_seed` is fresh entropy so
/// neither player picks the board.
public(package) fun create(
  pledge_coin: Coin<SUI>,
  format: u64,
  level_min: u16,
  level_max: u16,
  access: u8,
  allowed: Option<VecSet<address>>,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  board_seed: u64,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(format == 1 || format == 3 || format == 6, EBadFormat);
  assert!(level_min <= level_max, ELevelOutOfRange);
  gc(kiosk, cap, character_id, level_min, level_max, clock);

  let mut allowed = allowed;
  if (allowed.is_some()) {
    let entries = allowed.borrow_mut();
    if (!entries.contains(&ctx.sender())) entries.insert(ctx.sender());
  };
  let pledge = pledge_coin.value();
  let fight_id = fight::kolizeum_birth(protected, kiosk, cap, character_id, board_seed, access, catalog, clock, ctx);
  let lobby = Kolizeum {
    id: object::new(ctx),
    pot: pledge_coin.into_balance(),
    pledge,
    fight: fight_id,
    format,
    level_min,
    level_max,
    allowed,
  };
  event::emit(KolizeumCreated { kolizeum: lobby.id.to_inner(), fight: fight_id, pledge, format });
  transfer::share_object(lobby);
}

// ╔════════════════ [ Join / start / settle / exit / sweep ] ═════════════════ ]

/// Stake the matching pledge and seat on `side` (0 or 1). Format-capped, level-gated, and —
/// if friends-only — whitelisted. Arena joins are travel-free (location-agnostic matchmaking).
public(package) fun join(
  lobby: &mut Kolizeum,
  fight: &mut Fight,
  pledge_coin: Coin<SUI>,
  side: u8,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(object::id(fight) == lobby.fight, EWrongFight);
  assert!(pledge_coin.value() == lobby.pledge, EPledgeMismatch);
  if (lobby.allowed.is_some()) assert!(lobby.allowed.borrow().contains(&ctx.sender()), ENotFriend);
  gc(kiosk, cap, character_id, lobby.level_min, lobby.level_max, clock);
  assert!(fight::side_players(fight, side) < lobby.format, ESideFull);

  lobby.pot.join(pledge_coin.into_balance());
  fight::join(fight, protected, kiosk, cap, character_id, side, 0, false, clock, ctx);
  let placement_ms = placement_clock(
    lobby.format,
    fight::side_players(fight, 0),
    fight::side_players(fight, 1),
    clock.timestamp_ms(),
  );
  if (placement_ms != 0) fight::set_placement_clock(fight, placement_ms);
}

/// Begin the fight — takes the 10% platform cut to the treasury (once, off the full pot).
public(package) fun start(lobby: &mut Kolizeum, fight: &mut Fight, gen: &mut RandomGenerator, clock: &Clock, ctx: &mut TxContext) {
  assert!(object::id(fight) == lobby.fight, EWrongFight);
  let cut = lobby.pot.value() * CUT_BPS / 10_000;
  if (cut > 0) transfer::public_transfer(coin::take(&mut lobby.pot, cut, ctx), @treasury);
  fight::start(fight, gen, clock);
}

/// Settle a seat out of the ended fight; a winner is paid `pot / winners-still-unsettled` (the
/// last winner sweeps the remainder). The seat's owner (asserted in `fight::settle`) is paid,
/// so the payout can never be pointed at another character.
public(package) fun settle(
  lobby: &mut Kolizeum,
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(object::id(fight) == lobby.fight, EWrongFight);
  if (fight::fighter_won(fight, fighter_idx)) {
    let share = lobby.pot.value() / fight::winners_remaining(fight);
    if (share > 0) {
      transfer::public_transfer(coin::take(&mut lobby.pot, share, ctx), ctx.sender());
      event::emit(KolizeumPaid { kolizeum: lobby.id.to_inner(), winner: ctx.sender(), amount: share });
    };
  };
  fight::settle_pvp(fight, fighter_idx, kiosk, cap, policy, clock, ctx);
}

/// Final ended-fight participant: payout, character return, Fight deletion, and lobby
/// deletion are one transaction. Non-final callers use ordinary `settle`.
public(package) fun settle_last(
  mut lobby: Kolizeum,
  mut fight: Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  fight::assert_last_settler(&fight, fighter_idx, ctx);
  // the lobby/fight pairing (EWrongFight) is asserted inside `settle`
  settle(&mut lobby, &mut fight, fighter_idx, kiosk, cap, policy, clock, ctx);
  assert!(lobby.pot.value() == 0, ENotEmpty);
  fight::close(fight, ctx);
  destroy_empty(lobby);
}

/// Leave BEFORE the fight starts — a full pledge refund (no cut was taken). After start, the
/// only exit is losing the fight (settle).
public(package) fun exit(
  lobby: &mut Kolizeum,
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(object::id(fight) == lobby.fight, EWrongFight);
  assert!(fight::in_placement(fight), EWrongFight); // started fights settle, never exit
  transfer::public_transfer(coin::take(&mut lobby.pot, lobby.pledge, ctx), ctx.sender());
  fight::forfeit(fight, fighter_idx, kiosk, cap, policy, clock, ctx);
  fight::set_placement_clock(fight, 0);
}

/// Final placement participant: refund and return the character, then consume both empty
/// managed objects. Other participants exit through `exit` independently.
public(package) fun exit_last(
  mut lobby: Kolizeum,
  mut fight: Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  fight::assert_last_live_player(&fight, fighter_idx, ctx);
  // the lobby/fight pairing (EWrongFight) is asserted inside `exit`
  exit(&mut lobby, &mut fight, fighter_idx, kiosk, cap, policy, clock, ctx);
  assert!(lobby.pot.value() == 0, ENotEmpty);
  fight::close(fight, ctx);
  destroy_empty(lobby);
}

/// Forfeit a STARTED fight — leave and abandon all claim to the pot (no refund; that is `exit`,
/// placement-only). The stalemate escape (owner 2026-08-11): nobody is ever stuck — a leaver
/// empties their seat, the other side wins, `settle` pays the pot; the forfeited pledge stays in
/// for the winners. Gated to WAGERED fights so a dungeon room can't be forfeited off its own door.
public(package) fun forfeit(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  assert!(fight::is_wagered(fight), ENotWagered);
  assert!(!fight::in_placement(fight), EWrongFight);
  fight::forfeit(fight, fighter_idx, kiosk, cap, policy, clock, ctx);
}

#[test_only]
public(package) fun assert_forfeit_phase_for_testing(placement: bool) {
  assert!(!placement, EWrongFight);
}

/// Recovery for an already-settled managed fight. Both linked objects are consumed together;
/// pot-only public sweeping is intentionally impossible.
public(package) fun close(lobby: Kolizeum, fight: Fight, ctx: &TxContext) {
  assert!(object::id(&fight) == lobby.fight, EWrongFight);
  assert!(lobby.pot.value() == 0, ENotEmpty);
  fight::close(fight, ctx);
  destroy_empty(lobby);
}

fun destroy_empty(lobby: Kolizeum) {
  let Kolizeum { id, pot, .. } = lobby;
  pot.destroy_zero();
  id.delete();
}

fun placement_clock(format: u64, side_a: u64, side_b: u64, now: u64): u64 {
  if (side_a == format && side_b == format) now else 0
}

#[test_only]
public(package) fun placement_clock_for_testing(format: u64, side_a: u64, side_b: u64, now: u64): u64 {
  placement_clock(format, side_a, side_b, now)
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// gate_character
/// A joiner/creator must be within the level range and NOT rooted (a gather-time root or a
/// fired protector verdict holds them — arena joins are travel-free, so we gate it here, the
/// same escape the recall-potion exploit taught us).
fun gc(kiosk: &Kiosk, cap: &KioskOwnerCap, character_id: ID, level_min: u16, level_max: u16, clock: &Clock) {
  let chr: &Character = kiosk.borrow(cap, character_id);
  let lvl = chr.level();
  assert!(lvl >= level_min && lvl <= level_max, ELevelOutOfRange);
  assert!(!world::is_rooted(chr, clock), ERooted);
  assert!(!dungeon::has_run(chr), ERooted);
}

#[test_only]
public(package) fun creator_allowed_for_testing(initial: vector<address>, creator: address): bool {
  let mut entries = vec_set::empty();
  let mut i = 0;
  while (i < initial.length()) {
    let entry = initial[i];
    if (!entries.contains(&entry)) entries.insert(entry);
    i = i + 1;
  };
  let mut allowed = option::some(entries);
  let frozen = allowed.borrow_mut();
  if (!frozen.contains(&creator)) frozen.insert(creator);
  allowed.borrow().contains(&creator)
}
