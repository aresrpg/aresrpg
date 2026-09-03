// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEONS — independent authored room compositions entered through a WorldContent city.
/// This is a thin coordinator over custody, the ordinary fight machine, the root pattern,
/// WorldContent, and DungeonContent—not a second combat engine:
///   · DungeonContent owns the stable slug, key, and ordered room compositions;
///   · WorldContent owns the city anchor that references the dungeon slug;
///   · the RUN state is one DF on the character `{ dungeon, room, seed }`; whether the player is
///     staging or fighting derives from custody (kiosk vs Fight dynamic object field);
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
};
use aresrpg_seed::{
  board_catalog::BoardCatalog,
  dungeon_content::{Self, DungeonContent},
  world_content::{Self, WorldContent},
};
use aresrpg_math::{city_map::{Self, City}, dungeon_data, prng, world_map};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event, object, kiosk::{Kiosk, KioskOwnerCap}, transfer_policy::TransferPolicy};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const ENoPortal: u64 = 2701; // the world has no city entrance for this dungeon
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
  dungeon: String,
  room: u64, // 1-based; the room you are staged at / fighting
  seed: u64, // random, committed at ENTER (key-gated) — each room's board derives from it, so a
  // room's shape is unpredictable and NOT caller-chosen; rerolling costs a fresh key (audit 2026-08-11)
}

public struct DungeonEntered has copy, drop { character: ID, world: String, x: u32, z: u32 }

public struct DungeonRoomCleared has copy, drop { character: ID, world: String, room: u64 }

public struct DungeonEnded has copy, drop { character: ID, world: String, room: u64, won: bool }

fun dungeon_city(world: &World, content: &WorldContent, dungeon: &DungeonContent): City {
  assert!(world_content::name(content) == world.name(), EWrongWorld);
  let city = city_map::city_for_dungeon(&world_map::cities(world_content::data(content)), object::id(dungeon));
  assert!(city.is_some(), ENoPortal);
  *city.borrow()
}

// ╔════════════════ [ Enter (burn the key at the portal) ] ═══════════════════ ]

/// Consume the world's dungeon key at a live portal: prove the walk there, burn ONE key unit,
/// write the run at room 1, and ROOT the character — from here the only acts are engage-next
/// or give-up. Does NOT start a fight (the client shows a staging room with the mob group).
public(package) fun enter(
  world_object: &World,
  world_content: &WorldContent,
  dungeon: &DungeonContent,
  protected_item: &AresRPG_TransferPolicy<Item>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  key_id: ID,
  seed: u64, // the run's random board seed — drawn by the api from &Random (terminal, key-gated)
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let city = dungeon_city(world_object, world_content, dungeon);
  let portal_x = city_map::x(&city);
  let portal_z = city_map::z(&city);
  assert!(!has_run(kiosk.borrow(cap, character_id)), EAlreadyInRun);

  // the burned item must be THIS world's dungeon key (its item_type pins it exactly)
  let key_type = { let item: &Item = kiosk.borrow(cap, key_id); item.item_type() };
  assert!(dungeon_data::key(dungeon_content::data(dungeon)) == key_type, EWrongKey);
  item::burn(kiosk, cap, protected_item, key_id, 1, ctx);

  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  let current_world = world::prove_move(character, portal_x, portal_z, clock);
  assert!(current_world == world_object.name(), EWrongWorld);
  write_run(character, DungeonRun { dungeon: dungeon_content::name(dungeon), room: 1, seed });
  world::delay_checkpoint(character, ROOT_BETWEEN_ROOMS_MS, clock);
  event::emit(DungeonEntered {
    character: character_id, world: world_object.name(), x: portal_x, z: portal_z,
  });
}

// ╔════════════════ [ Engage / join a room fight ] ═══════════════════════════ ]

