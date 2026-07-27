// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SETTLEMENT — the engine's RESOLUTION half of claims v2 (S-46 final split): `settle_and_destroy` is
/// PERMISSIONLESS once terminal — it mints ONE soulbound `FightOutcome` per seat (`key` only: untradeable,
/// unwrappable) to the seat's owner and deletes the shared Fight in the SAME call. The outcome ECHOES the
/// fight's witness BRAND: the consumer package (core) asserts the echoed TypeName equals its own witness at
/// claim — compile-time self-authentication, zero stored bindings. Loot/XP/dirty WRITES stay consumer-side:
/// the outcome carries every ROLL INPUT the consumer's claim needs (loot rows × mob_count, the seat's chance,
/// the aging + multiplier SNAPSHOTS), never pre-rolled results — the roll happens in the consumer package's own
/// terminal `&Random` tx, so a settler cannot grind settlement entropy.
///
/// MULTIPLIER SNAPSHOTS: xp/loot multipliers are FIGHT-CREATE snapshots (they ride the Fight — the consumer
/// passed them in Dials), because this permissionless entry can trust no caller-supplied dial. Anti-parking
/// (§8) holds: outcomes never expire and never sample live dials.
///
/// U6 SWEEP COMPATIBILITY: the permissionless sweep currently accepts only the expiry proof authenticated by
/// the frozen Fight itself: exact PLACEMENT status, its immutable placement deadline reached, and zero ready
/// seats. ACTIVE reclaim needs an authenticated reclaim-duration snapshot, but neither the frozen Fight/Dials
/// layouts nor this package's dependency surface contains that core config value. A caller-supplied duration is
/// deliberately rejected as forgeable; the active branch must remain absent until an additive authenticated
/// config adapter exists. BRAND LAW: sweep events expose only AresRPG fight identity and numeric state.
module aresrpg_fight::settlement;

use aresrpg_fight::{
  action_envelope, cast, displacement, fight::{Self, Fight}, fight_events, mob::MobLootEntry, participant,
  fight_registry::{Self, FightRegistry}, retro_effects, turns, version::Version
};
use aresrpg_foundation::spell;
use std::type_name::TypeName;
use sui::clock::Clock;

const ENotTerminal: u64 = 101; // settle: the fight is still in placement/active (crank it to terminal first)
const ENoSuchSeat: u64 = 102; // settle_and_take: no seat for the requested character in this fight
const ENotSeatOwner: u64 = 103; // settle_and_take: the requested seat belongs to another wallet
const ENotSweepable: u64 = 104; // sweep: exact placement status required (active/terminal fights are live here)
const ENotExpired: u64 = 105; // sweep: immutable placement deadline has not arrived
const EReadySeat: u64 = 106; // sweep: any ready seat is engagement evidence; force_start owns that cleanup path

const BP_ONE: u64 = 10_000; // 100.00%

// ╔════════════════ [ Type ] ═════════════════════════════════════════════════ ]

/// One seat's settled outcome — SOULBOUND (`key` only), brand-echoing. The consumer package consumes it at its
/// claim door (`unpack`), asserts the brand, and owns everything after (write-backs, loot roll, minting).
public struct FightOutcome has key {
  id: UID,
  brand: TypeName, // the creating witness — the consumer's claim asserts it equals its own
  fight: ID,
  world: ID,
  character: ID,
  outcome: u8, // fight::status_victory() | fight::status_defeat()
  final_hp: u64,
  xp_share: u64, // wisdom/aging/multiplier applied at settlement (multiplier = the create-time snapshot)
  aged_bp: u64,
  chance: u64, // the seat's chance stat at settlement (loot-roll input)
  // How many times the `loot` checklist repeats at claim (`results::open`). It IS the mob count for a
  // single-spec pack — one table, once per dead mob. A MIXED pack (#1110) ships its members' tables
  // concatenated and repeats them ONCE: same law, every dead mob rolls its own table exactly once.
  mob_count: u64,
  loot: vector<MobLootEntry>, // the loot-roll checklist (empty on defeat)
  pvp: bool, // §17.9 ephemeral fight: the consumer must NEVER write HP/XP back for these
  team: u8, // the seat's team (0 = PvM party side)
  winner_team: Option<u8>, // the fight's winner at settlement — any single outcome proves the whole result
  loot_mult: u64, // §8 anti-parking: the loot-multiplier SNAPSHOT (create-time; claims never sample live dials)
}

