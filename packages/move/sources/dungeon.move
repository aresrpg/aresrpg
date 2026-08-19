// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEONS — a sequence of authored room fights, the last carrying a boss (owner 2026-08-11).
/// The whole thing is a THIN coordinator over the existing systems — custody, the fight
/// machine, the root pattern, world content — not a new engine:
///   · the ROOMS are authored on the World (`dungeon_rooms`), sealed with the corpus;
///   · the PORTAL is a pure zone-seed derivation (`zone::portal_of`, 10%), no stored state;
///   · the RUN state is ONE DF on the character `{ world, room, x, z }` — it rides into fight
///     custody and back, exactly like the gather verdict; whether you are STAGING or FIGHTING
///     is encoded by WHERE your character is (kiosk vs the fight's dof), never a stored flag;
///   · between rooms the character is ROOTED (a far-future checkpoint) — the only legal acts
///     are engage-next-room and give-up, like uncollected gathering;
///   · each room is a NORMAL fight with NORMAL loot; the boss is just a rich-table mob in the
///     last room, so the "goal is the boss's loot" needs zero new loot code.
/// A room can never be fought twice: `engage` needs the character in the kiosk (custody makes
/// double-engage impossible), and only `settle_room` advances the counter — the api refuses a
/// raw settle/forfeit/join on a dungeon fight, so there is no farm path.
module aresrpg::dungeon;

use aresrpg::{
  character::{Self, Character},
  fight::{Self, Fight, FightBuild},
  item::{Self, Item},
  party::Party,
  protected_policy::AresRPG_TransferPolicy,
  world::{Self, World},
  zone,
};
use aresrpg_math::{prng, world_map};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event, kiosk::{Kiosk, KioskOwnerCap}, transfer_policy::TransferPolicy};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENoPortal: u64 = 2701; // no dungeon portal in this searched zone
const EWrongKey: u64 = 2702; // the burned item is not this world's dungeon key
const EAlreadyInRun: u64 = 2703; // the character already holds a live run
const ENoRun: u64 = 2704; // the character holds no run
const EWrongRoom: u64 = 2705; // join/settle: your run is not at the fight's room
const EWrongWorld: u64 = 2706; // the fight/run world mismatch
const ENotDungeonFight: u64 = 2707; // settle/give-up: this fight is not a dungeon room

/// The between-rooms root: far enough that only a dungeon door ever unroots (~100 years).
const ROOT_BETWEEN_ROOMS_MS: u64 = 3_153_600_000_000;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// DF key on the character → its live run. Present = in a dungeon; absent = free.
public struct DungeonRunKey() has copy, drop, store;

public struct DungeonRun has copy, drop, store {
  world: String,
  room: u64, // 1-based; the room you are staged at / fighting
  x: u32, // the portal — the fight location and where you return on exit
  z: u32,
  seed: u64, // random, committed at ENTER (key-gated) — each room's board derives from it, so a
  // room's shape is unpredictable and NOT caller-chosen; rerolling costs a fresh key (audit 2026-08-11)
}

public struct DungeonEntered has copy, drop { character: ID, world: String, x: u32, z: u32 }

public struct DungeonRoomCleared has copy, drop { character: ID, world: String, room: u64 }

public struct DungeonEnded has copy, drop { character: ID, world: String, room: u64, won: bool }

// ╔════════════════ [ Enter (burn the key at the portal) ] ═══════════════════ ]

/// Consume the world's dungeon key at a live portal: prove the walk there, burn ONE key unit,
/// write the run at room 1, and ROOT the character — from here the only acts are engage-next
/// or give-up. Does NOT start a fight (the client shows a staging room with the mob group).
public(package) fun enter(
  w: &World,
  protected_item: &AresRPG_TransferPolicy<Item>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  zx: u32,
  zz: u32,
  key_id: ID,
  seed: u64, // the run's random board seed — drawn by the api from &Random (terminal, key-gated)
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let (present, px, pz) = zone::portal_of(w, zx, zz);
  assert!(present, ENoPortal);
  assert!(!has_run(kiosk.borrow(cap, character_id)), EAlreadyInRun);

  // the burned item must be THIS world's dungeon key (its item_type pins it exactly)
  let key_type = { let it: &Item = kiosk.borrow(cap, key_id); it.item_type() };
  assert!(world_map::dungeon_key(world::content(w)) == option::some(key_type), EWrongKey);
  item::burn(kiosk, cap, protected_item, key_id, 1, ctx);

  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  let current = world::prove_move(chr, px, pz, clock); // walk to the portal (not yet rooted)
  assert!(current == w.name(), EWrongWorld);
  wr(chr, DungeonRun { world: w.name(), room: 1, x: px, z: pz, seed });
  world::delay_checkpoint(chr, ROOT_BETWEEN_ROOMS_MS, clock); // captive between rooms
  event::emit(DungeonEntered { character: character_id, world: w.name(), x: px, z: pz });
}

// ╔════════════════ [ Engage / join a room fight ] ═══════════════════════════ ]

/// Engage the run's current room: births the room fight (your access setting, the room's
/// authored mobs, `board_seed` shapes) and returns the build potato — `add_mob` × the room's
/// mobs, then `launch`. No travel proof (you are staged at the portal, rooted).
public(package) fun engage_room(
  w: &World,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  access: u8,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  let (rworld, room, x, z, seed) = rr(kiosk.borrow(cap, character_id));
  assert!(rworld == w.name(), EWrongWorld);
  // the board is DERIVED from the run's committed seed + room — unpredictable, not caller-chosen
  let board_seed = prng::mix(seed, room);
  fight::dungeon_build(protected, kiosk, cap, character_id, w, x, z, board_seed, room, access, clock, ctx)
}