/// Engage the run's current room: births the room fight (your access setting, the room's
/// authored mobs, `board_seed` shapes) and returns the build potato — `add_mob` × the room's
/// mobs, then `launch`. No travel proof (you are staged at the portal, rooted).
public(package) fun engage_room(
  world_object: &World,
  world_content: &WorldContent,
  dungeon: &DungeonContent,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  let (run_dungeon, room, seed) = read_run(kiosk.borrow(cap, character_id));
  assert!(run_dungeon == dungeon_content::name(dungeon), EWrongRoom);
  let city = dungeon_city(world_object, world_content, dungeon);
  let x = city_map::x(&city);
  let z = city_map::z(&city);
  // the board is DERIVED from the run's committed seed + room — unpredictable, not caller-chosen
  let board_seed = prng::mix(seed, room);
  fight::dungeon_build(
    protected, kiosk, cap, character_id, world_object, dungeon, x, z, board_seed, room, access,
    catalog, clock, ctx,
  )
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
  assert_same_dungeon_room(fight, kiosk.borrow(cap, character_id));
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
  assert_same_dungeon_room(fight, kiosk.borrow(cap, character_id));
  fight::join_grouped(fight, protected, kiosk, cap, character_id, 0, shared_party, false, clock, ctx);
}

// gate_join
/// The joiner's run must be the same DUNGEON (world) and the same ROOM as the fight — the
/// portal is only the entrance; rooms are fake and coord-less, so the chain permits same-room
/// players to converge whichever portal they took.
fun assert_same_dungeon_room(fight: &Fight, character: &Character) {
  let (run_dungeon, run_room, _) = read_run(character);
  let tag = dungeon_tag(fight);
  gate_join_scope(fight::dungeon_name(&tag), fight::dungeon_room(&tag), run_dungeon, run_room);
  assert!(fight::fight_world(fight) == world::current_world(character), EWrongWorld);
}

fun gate_join_scope(fight_dungeon: String, fight_room: u64, run_dungeon: String, run_room: u64) {
  assert!(fight_dungeon == run_dungeon && fight_room == run_room, EWrongRoom);
}

/// Test seam over the production join scope. Coordinates are accepted only to prove they are
/// deliberately irrelevant: the chain dungeon is WORLD + ROOM, never the entry portal.
#[test_only]
public(package) fun join_scope_for_testing(
  fight_dungeon: String,
  fight_room: u64,
  _fight_x: u32,
  _fight_z: u32,
  run_dungeon: String,
  run_room: u64,
  _run_x: u32,
  _run_z: u32,
) {
  gate_join_scope(fight_dungeon, fight_room, run_dungeon, run_room);
}

// ╔════════════════ [ Settle / give up ] ═════════════════════════════════════ ]

/// Leave an ENDED room fight: settle (character + normal loot back to the kiosk), then either
/// ADVANCE the run (won and more rooms remain — re-root, next staging) or END it (won the
/// last room, or lost). The key is already gone; ending just drops the run and unroots.
public(package) fun settle_room(
  dungeon: &DungeonContent,
  fight: &mut Fight,
  fighter_idx: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<item::Item>,
  plan: vector<item::PM>,
  generator: &mut sui::random::RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // the run to advance is DERIVED from the settled seat, and the fight must be a real dungeon
  // room — never a free character id pointed at another character's run (audit 2026-08-11).
  let tag = dungeon_tag(fight);
  let tag_dungeon = fight::dungeon_name(&tag);
  let tag_room = fight::dungeon_room(&tag);
  let fight_world = fight::fight_world(fight);
  assert!(dungeon_content::name(dungeon) == tag_dungeon, EWrongRoom);
  let character_id = fight::fighter_character(fight, fighter_idx);
  let won = fight::fighter_won(fight, fighter_idx);
  let (run_dungeon, run_room, run_seed) = read_run(fight::fighter_character_ref(fight, fighter_idx));
  assert!(run_dungeon == tag_dungeon && run_room == tag_room, EWrongRoom);
  let room_count = dungeon_data::room_count(dungeon_content::data(dungeon));
  fight::settle(fight, fighter_idx, kiosk, cap, policy, item_policy, plan, generator, clock, ctx);

  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  if (won && run_room < room_count) {
    write_run(character, DungeonRun { dungeon: run_dungeon, room: run_room + 1, seed: run_seed });
    world::delay_checkpoint(character, ROOT_BETWEEN_ROOMS_MS, clock);
    event::emit(DungeonRoomCleared { character: character_id, world: fight_world, room: run_room });
  } else {
    end_run(character, clock);
    event::emit(DungeonEnded { character: character_id, world: fight_world, room: run_room, won });
  };
}