// ╔════════════════ [ Settle (permissionless — mint outcomes, delete the Fight) ] ═ ]

/// Settle a TERMINAL fight: one soulbound `FightOutcome` per seat → its owner, then the shared Fight is
/// deleted. Anyone may call (the storage rebate is the janitor's tip); the caller gets nothing else. XP is
/// computed HERE (wisdom is a per-seat stat; the multiplier is the create-time snapshot on the Fight).
entry fun settle_and_destroy(fight: Fight, version: &Version, ctx: &mut TxContext) {
  settle_core(fight, version, option::none(), ctx).destroy_none();
}

/// Permissionless janitor for an abandoned PLACEMENT fight. The three guards are all fight-authenticated and
/// deliberately conjunctive: exact placement status rejects active/terminal fights, the immutable deadline
/// supplies expiry, and ANY ready seat rejects the sweep. Successful cleanup is auto-abandon for every seat,
/// then the ordinary terminal settlement path mints defeat outcomes and releases every registry latch.
entry fun sweep_fight(mut fight: Fight, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_enabled();
  assert!(fight::status(&fight) == fight::status_placement(), ENotSweepable);
  assert!(clock.timestamp_ms() >= fight::placement_deadline_ms(&fight), ENotExpired);
  assert!(no_ready_seats(&fight), EReadySeat);

  let fid = fight::id(&fight);
  let seats = fight::participant_count(&fight);
  let mut i = 0;
  while (i < seats) {
    let (character, hp) = {
      let p = fight::participants(&fight).borrow(i);
      (participant::character(p), participant::hp(p))
    };
    participant::apply_damage(fight::participants_mut(&mut fight).borrow_mut(i), hp);
    fight_events::emit_abandoned(fid, character, i);
    i = i + 1;
  };
  turns::finish_defeat(&mut fight);
  fight_events::emit_swept(fid);
  settle_core(fight, version, option::none(), ctx).destroy_none();
}

fun no_ready_seats(fight: &Fight): bool {
  let seats = fight::participant_count(fight);
  let mut i = 0;
  while (i < seats) {
    if (participant::is_ready(fight::participants(fight).borrow(i))) return false;
    i = i + 1;
  };
  true
}

/// Settle AND TAKE the caller's own seat's outcome BY VALUE — the PTB-composition door (PTB-first law): one tx
/// chains `settle_and_take → (a consumer's &outcome read: dungeon settle_run / kolizeum settle)? → the
/// consumer's open`, making the historical two-tx settle→open gap (the 2026-07-10 stranded-outcome wedge)
/// unreachable for the active player. Every OTHER seat's outcome transfers exactly as `settle_and_destroy`.
/// The caller MUST own the requested seat: `unpack` is possession-gated — without this assert a stranger could
/// take a victim's outcome by value and unpack-destroy it (XP/loot burned, fight-marker latched forever).
public fun settle_and_take(fight: Fight, character: ID, version: &Version, ctx: &mut TxContext): FightOutcome {
  let taken = settle_core(fight, version, option::some(character), ctx);
  assert!(taken.is_some(), ENoSuchSeat);
  taken.destroy_some()
}

/// The ONE settlement body (entry janitor + take door are thin shells): mints per seat, transfers every seat's
/// outcome to its owner EXCEPT the `take_character` seat (ownership-asserted, handed back by value), unlatches,
/// deletes the Fight.
/// RELEASE the seat's in-fight latch. Settlement cannot do this itself: the latch authority is the CHARACTER's
/// shard (one per seat, and Move takes no vector of `&mut`), while settlement holds only the fight. The outcome
/// is the proof — it exists only because `settle_core` ran, and it names the brand and character whose latch it
/// frees. Possession-gated by being an owned object, so a seat frees its own.
///
/// Landing the release at the OPEN rather than the settle is the rule this codebase already runs on the consumer
/// side: an unopened result keeps its obligation, so a defeated player cannot dodge the landing by walking away.
public fun release_latch(registry: &mut FightRegistry, outcome: &FightOutcome) {
  fight_registry::unlatch_character(registry, outcome.brand, outcome.character);
}

