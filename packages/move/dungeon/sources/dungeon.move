// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// DUNGEON — the composition layer over the `RunPass` security core (§9 "the key IS the run"). Wires the run
/// lifecycle to items' cap-gated key burn, the game's character world lock + checkpoint, and the fight bridge.
///
/// ┌─ THE FIGHT BRIDGE (no escrow; the pass never leaves its owner) ─────────────────────────────────────────┐
/// │ `next_fight` mints a roster-driven fight for the pass's room and latches the pass to it. The fight address│
/// │ derives from `(pass, room)`, so a party member can re-derive it in `join_fight` and prove same-room.       │
/// │ `settle_run` matches a soulbound FightOutcome against the latch; victory advances (or completes on the    │
/// │ final room), while defeat consumes the pass.                                                             │
/// │ Activation locks the exact character to the pass id with the pinned dungeon brand. Completion, defeat,   │
/// │ and abandon release that same character to its stored source world before consuming the pass.            │
/// └────────────────────────────────────────────────────────────────────────────────────────────────────────┘
module aresrpg_dungeon::dungeon;

use aresrpg::{fight as fight_doors, mob_template::{Self, MobTemplate}, version::Version};
use aresrpg_dungeon::{dungeon_events, run::{Self, RunPass}};
use aresrpg_fight::{
  fight::{Self as engine, Fight, GroupBuild},
  fight_registry::{Self, FightRegistry},
  settlement::{Self, FightOutcome},
  version::Version as FightVersion,
};
use aresrpg::{character_link, checkpoint, config::GameConfig, world::{Self, World}};
use aresrpg::{character::Character, extract::{Self, BurnPledge}, item::Item, version::Version as ItemsVersion};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, kiosk::Kiosk, tx_context::sender};

// ╔════════════════ [ Exit reasons (events) ] ════════════════════════════════ ]

const REASON_ABANDON: u8 = 0;
const REASON_DEFEAT: u8 = 1;
const REASON_COMPLETION: u8 = 2;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ENotInWorld: u64 = 101;
const ENoCheckpoint: u64 = 102;
const ENoDungeon: u64 = 103;
const EWrongKey: u64 = 104;
const EBadRoom: u64 = 105;
const EEmptyRoom: u64 = 106;
const EWrongTemplate: u64 = 107;
const ERoomNotHomogeneous: u64 = 108;
const EWrongRoom: u64 = 109;
const EWrongWorld: u64 = 110;

// ╔════════════════ [ The dungeon brand witness ] ═══════════════════════════ ]

/// Pinned in `GameConfig.dungeon_brand`; core's branded fight/world doors refuse every other witness.
public struct Dungeon has drop {}

// ╔════════════════ [ ACTIVATE — the key IS the run (§9) ] ════════════════════ ]

/// Burn exactly one extracted dungeon-key unit, mint a character-bound pass, and lock the character to it.
public fun activate(
  config: &GameConfig,
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  key: Item,
  key_pledge: BurnPledge,
  items_version: &ItemsVersion,
  version: &Version,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  config.assert_domain(aresrpg::config::domain_dungeon());
  version.assert_enabled();
  let world_id = object::id(world);
  let player = sender(ctx);

  let character = kiosk.borrow<Character>(personal_kiosk::borrow(pkcap), character_id);
  assert!(character_link::in_world(character, world_id), ENotInWorld);
  assert!(character_link::has_checkpoint(character, world_id), ENoCheckpoint);
  let cp = character_link::checkpoint(character, world_id);

  let key_template = world::dungeon_key_template(world);
  assert!(key_template.is_some(), ENoDungeon);
  let (template, amount) = extract::burn(key_pledge, key, items_version);
  assert!(template == *key_template.borrow(), EWrongKey);
  run::assert_single_key_unit(amount);

  let pass_id = run::mint_and_bind(
    world_id, player, checkpoint::x(&cp), checkpoint::z(&cp), character_id, ctx,
  );
  character_link::enter_dungeon_brand(
    Dungeon {}, config, kiosk, pkcap, character_id, pass_id, world_id, items_version,
  );
  dungeon_events::emit_activated(pass_id, world_id, player, character_id);
}