/// Same-kiosk batch variant used by invisible multi-character reward collection.
public(package) fun settle_many_rooms(
  dungeon: &DungeonContent,
  fight: &mut Fight,
  mut fighters: vector<u64>,
  mut plan_lengths: vector<u64>,
  mut plan: vector<item::PM>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<item::Item>,
  generator: &mut sui::random::RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(!fighters.is_empty() && fighters.length() == plan_lengths.length(), EWrongRoom);
  while (!fighters.is_empty()) {
    let mut seat_plan = vector[];
    let mut remaining = plan_lengths.pop_back();
    assert!(remaining <= plan.length(), EWrongRoom);
    while (remaining > 0) {
      seat_plan.push_back(plan.pop_back());
      remaining = remaining - 1;
    };
    settle_room(
      dungeon, fight, fighters.pop_back(), kiosk, cap, policy, item_policy,
      seat_plan, generator, clock, ctx,
    );
  };
  assert!(plan.is_empty(), EWrongRoom);
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
  let tag = dungeon_tag(fight);
  let tag_dungeon = fight::dungeon_name(&tag);
  let tag_room = fight::dungeon_room(&tag);
  let character_id = fight::fighter_character(fight, fighter_idx);
  let (run_dungeon, run_room, _) = read_run(fight::fighter_character_ref(fight, fighter_idx));
  assert!(run_dungeon == tag_dungeon && run_room == tag_room, EWrongRoom);
  let fight_world = fight::fight_world(fight);
  fight::forfeit(fight, fighter_idx, kiosk, cap, policy, clock, ctx);
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  end_run(character, clock);
  event::emit(DungeonEnded { character: character_id, world: fight_world, room: run_room, won: false });
}

// dungeon_tag
/// The fight's dungeon room tag — aborts if the fight is not a dungeon room at all.
fun dungeon_tag(fight: &Fight): fight::DungeonTag {
  let tag = fight::dungeon_tag(fight);
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
  let character: &mut Character = kiosk.borrow_mut(cap, character_id);
  let (_, room, _) = read_run(character);
  let current_world = world::current_world(character);
  end_run(character, clock);
  event::emit(DungeonEnded { character: character_id, world: current_world, room, won: false });
}

// ╔════════════════ [ Run DF plumbing ] ══════════════════════════════════════ ]

public fun has_run(character: &Character): bool { dfield::exists(character.uid(), DungeonRunKey()) }

// read_run
fun read_run(character: &Character): (String, u64, u64) {
  let uid = character.uid();
  assert!(dfield::exists(uid, DungeonRunKey()), ENoRun);
  let run: &DungeonRun = dfield::borrow(uid, DungeonRunKey());
  (run.dungeon, run.room, run.seed)
}

// write_run
fun write_run(character: &mut Character, run: DungeonRun) {
  let uid = character.uid_mut();
  if (dfield::exists(uid, DungeonRunKey())) {
    *dfield::borrow_mut(uid, DungeonRunKey()) = run;
  } else {
    dfield::add(uid, DungeonRunKey(), run);
  }
}

// end_run
/// End a run: remove the DF and unroot (checkpoint back to now, at the portal).
fun end_run(character: &mut Character, clock: &Clock) {
  let uid = character.uid_mut();
  let DungeonRun { .. } = dfield::remove(uid, DungeonRunKey());
  world::delay_checkpoint(character, 0, clock);
}