/// Run every owner module's field reclaim before the Fight dies. THE storage-rebate door: `object::delete` does
/// not track dynamic fields (S-07), so a family missing from this list is orphaned in storage forever and its
/// deposit is never rebated — the janitor's tip shrinks by exactly that much. One line per module that writes
/// onto the Fight UID; `fight::destroy` handles the two families that module owns itself.
fun sweep_fields(fight: &mut Fight) {
  cast::sweep_fields(fight);
  retro_effects::sweep_fields(fight);
  displacement::sweep_fields(fight);
  action_envelope::sweep_fields(fight);
}

fun settle_core(mut fight: Fight, version: &Version, take_character: Option<ID>, ctx: &mut TxContext): Option<FightOutcome> {
  version.assert_enabled();
  let status = fight::status(&fight);
  let won = status == fight::status_victory();
  assert!(won || status == fight::status_defeat(), ENotTerminal);

  let fid = fight::id(&fight);
  let brand = fight::brand(&fight);
  let world = fight::world(&fight);
  let aged_bp = fight::aged_bp(&fight);
  let mob_count = fight::mob_count(&fight);
  let party = fight::participant_count(&fight);
  // XP is the SUM of what each seated mob is worth (#1110 — a mixed pack's members are different species). For a
  // single-spec fight every index reads the shared block, so this is `group_xp × mob_count` exactly, unchanged.
  let total_xp = {
    let (mut acc, mut j) = (0, 0);
    while (j < mob_count) { acc = acc + fight::content_xp(fight::member_content(&fight, j)); j = j + 1; };
    acc
  };
  // THE LOOT CHECKLIST + how many times it repeats (`results::open` rolls `loot` × `mob_count`). One law, two
  // encodings: every dead mob rolls ITS OWN table exactly once. A mono pack ships one table × N mobs (unchanged
  // bytes, unchanged storage); a mixed pack ships its members' tables concatenated × 1.
  let (group_loot, loot_repeats) = if (fight::is_mixed(&fight)) {
    let (mut rows, mut j) = (vector[], 0);
    while (j < mob_count) { rows.append(*fight::content_loot(fight::member_content(&fight, j))); j = j + 1; };
    (rows, 1)
  } else {
    (*fight::group_loot(&fight), mob_count)
  };
  let xp_mult = fight::xp_mult(&fight); // create-time snapshot (see module doc)
  // §17.9: PvP fights are EPHEMERAL — per-seat outcome is THEIR TEAM vs winner_team, and outcomes carry
  // zero xp + zero loot (the consumer's pot is the prize; the real character is never wounded or rewarded here).
  let pvp = fight::mode(&fight) == fight::mode_pvp();
  let winner = fight::winning_side(&fight);
  let loot_mult = fight::loot_mult(&fight); // create-time snapshot into every outcome (anti-parking)

  let mut taken: Option<FightOutcome> = option::none();
  let mut i = 0;
  while (i < party) {
    let p = fight::participants(&fight).borrow(i);
    let (chance, wisdom) = { let s = participant::stats(p); (spell::stat_chance(s), spell::stat_wisdom(s)) };
    let seat_won = if (pvp) winner.is_some() && participant::team(p) == *winner.borrow() else won;
    let o = FightOutcome {
      id: object::new(ctx),
      brand,
      fight: fid,
      world,
      character: participant::character(p),
      outcome: if (seat_won) fight::status_victory() else fight::status_defeat(),
      final_hp: participant::hp(p),
      xp_share: if (seat_won && !pvp) xp_share_kernel(total_xp, party, wisdom, aged_bp, xp_mult) else 0,
      aged_bp,
      chance,
      mob_count: loot_repeats,
      loot: if (seat_won && !pvp) group_loot else vector[],
      pvp,
      team: participant::team(p),
      winner_team: winner,
      loot_mult,
    };
    fight_events::emit_result_minted(object::id(&o), fid, participant::character(p), participant::owner(p), o.outcome, o.xp_share, o.final_hp);
    if (take_character.is_some() && *take_character.borrow() == participant::character(p)) {
      assert!(participant::owner(p) == ctx.sender(), ENotSeatOwner);
      taken.fill(o);
    } else {
      transfer::transfer(o, participant::owner(p));
    };
    i = i + 1;
  };
  fight_events::emit_settled(fid, status, party);
  sweep_fields(&mut fight);
  fight::destroy(fight);
  taken
}