/// Join a PUBLIC room fight whose room matches your run (your key at the same room). Reuses
/// the generic `fight::join` with `travel=false` (staged at the portal, side A the players).
public(package) fun join_room(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  gj(fight, kiosk.borrow(cap, character_id));
  fight::join(fight, protected, kiosk, cap, character_id, 0, 0, false, clock, ctx);
}

/// Join a GROUP-locked room fight — the opener's party gates it (generic `join_grouped`).
public(package) fun join_room_grouped(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  shared_party: &Party,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  gj(fight, kiosk.borrow(cap, character_id));
  fight::join_grouped(fight, protected, kiosk, cap, character_id, 0, shared_party, false, clock, ctx);
}

// gate_join
/// The joiner's run must be the same DUNGEON (world) and the same ROOM as the fight — the
/// portal is only the entrance (owner 2026-08-11: the dungeon is the same for every portal;
/// rooms are fake, coord-less, all same-room players converge whichever portal they took).
fun gj(fight: &Fight, chr: &Character) {
  let (rworld, room, _, _, _) = rr(chr);
  assert!(fight::dungeon_room_of(fight) == option::some(room), EWrongRoom);
  assert!(fight::fight_world(fight) == rworld, EWrongWorld);
}

// ╔════════════════ [ Settle / give up ] ═════════════════════════════════════ ]

/// Leave an ENDED room fight: settle (character + normal loot back to the kiosk), then either
/// ADVANCE the run (won and more rooms remain — re-root, next staging) or END it (won the
/// last room, or lost). The key is already gone; ending just drops the run and unroots.
public(package) fun settle_room(
  w: &World,
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  gen: &mut sui::random::RandomGenerator,
  clock: &Clock,
  ctx: &TxContext,
) {
  // the run to advance is DERIVED from the settled seat, and the fight must be a real dungeon
  // room — never a free character id pointed at another character's run (audit 2026-08-11).
  let tag_room = dt(fight);
  let character_id = fight::fighter_character(fight, fighter_idx);
  let won = fight::fighter_won(fight, fighter_idx);
  fight::settle(fight, fighter_idx, kiosk, cap, policy, gen, clock, ctx);

  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  let (rworld, room, x, z, seed) = rr(chr);
  assert!(rworld == w.name() && room == tag_room, EWrongRoom);
  if (won && room < world_map::dungeon_room_count(world::content(w))) {
    wr(chr, DungeonRun { world: rworld, room: room + 1, x, z, seed }); // seed persists
    world::delay_checkpoint(chr, ROOT_BETWEEN_ROOMS_MS, clock); // staged for the next room
    event::emit(DungeonRoomCleared { character: character_id, world: rworld, room });
  } else {
    er(chr, clock);
    event::emit(DungeonEnded { character: character_id, world: rworld, room, won });
  };
}

/// Give up the current room mid-fight: forfeit (character → kiosk at 1 hp) and END the run.
/// The run is derived from the forfeited seat — never a free id.
public(package) fun give_up_room(
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  let tag_room = dt(fight);
  let character_id = fight::fighter_character(fight, fighter_idx);
  fight::forfeit(fight, fighter_idx, kiosk, cap, policy, clock, ctx);
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  let (rworld, room, _, _, _) = rr(chr);
  assert!(room == tag_room, EWrongRoom);
  er(chr, clock);
  event::emit(DungeonEnded { character: character_id, world: rworld, room, won: false });
}

// dungeon_tag
/// The fight's dungeon room tag — aborts if the fight is not a dungeon room at all.
fun dt(fight: &Fight): u64 {
  let tag = fight::dungeon_room_of(fight);
  assert!(tag.is_some(), ENotDungeonFight);
  *tag.borrow()
}

/// Abandon a run while STAGING (entered, no live room fight): drop it and unroot. The key is
/// already gone. (Mid-fight, use `give_up_room`.)
public(package) fun abandon_run(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  clock: &Clock,
) {
  let chr: &mut Character = kiosk.borrow_mut(cap, character_id);
  let (rworld, room, _, _, _) = rr(chr);
  er(chr, clock);
  event::emit(DungeonEnded { character: character_id, world: rworld, room, won: false });
}

// ╔════════════════ [ Run DF plumbing ] ══════════════════════════════════════ ]

public fun has_run(chr: &Character): bool { dfield::exists(chr.uid(), DungeonRunKey()) }

// read_run
fun rr(chr: &Character): (String, u64, u32, u32, u64) {
  let uid = chr.uid();
  assert!(dfield::exists(uid, DungeonRunKey()), ENoRun);
  let r: &DungeonRun = dfield::borrow(uid, DungeonRunKey());
  (r.world, r.room, r.x, r.z, r.seed)
}

// write_run
fun wr(chr: &mut Character, run: DungeonRun) {
  let uid = chr.uid_mut();
  if (dfield::exists(uid, DungeonRunKey())) {
    *dfield::borrow_mut(uid, DungeonRunKey()) = run;
  } else {
    dfield::add(uid, DungeonRunKey(), run);
  }
}

// end_run
/// End a run: remove the DF and unroot (checkpoint back to now, at the portal).
fun er(chr: &mut Character, clock: &Clock) {
  let uid = chr.uid_mut();
  let DungeonRun { .. } = dfield::remove(uid, DungeonRunKey());
  world::delay_checkpoint(chr, 0, clock);
}