// ╔════════════════ [ NEXT FIGHT — mint a room fight + latch the pass ] ══════ ]

/// Rooms are 1-based on the pass and stored 0-indexed on the world.
public fun roster_for_room(world: &World, room: u16): vector<ID> {
  assert!(room >= 1, EBadRoom);
  world::room_mobs(world::dungeon_room(world, (room as u64) - 1))
}

/// Mint a fresh fight for the pass's current room and latch the activation character to it.
#[allow(lint(public_random))]
public fun next_fight(
  fight_registry: &mut FightRegistry,
  world: &World,
  pass: &mut RunPass,
  mob_tmpl: &MobTemplate,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  fight_version: &FightVersion,
  items_version: &ItemsVersion,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  config.assert_domain(aresrpg::config::domain_dungeon());
  version.assert_enabled();
  run::assert_owner(pass, sender(ctx));
  run::assert_character(pass, character_id);
  assert!(run::world(pass) == object::id(world), EWrongWorld);

  let room = run::room(pass);
  let roster = roster_for_room(world, room);
  assert!(!roster.is_empty(), EEmptyRoom);
  let template_id = *roster.borrow(0);
  assert!(mob_template::template_id(mob_tmpl) == template_id, EWrongTemplate);
  assert_homogeneous(&roster, template_id);
  let group_size = roster.length() as u16;
  let scope = run::id(pass);
  let fight_id = object::id_from_address(
    fight_registry::fight_address(fight_registry, scope, room as u64),
  );
  run::latch(pass, fight_id, character_id);
  fight_doors::create_dungeon_fight_brand(
    Dungeon {}, fight_registry, scope, room as u64, world::seed(world), room as u32, 0,
    kiosk, pkcap, character_id, raised_spell_ids, mob_tmpl, group_size, config, items_version,
    fight_version, clock, ctx,
  );
  dungeon_events::emit_entered_fight(
    run::id(pass), fight_id, run::world(pass), sender(ctx), room, character_id,
  );
}

// ╔════════════════ [ ROSTER FIGHTS — the room's authored set IS the allowlist (#1110 ⑤) ] ═ ]

/// The DIFFICULTY the graded level window is drawn at for a room fight. Dungeons are the hard end of content and
/// their rooms are authored, not placed by distance — so a room mob draws from the TOP of its template's own
/// authored band. Identical to today for a point band (`min == max`), which is what a boss row is.
const ROOM_PROGRESS: u64 = 1000;

/// OPEN a room fight over the room's ACTUAL authored roster — the door that makes donor-pattern rooms (a boss
/// plus same-family adds) authorable at all. `next_fight` above stays exactly as it was and keeps serving
/// homogeneous rooms; this one takes the roster as written.
///
/// THE ALLOWLIST AND THE CREATE PATH ARE THE SAME MECHANISM, which is the whole point: the builder commits the
/// room's authored member list, so `add_member` accepts each template only in the position the room authored it.
/// Relaxing the homogeneity assert WITHOUT this — accepting any authored row anywhere — would have let a caller
/// run the boss room as N copies of its softest add for the same rewards.
public fun open_room_fight(
  fight_registry: &mut FightRegistry,
  world: &World,
  pass: &mut RunPass,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  fight_version: &FightVersion,
  items_version: &ItemsVersion,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
): GroupBuild {
  config.assert_domain(aresrpg::config::domain_dungeon());
  version.assert_enabled();
  run::assert_owner(pass, sender(ctx));
  run::assert_character(pass, character_id);
  assert!(run::world(pass) == object::id(world), EWrongWorld);

  let room = run::room(pass);
  let roster = roster_for_room(world, room);
  assert!(!roster.is_empty(), EEmptyRoom);
  let scope = run::id(pass);
  let fight_id = object::id_from_address(
    fight_registry::fight_address(fight_registry, scope, room as u64),
  );
  run::latch(pass, fight_id, character_id);
  let build = fight_doors::open_room_group_brand(
    Dungeon {}, scope, room as u64, world::seed(world), room as u32, 0, roster, ROOM_PROGRESS,
    kiosk, pkcap, character_id, raised_spell_ids, config, items_version, fight_version, clock,
  );
  dungeon_events::emit_entered_fight(
    run::id(pass), fight_id, run::world(pass), sender(ctx), room, character_id,
  );
  build
}