// ╔════════════════ [ XP kernel (pure — harvested /600, aging-scaled) ] ═══════ ]

/// The XP share: flat-split by party, wisdom-boosted ×(600+wisdom)/600, aging ×(10000+aged_bp)/10000, ×mult/100.
public fun xp_share_kernel(total_xp: u64, party_size: u64, wisdom: u64, aged_bp: u64, xp_mult: u64): u64 {
  if (party_size == 0) return 0;
  total_xp / party_size * (600 + wisdom) / 600 * (BP_ONE + aged_bp) / BP_ONE * xp_mult / 100
}

// ╔════════════════ [ Consume + reads (the consumer's claim surface) ] ════════ ]

/// UNPACK an outcome — possession-gated (the object was minted to the seat owner; only its owner can pass it by
/// value). Returns EVERYTHING the consumer's claim needs, brand first: the consumer MUST assert the brand equals
/// its own witness TypeName before honoring any field. Returns:
/// (brand, fight, world, character, outcome, final_hp, xp_share, aged_bp, chance, mob_count, loot, pvp, team, winner_team, loot_mult)
public fun unpack(o: FightOutcome): (TypeName, ID, ID, ID, u8, u64, u64, u64, u64, u64, vector<MobLootEntry>, bool, u8, Option<u8>, u64) {
  let FightOutcome { id, brand, fight, world, character, outcome, final_hp, xp_share, aged_bp, chance, mob_count, loot, pvp, team, winner_team, loot_mult } = o;
  object::delete(id);
  (brand, fight, world, character, outcome, final_hp, xp_share, aged_bp, chance, mob_count, loot, pvp, team, winner_team, loot_mult)
}

public fun brand(o: &FightOutcome): TypeName { o.brand }
public fun outcome(o: &FightOutcome): u8 { o.outcome }
public fun final_hp(o: &FightOutcome): u64 { o.final_hp }
public fun xp_share(o: &FightOutcome): u64 { o.xp_share }
public fun is_pvp(o: &FightOutcome): bool { o.pvp }
public fun team(o: &FightOutcome): u8 { o.team }
/// THE outcome oracle for consumers: some(team) = that side won; none = draw / PvM defeat.
public fun winner_team(o: &FightOutcome): Option<u8> { o.winner_team }
public fun character(o: &FightOutcome): ID { o.character }
public fun fight_id(o: &FightOutcome): ID { o.fight }
public fun world(o: &FightOutcome): ID { o.world }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Mint a raw outcome (unit fixtures for consumer-side claim tests live consumer-side; engine tests use this).
public fun outcome_for_testing(
  brand: TypeName, fight: ID, world: ID, character: ID, outcome: u8, final_hp: u64, xp_share: u64,
  aged_bp: u64, chance: u64, mob_count: u64, loot: vector<MobLootEntry>, pvp: bool, team: u8,
  winner_team: Option<u8>, loot_mult: u64, ctx: &mut TxContext,
): FightOutcome {
  FightOutcome { id: object::new(ctx), brand, fight, world, character, outcome, final_hp, xp_share, aged_bp, chance, mob_count, loot, pvp, team, winner_team, loot_mult }
}