/// Join a party fight only when it re-derives from the creator pass at this pass's current room.
public fun join_fight(
  fight_registry: &mut FightRegistry,
  fight: &mut Fight,
  pass: &mut RunPass,
  creator_pass_id: ID,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  raised_spell_ids: vector<ID>,
  config: &GameConfig,
  fight_version: &FightVersion,
  items_version: &ItemsVersion,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  config.assert_domain(aresrpg::config::domain_dungeon());
  version.assert_enabled();
  run::assert_owner(pass, sender(ctx));
  run::assert_character(pass, character_id);
  let room = run::room(pass);
  let fight_id = object::id(fight);
  assert_same_room(fight_registry, fight_id, creator_pass_id, room);
  fight_doors::join_vouched_brand(
    Dungeon {}, fight, fight_registry, kiosk, pkcap, character_id, raised_spell_ids,
    config, items_version, fight_version, clock, ctx,
  );
  run::latch(pass, fight_id, character_id);
  dungeon_events::emit_entered_fight(
    run::id(pass), fight_id, run::world(pass), sender(ctx), room, character_id,
  );
}

public(package) fun assert_same_room(
  fight_registry: &FightRegistry,
  fight_id: ID,
  creator_pass_id: ID,
  room: u16,
) {
  let expected = object::id_from_address(
    fight_registry::fight_address(fight_registry, creator_pass_id, room as u64),
  );
  assert!(expected == fight_id, EWrongRoom);
}

fun assert_homogeneous(roster: &vector<ID>, template_id: ID) {
  let n = roster.length();
  let mut i = 1;
  while (i < n) {
    assert!(*roster.borrow(i) == template_id, ERoomNotHomogeneous);
    i = i + 1;
  };
}

// ╔════════════════ [ SETTLE — advance / consume off the FightOutcome ] ═════ ]

/// Match the outcome against the pass latch, then advance or release + consume the run.
public fun settle_run(
  pass: RunPass,
  outcome: &FightOutcome,
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  run::assert_owner(&pass, sender(ctx));
  assert!(run::world(&pass) == object::id(world), EWrongWorld);
  run::assert_commit_match(&pass, settlement::fight_id(outcome), settlement::character(outcome));
  let won = settlement::outcome(outcome) == engine::status_victory();
  settle_apply(pass, won, world::room_count(world), kiosk, pkcap, config, version);
}

/// Injectable settlement core used by the Move suite. Terminal branches release the world lock first.
public(package) fun settle_apply(
  mut pass: RunPass,
  won: bool,
  room_count: u64,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
) {
  let pass_id = run::id(&pass);
  let character = run::character(&pass);
  if (won && !run::is_last_room(&pass, room_count)) {
    run::advance_room(&mut pass);
    run::clear_commit(&mut pass);
    dungeon_events::emit_advanced(
      pass_id, run::world(&pass), run::owner(&pass), run::room(&pass), character,
    );
    run::return_to_owner(pass);
  } else {
    release(&pass, kiosk, pkcap, config, version);
    let reason = if (won) REASON_COMPLETION else REASON_DEFEAT;
    let (world, owner, consumed_character, rx, rz) = run::consume(pass);
    dungeon_events::emit_ended(pass_id, world, owner, reason, rx, rz, consumed_character);
  };
}

// ╔════════════════ [ ABANDON — voluntary exit (§9) ] ════════════════════════ ]

/// Release the activation character's world lock, then consume the run. Available during an emergency freeze.
public fun abandon(
  pass: RunPass,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_latest();
  run::assert_owner(&pass, sender(ctx));
  let pass_id = run::id(&pass);
  release(&pass, kiosk, pkcap, config, version);
  let (world, owner, character, rx, rz) = run::consume(pass);
  dungeon_events::emit_ended(pass_id, world, owner, REASON_ABANDON, rx, rz, character);
}

fun release(
  pass: &RunPass,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
) {
  character_link::exit_dungeon_brand(
    Dungeon {}, config, kiosk, pkcap, run::character(pass), run::id(pass), run::world(pass), version,
  );
}
