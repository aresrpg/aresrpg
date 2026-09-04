// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Core fight authority and custody. Deterministic combat lives in `aresrpg_combat`; this module
/// owns only object identity, character custody, authored entitlement, lifecycle authority,
/// canonical events, and value settlement.
module aresrpg::fight;

use aresrpg::{
  character::{Self, Character},
  equipment,
  item::{Self, Item, PM},
  party::{Self, Party},
  progression,
  protected_policy::AresRPG_TransferPolicy,
  world,
  zone,
};
use aresrpg_combat::combat::{Self, Fighter, FighterStats, State};
use aresrpg_math::{
  combat_grid::GridSpec,
  dungeon_data,
  item_stats,
  mob_data,
  prng,
  weapon,
  zone_math::{Self, MobMember},
};
use aresrpg_seed::{
  board_catalog::{Self, BoardCatalog},
  dungeon_content::{Self, DungeonContent},
  item_rows::ItemTemplate,
  mob_rows::MobTemplate,
  spell_rows::SpellTemplate,
  world_content::WorldContent,
};
use std::string::String;
use sui::{
  clock::Clock,
  dynamic_object_field as dynamic_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

const EWrongWorld: u64 = 1701;
const ENoSuchGroup: u64 = 1702;
const EWrongMob: u64 = 1703;
const EPendingMobs: u64 = 1704;
const EBoardTooSmall: u64 = 1705;
const ENotPlacement: u64 = 1706;
const ETeamFull: u64 = 1707;
const ENotYourFighter: u64 = 1708;
const EAlreadySeated: u64 = 1714;
const EBadTeam: u64 = 1726;
const EGroupOnly: u64 = 1727;
const ENotAMob: u64 = 1728;
const EWrongDoor: u64 = 1730;
const EBadSettlementBatch: u64 = 1731;

const ACCESS_PUBLIC: u8 = 0;
const ACCESS_GROUP: u8 = 1;
const ACCESS_INVITED: u8 = 2;
const ACCESS_UNSET: u8 = 255;

const DOOR_JOIN: u64 = 1;
const DOOR_START: u64 = 2;
const DOOR_SETTLE: u64 = 4;
const DOOR_FORFEIT: u64 = 8;
const DOOR_CLOSE: u64 = 16;
const DUNGEON_DOOR_POLICY: u64 = DOOR_JOIN | DOOR_SETTLE | DOOR_FORFEIT;
const KOLIZEUM_DOOR_POLICY: u64 = DOOR_JOIN | DOOR_START | DOOR_SETTLE | DOOR_FORFEIT | DOOR_CLOSE;

public struct Fight has key {
  id: UID,
  world: String,
  x: u32,
  z: u32,
  access_a: u8,
  access_b: u8,
  opener_a: Option<ID>,
  opener_b: Option<ID>,
  authorities: vector<FighterAuthority>,
  combat: State,
  dungeon: Option<DungeonTag>,
  door_policy: u64,
  drops_rolled: bool,
  /// Entropy committed by the previous boundary. It executes before the next Random draw.
  next_turn_entropy: u64,
  /// True once an ended fight has fresh retry-stable entropy reserved for team loot.
  loot_entropy_ready: bool,
}

public enum FighterAuthority has copy, drop, store {
  Player { character: ID, owner: address },
  Mob,
}

public struct DungeonTag has copy, drop, store { dungeon: String, room: u64 }

public struct FighterKey(u64) has copy, drop, store;

public struct FightBuild {
  world: String,
  x: u32,
  z: u32,
  board: GridSpec,
  access: u8,
  authorities: vector<FighterAuthority>,
  fighters: vector<Fighter>,
  character: Character,
  pending: vector<MobMember>,
  dungeon: Option<DungeonTag>,
  door_policy: u64,
}

public struct FightCreated has copy, drop {
  fight: ID, world: String, x: u32, z: u32, placement_ms: u64,
}
public struct FighterJoined has copy, drop { fight: ID, character: ID, team: u8 }
public struct FighterForfeited has copy, drop { fight: ID, fighter: u64 }
public struct FightStarted has copy, drop { fight: ID, world: String, x: u32, z: u32, queue: vector<u64> }
public struct FightEnded has copy, drop { fight: ID, world: String, x: u32, z: u32, winner: Option<u8> }
public struct FightClosable has copy, drop { fight: ID }
public struct FightClosed has copy, drop { fight: ID }
public struct TurnSeedUsed has copy, drop { fight: ID, seat: u64, seed: u64 }
public struct DropsRolled has copy, drop {
  fight: ID,
  fighter: u64,
  drops: vector<aresrpg_combat::combat::RolledDrop>,
}

public(package) fun engage(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  zone_object: &mut zone::Zone,
  content: &WorldContent,
  group_index: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let groups = zone::mob_groups(zone_object, content);
  let mut pending = vector[];
  let mut x = 0;
  let mut z = 0;
  let mut found = false;
  let mut index = 0;
  while (index < groups.length()) {
    let group = &groups[index];
    if (group.group_index() == group_index) {
      x = group.group_x();
      z = group.group_z();
      pending = group.group_members();
      found = true;
    };
    index = index + 1;
  };
  assert!(found, ENoSuchGroup);
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let current_world = world::prove_move(&mut character, x, z, clock);
  assert!(current_world == zone::world_name(zone_object), EWrongWorld);
  let board = board_catalog::pick(
    catalog, prng::mix(zone::seed_of(zone_object), group_index),
  );
  zone::consume_mob_group(zone_object, group_index);
  assert!(pending.length() <= board.start_cells_b().length(), EBoardTooSmall);
  assert!(!board.start_cells_a().is_empty(), EBoardTooSmall);
  let (authority, fighter) = player_fighter(
    &mut character, ctx.sender(), 0, board.start_cells_a()[0], clock,
  );
  FightBuild {
    world: current_world, x, z, board, access, authorities: vector[authority],
    fighters: vector[fighter], character, pending, dungeon: option::none(), door_policy: 0,
  }
}

public(package) fun dungeon_build(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  world_object: &world::World,
  dungeon: &DungeonContent,
  x: u32,
  z: u32,
  board_seed: u64,
  room: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): FightBuild {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let room_mobs = dungeon_data::room_at(dungeon_content::data(dungeon), room);
  let mut pending = vector[];
  let mut index = 0;
  while (index < room_mobs.length()) {
    pending.push_back(zone_math::new_member(
      dungeon_data::mob_type(&room_mobs[index]), dungeon_data::level_scalar(board_seed, index),
    ));
    index = index + 1;
  };
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(pending.length() <= board.start_cells_b().length(), EBoardTooSmall);
  assert!(!board.start_cells_a().is_empty(), EBoardTooSmall);
  let (authority, fighter) = player_fighter(
    &mut character, ctx.sender(), 0, board.start_cells_a()[0], clock,
  );
  FightBuild {
    world: world_object.name(), x, z, board, access, authorities: vector[authority],
    fighters: vector[fighter], character, pending,
    dungeon: option::some(DungeonTag { dungeon: dungeon_content::name(dungeon), room }),
    door_policy: DUNGEON_DOOR_POLICY,
  }
}

public(package) fun add_mob(mut build: FightBuild, template: &MobTemplate): FightBuild {
  assert!(!build.pending.is_empty(), EWrongMob);
  let member = build.pending.remove(0);
  assert!(member.member_type() == mob_data::mob_type(template.data()), EWrongMob);
  let cell = build.board.start_cells_b()[build.fighters.length() - 1];
  build.authorities.push_back(FighterAuthority::Mob);
  build.fighters.push_back(mob_fighter(template, member.member_level_scalar() as u64, cell));
  build
}

public(package) fun launch(
  build: FightBuild,
  entropy: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let FightBuild {
    world, x, z, board, access, authorities, fighters, character, pending, dungeon, door_policy,
  } = build;
  assert!(pending.is_empty(), EPendingMobs);
  let _ = share_new_fight(
    world, x, z, board, access, ACCESS_UNSET,
    option::some(character::id(&character)), option::none(), authorities, fighters,
    character, dungeon, door_policy, entropy.generate_u64(), clock, ctx,
  );
}

fun share_new_fight(
  world: String,
  x: u32,
  z: u32,
  board: GridSpec,
  access_a: u8,
  access_b: u8,
  opener_a: Option<ID>,
  opener_b: Option<ID>,
  authorities: vector<FighterAuthority>,
  fighters: vector<Fighter>,
  first_character: Character,
  dungeon: Option<DungeonTag>,
  door_policy: u64,
  next_turn_entropy: u64,
  clock: &Clock,
  ctx: &mut TxContext,
): ID {
  let placement_ms = if (door_policy & DOOR_START != 0) 0 else clock.timestamp_ms();
  let mut fight = Fight {
    id: object::new(ctx), world, x, z, access_a, access_b, opener_a, opener_b, authorities,
    combat: combat::new_state(board, fighters, placement_ms), dungeon, door_policy,
    drops_rolled: false, next_turn_entropy, loot_entropy_ready: false,
  };
  let id = fight.id.to_inner();
  dynamic_object::add(&mut fight.id, FighterKey(0), first_character);
  event::emit(FightCreated { fight: id, world: fight.world, x, z, placement_ms });
  transfer::share_object(fight);
  id
}

public(package) fun challenge(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  target: ID,
  x: u32,
  z: u32,
  access: u8,
  catalog: &BoardCatalog,
  entropy: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let world = world::prove_move(&mut character, x, z, clock);
  // The board must survive a gas-aborted retry unchanged. The invited opponent sees it before
  // accepting, so deterministic match identity is fairer than filterable same-tx randomness.
  let board_seed = duel_board_seed(character_id, target, x, z);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let (authority, fighter) = player_fighter(
    &mut character, ctx.sender(), 0, board.start_cells_a()[0], clock,
  );
  let _ = share_new_fight(
    world, x, z, board, access, ACCESS_INVITED,
    option::some(character_id), option::some(target), vector[authority], vector[fighter],
    character, option::none(), 0, entropy.generate_u64(), clock, ctx,
  );
}

public(package) fun kolizeum_birth(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  next_turn_entropy: u64,
  access: u8,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
): ID {
  assert!(access <= ACCESS_GROUP, EBadTeam);
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let board_seed = arena_board_seed(character_id, ctx.epoch());
  let board = board_catalog::pick(catalog, board_seed);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let (authority, fighter) = player_fighter(
    &mut character, ctx.sender(), 0, board.start_cells_a()[0], clock,
  );
  share_new_fight(
    b"kolizeum".to_string(), 0, 0, board, access, ACCESS_UNSET,
    option::some(character_id), option::none(), vector[authority], vector[fighter], character,
    option::none(), KOLIZEUM_DOOR_POLICY, next_turn_entropy, clock, ctx,
  )
}

public(package) fun ambush(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  x: u32,
  z: u32,
  template: &MobTemplate,
  level_scalar: u64,
  board_seed: u64,
  hp_cap: u64,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  let world = world::prove_move(&mut character, x, z, clock);
  let board = board_catalog::pick(catalog, board_seed);
  assert!(!board.start_cells_a().is_empty() && !board.start_cells_b().is_empty(), EBoardTooSmall);
  let (authority, mut fighter) = player_fighter(
    &mut character, ctx.sender(), 0, board.start_cells_a()[0], clock,
  );
  fighter = combat::cap_fighter_hp(fighter, hp_cap);
  let mob = mob_fighter(template, level_scalar, board.start_cells_b()[0]);
  let _ = share_new_fight(
    world, x, z, board, ACCESS_UNSET, ACCESS_UNSET, option::none(), option::none(),
    vector[authority, FighterAuthority::Mob], vector[fighter, mob], character,
    option::none(), 0, prng::mix(board_seed, 0xA8B057), clock, ctx,
  );
}

fun player_fighter(
  character: &mut Character,
  owner: address,
  team: u8,
  cell: u64,
  clock: &Clock,
): (FighterAuthority, Fighter) {
  let hp = progression::touch(character, clock);
  let authority = FighterAuthority::Player { character: character::id(character), owner };
  let fighter = combat::new_player_fighter(team, cell, hp, player_stats(character));
  (authority, fighter)
}

fun player_stats(character: &Character): FighterStats {
  let folded = equipment::folded(character);
  combat::player_fighter_stats(
    character.strength() as u64,
    character.intelligence() as u64,
    character.chance() as u64,
    character.agility() as u64,
    character.wisdom() as u64,
    character.level() as u64,
    progression::max_hp(character),
    &folded,
  )
}

fun mob_fighter(template: &MobTemplate, scalar: u64, cell: u64): Fighter {
  combat::scaled_mob_fighter(template.data(), scalar, cell)
}

public(package) fun join(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  access: u8,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  join_gate(fight, team);
  assert!(access <= ACCESS_GROUP, EBadTeam);
  if (claims_side(fight, team, character_id)) {
    if (team == 0) {
      fight.access_a = access;
      fight.opener_a = option::some(character_id);
    } else {
      fight.access_b = access;
      fight.opener_b = option::some(character_id);
    };
  };
  admit(fight, protected, kiosk, cap, character_id, team, travel, clock, ctx);
}

fun claims_side(fight: &Fight, team: u8, character_id: ID): bool {
  let access = if (team == 0) fight.access_a else fight.access_b;
  if (access == ACCESS_INVITED) {
    let opener = if (team == 0) &fight.opener_a else &fight.opener_b;
    assert!(opener.is_some() && *opener.borrow() == character_id, EGroupOnly);
    return false
  };
  if (access == ACCESS_UNSET && combat::player_count(&fight.combat, team) == 0) return true;
  assert!(access == ACCESS_PUBLIC, EGroupOnly);
  false
}

public(package) fun join_grouped(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  shared_party: &Party,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  join_gate(fight, team);
  assert!(combat::player_count(&fight.combat, team) > 0, EBadTeam);
  let access = if (team == 0) fight.access_a else fight.access_b;
  assert!(access == ACCESS_GROUP, EGroupOnly);
  let opener = if (team == 0) &fight.opener_a else &fight.opener_b;
  assert!(opener.is_some(), EBadTeam);
  assert!(party::is_member(shared_party, *opener.borrow()), EGroupOnly);
  assert!(party::is_member(shared_party, character_id), EGroupOnly);
  admit(fight, protected, kiosk, cap, character_id, team, travel, clock, ctx);
}

fun join_gate(fight: &Fight, team: u8) {
  assert!(combat::in_placement(&fight.combat), ENotPlacement);
  assert!(team <= 1, EBadTeam);
  let mut fighter = 0;
  while (fighter < fight.authorities.length()) {
    assert!(!(combat::fighter_team(&fight.combat, fighter) == team && is_mob_authority(
      &fight.authorities[fighter],
    )), EBadTeam);
    fighter = fighter + 1;
  };
  assert!(combat::first_free_start(&fight.combat, team).is_some(), ETeamFull);
}

fun admit(
  fight: &mut Fight,
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  team: u8,
  travel: bool,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut character = protected.extract_from_kiosk(kiosk, cap, character_id, ctx);
  if (travel) {
    let current_world = world::prove_move(&mut character, fight.x, fight.z, clock);
    assert!(current_world == fight.world, EWrongWorld);
  };
  let character_id = character::id(&character);
  let mut fighter = 0;
  while (fighter < fight.authorities.length()) {
    match (&fight.authorities[fighter]) {
      FighterAuthority::Player { character, .. } => assert!(*character != character_id, EAlreadySeated),
      FighterAuthority::Mob => (),
    };
    fighter = fighter + 1;
  };
  let cell = combat::first_free_start(&fight.combat, team).destroy_some();
  let index = fight.authorities.length();
  let (authority, combat_fighter) = player_fighter(&mut character, ctx.sender(), team, cell, clock);
  fight.authorities.push_back(authority);
  combat::add_fighter(&mut fight.combat, combat_fighter);
  dynamic_object::add(&mut fight.id, FighterKey(index), character);
  event::emit(FighterJoined { fight: fight.id.to_inner(), character: character_id, team });
}

fun is_mob_authority(authority: &FighterAuthority): bool {
  match (authority) { FighterAuthority::Mob => true, FighterAuthority::Player { .. } => false }
}

public(package) fun place(
  fight: &mut Fight,
  fighter: u64,
  cell: u64,
  ctx: &TxContext,
) {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  combat::place(&mut fight.combat, fighter, cell);
}

public(package) fun ready(fight: &mut Fight, fighter: u64, ctx: &TxContext): bool {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  combat::ready(&mut fight.combat, fighter)
}

/// Batch-ready door: every call before the terminal Random door must leave another player
/// unready. If this seat was final, the whole PTB aborts and the caller rebuilds with
/// `ready_and_start_fight` as its last command.
public(package) fun ready_non_final(fight: &mut Fight, fighter: u64, ctx: &TxContext) {
  assert!(!ready(fight, fighter, ctx), EWrongDoor);
}

public(package) fun start(
  fight: &mut Fight,
  entropy: &mut RandomGenerator,
  clock: &Clock,
) {
  let queue_before = combat::queue(&fight.combat);
  assert!(queue_before.is_empty(), ENotPlacement);
  let turn_seeds = committed_turn_seeds(fight);
  let used = combat::start(&mut fight.combat, turn_seeds, clock.timestamp_ms());
  // Execute committed outcomes first. The one fresh draw only commits the next boundary.
  commit_next_entropy(fight, entropy);
  event::emit(FightStarted {
    fight: fight.id.to_inner(), world: fight.world, x: fight.x, z: fight.z,
    queue: combat::queue(&fight.combat),
  });
  emit_turn_seeds(fight, &used);
  emit_end_if_needed(fight, false);
}

public(package) fun cast(
  fight: &mut Fight,
  fighter: u64,
  spell: &SpellTemplate,
  target_cell: u64,
  ctx: &TxContext,
) {
  assert_active_owner(fight, fighter, ctx);
  let character = character_of(fight, fighter);
  assert!(character.classe() == spell.classe(), ENotYourFighter);
  let learned_level = progression::spell_level(character, spell);
  assert!(learned_level > 0, ENotYourFighter);
  let ended_before = combat::ended(&fight.combat);
  combat::cast(
    &mut fight.combat, fighter, &spell.level_of(learned_level), spell.name(), target_cell,
    learned_level,
  );
  emit_end_if_needed(fight, ended_before);
}

public(package) fun strike(
  fight: &mut Fight,
  fighter: u64,
  target_cell: u64,
  ctx: &TxContext,
) {
  assert_active_owner(fight, fighter, ctx);
  let level = strike_level(fight, fighter);
  let ended_before = combat::ended(&fight.combat);
  combat::cast(
    &mut fight.combat, fighter, &level, b"strike".to_string(), target_cell, 0,
  );
  emit_end_if_needed(fight, ended_before);
}

public(package) fun move_fighter(fight: &mut Fight, path: &vector<u64>, ctx: &TxContext) {
  let fighter = combat::active_fighter(&fight.combat);
  assert_active_owner(fight, fighter, ctx);
  let ended_before = combat::ended(&fight.combat);
  combat::move_active_fighter(&mut fight.combat, path);
  emit_end_if_needed(fight, ended_before);
}

public(package) fun end_turn(
  fight: &mut Fight,
  entropy: &mut RandomGenerator,
  clock: &Clock,
  ctx: &TxContext,
) {
  let fighter = combat::active_fighter(&fight.combat);
  assert_active_owner(fight, fighter, ctx);
  let ended_before = combat::ended(&fight.combat);
  let turn_seeds = committed_turn_seeds(fight);
  let used = combat::end_turn(&mut fight.combat, turn_seeds, clock.timestamp_ms());
  commit_next_entropy(fight, entropy);
  emit_turn_seeds(fight, &used);
  emit_end_if_needed(fight, ended_before);
}

public(package) fun crank(
  fight: &mut Fight,
  entropy: &mut RandomGenerator,
  clock: &Clock,
) {
  let ended_before = combat::ended(&fight.combat);
  let turn_seeds = committed_turn_seeds(fight);
  let used = combat::crank(&mut fight.combat, turn_seeds, clock.timestamp_ms());
  commit_next_entropy(fight, entropy);
  emit_turn_seeds(fight, &used);
  emit_end_if_needed(fight, ended_before);
}

fun emit_turn_seeds(fight: &Fight, used: &vector<aresrpg_combat::combat::TurnSeedUse>) {
  let mut index = 0;
  while (index < used.length()) {
    event::emit(TurnSeedUsed {
      fight: fight.id.to_inner(),
      seat: combat::turn_seed_fighter(&used[index]),
      seed: combat::turn_seed_value(&used[index]),
    });
    index = index + 1;
  };
}

fun committed_turn_seeds(fight: &Fight): vector<u64> {
  turn_seeds_from(fight.next_turn_entropy, 2 * fight.authorities.length() + 1)
}

fun commit_next_entropy(fight: &mut Fight, entropy: &mut RandomGenerator) {
  fight.next_turn_entropy = entropy.generate_u64();
  if (combat::ended(&fight.combat)) fight.loot_entropy_ready = true;
}

/// A player action can end combat before the normal boundary door. The SDK appends this terminal
/// seal in the same PTB; raw callers that omit it cannot roll shared team loot until it is sealed.
public(package) fun seal_end(fight: &mut Fight, entropy: &mut RandomGenerator) {
  assert!(combat::ended(&fight.combat) && !fight.loot_entropy_ready, EWrongDoor);
  commit_next_entropy(fight, entropy);
}

fun turn_seeds_from(entropy: u64, count: u64): vector<u64> {
  let mut seeds = vector[];
  let mut remaining = count;
  let mut entropy = entropy;
  while (remaining > 0) {
    seeds.push_back(prng::draw(&mut entropy));
    remaining = remaining - 1;
  };
  seeds
}

fun duel_board_seed(character: ID, target: ID, x: u32, z: u32): u64 {
  prng::mix(
    prng::mix(id_seed(character), id_seed(target)),
    prng::mix(x as u64, z as u64),
  )
}

fun arena_board_seed(character: ID, epoch: u64): u64 {
  prng::mix(id_seed(character), epoch)
}

fun id_seed(id: ID): u64 {
  let bytes = id.to_bytes();
  let mut seed = 0;
  let mut index = 0;
  while (index < bytes.length()) {
    seed = prng::mix(seed, bytes[index] as u64);
    index = index + 1;
  };
  seed
}

fun emit_end_if_needed(fight: &Fight, ended_before: bool) {
  if (!ended_before && combat::ended(&fight.combat)) event::emit(FightEnded {
    fight: fight.id.to_inner(), world: fight.world, x: fight.x, z: fight.z,
    winner: combat::winner(&fight.combat),
  });
}

fun assert_active_owner(fight: &Fight, fighter: u64, ctx: &TxContext) {
  assert!(combat::active_fighter(&fight.combat) == fighter, ENotYourFighter);
  assert!(!combat::fighter_dead(&fight.combat, fighter), ENotYourFighter);
  let _ = assert_fighter_owner(fight, fighter, ctx);
}

fun assert_fighter_owner(fight: &Fight, fighter: u64, ctx: &TxContext): ID {
  assert!(fighter < fight.authorities.length(), ENotYourFighter);
  match (&fight.authorities[fighter]) {
    FighterAuthority::Player { character, owner, .. } => {
      assert!(*owner == ctx.sender() && !combat::fighter_settled(&fight.combat, fighter), ENotYourFighter);
      *character
    },
    FighterAuthority::Mob => abort ENotYourFighter,
  }
}

fun character_of(fight: &Fight, fighter: u64): &Character {
  dynamic_object::borrow(&fight.id, FighterKey(fighter))
}

fun strike_level(fight: &Fight, fighter: u64): aresrpg_math::spell_effect::SpellLevel {
  let character = character_of(fight, fighter);
  let equipped = equipment::equipped(character);
  let weapon_slot = b"weapon".to_string();
  if (!equipped.contains(&weapon_slot)) return weapon::unarmed();
  let record = equipped.get(&weapon_slot);
  let category = equipment::record_category(record);
  weapon::strike_of(
    &category,
    &equipment::record_damages(record),
    weapon::affinity_of(&character::classe(character), &category),
  )
}

public(package) fun forfeit(
  fight: &mut Fight,
  fighter: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  let pvm = combat::has_mobs(&fight.combat);
  let ended_before = combat::ended(&fight.combat);
  combat::forfeit(&mut fight.combat, fighter);
  event::emit(FighterForfeited { fight: fight.id.to_inner(), fighter });
  emit_end_if_needed(fight, ended_before);
  let mut character: Character = dynamic_object::remove(&mut fight.id, FighterKey(fighter));
  if (pvm) progression::set_hp(&mut character, 1, clock);
  character::assert_personal_custody(kiosk);
  kiosk.lock(cap, policy, character);
}

public(package) fun settle(
  fight: &mut Fight,
  fighter: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  plan: vector<PM>,
  entropy: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  if (combat::fighter_won(&fight.combat, fighter) && !fight.drops_rolled) {
    assert!(fight.loot_entropy_ready, EWrongDoor);
    let winning_team = combat::fighter_team(&fight.combat, fighter);
    let random_draws = turn_seeds_from(
      fight.next_turn_entropy,
      combat::loot_random_draw_count(&fight.combat, winning_team),
    );
    let winners = combat::roll_and_split_drops(
      &mut fight.combat, fighter, random_draws,
    );
    fight.drops_rolled = true;
    let mut index = 0;
    while (index < winners.length()) {
      let winner = winners[index];
      event::emit(DropsRolled {
        fight: fight.id.to_inner(), fighter: winner,
        drops: combat::fighter_drops(&fight.combat, winner),
      });
      index = index + 1;
    };
  };
  settle_seat(fight, fighter, kiosk, cap, character_policy, clock);
  claim_all(fight, fighter, plan, kiosk, cap, item_policy, entropy, ctx);
  emit_closable(fight);
}

/// One wallet, one personal kiosk, one Random generator: settle every named seat atomically.
/// A wrong/duplicate/foreign seat aborts the whole batch, preserving every reward.
public(package) fun settle_many(
  fight: &mut Fight,
  mut fighters: vector<u64>,
  mut plan_lengths: vector<u64>,
  mut plan: vector<PM>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_policy: &TransferPolicy<Character>,
  item_policy: &TransferPolicy<Item>,
  entropy: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  assert!(!fighters.is_empty() && fighters.length() == plan_lengths.length(), EBadSettlementBatch);
  while (!fighters.is_empty()) {
    let mut seat_plan = vector[];
    let mut remaining = plan_lengths.pop_back();
    assert!(remaining <= plan.length(), EBadSettlementBatch);
    while (remaining > 0) {
      seat_plan.push_back(plan.pop_back());
      remaining = remaining - 1;
    };
    settle(
      fight, fighters.pop_back(), kiosk, cap, character_policy, item_policy,
      seat_plan, entropy, clock, ctx,
    );
  };
  assert!(plan.is_empty(), EBadSettlementBatch);
}

public(package) fun settle_pvp(
  fight: &mut Fight,
  fighter: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_policy: &TransferPolicy<Character>,
  clock: &Clock,
  ctx: &TxContext,
) {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  settle_seat(fight, fighter, kiosk, cap, character_policy, clock);
  emit_closable(fight);
}

fun settle_seat(
  fight: &mut Fight,
  fighter: u64,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_policy: &TransferPolicy<Character>,
  clock: &Clock,
) {
  let (won, _, hp, experience) = combat::settlement_values(&fight.combat, fighter);
  let pvm = combat::has_mobs(&fight.combat);
  let mut character: Character = dynamic_object::remove(&mut fight.id, FighterKey(fighter));
  if (won) character::add_experience(&mut character, experience);
  if (pvm) progression::set_hp(&mut character, hp, clock);
  character::assert_personal_custody(kiosk);
  kiosk.lock(cap, character_policy, character);
  combat::mark_settled(&mut fight.combat, fighter);
}

fun claim_all(
  fight: &mut Fight,
  fighter: u64,
  plan: vector<PM>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  entropy: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let mut plan = plan;
  while (!combat::fighter_drops(&fight.combat, fighter).is_empty()) {
    let item_type = combat::first_drop_type(&fight.combat, fighter);
    let quantity = combat::take_matching_drops(&mut fight.combat, fighter, &item_type);
    item::deliver_drops(&mut plan, &item_type, quantity, kiosk, cap, policy, entropy, ctx);
  };
}

public(package) fun assert_last_settlers(fight: &Fight, fighters: &vector<u64>, ctx: &TxContext) {
  assert!(!fighters.is_empty(), EBadSettlementBatch);
  let mut index = 0;
  while (index < fighters.length()) {
    let fighter = fighters[index];
    let _ = assert_fighter_owner(fight, fighter, ctx);
    let mut other = index + 1;
    while (other < fighters.length()) {
      assert!(fighter != fighters[other], EBadSettlementBatch);
      other = other + 1;
    };
    index = index + 1;
  };
  combat::assert_last_settlers(&fight.combat, fighters);
}

public(package) fun assert_last_live_player(fight: &Fight, fighter: u64, ctx: &TxContext) {
  let _ = assert_fighter_owner(fight, fighter, ctx);
  combat::assert_last_live_player(&fight.combat, fighter);
}

fun emit_closable(fight: &Fight) {
  if (combat::is_closable(&fight.combat))
    event::emit(FightClosable { fight: fight.id.to_inner() });
}

public(package) fun close(fight: Fight, ctx: &TxContext) {
  combat::assert_closable(&fight.combat);
  let mut participant = false;
  let mut fighter = 0;
  while (fighter < fight.authorities.length()) {
    match (&fight.authorities[fighter]) {
      FighterAuthority::Player { owner, .. } => if (*owner == ctx.sender()) participant = true,
      FighterAuthority::Mob => (),
    };
    fighter = fighter + 1;
  };
  assert!(participant, ENotYourFighter);
  event::emit(FightClosed { fight: fight.id.to_inner() });
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
}

public(package) fun dungeon_tag(fight: &Fight): Option<DungeonTag> { fight.dungeon }

public(package) fun dungeon_name(tag: &DungeonTag): String { tag.dungeon }

public(package) fun dungeon_room(tag: &DungeonTag): u64 { tag.room }

public(package) fun fighter_won(fight: &Fight, fighter: u64): bool {
  combat::fighter_won(&fight.combat, fighter)
}

public(package) fun fighter_character(fight: &Fight, fighter: u64): ID {
  match (&fight.authorities[fighter]) {
    FighterAuthority::Player { character, .. } => *character,
    FighterAuthority::Mob => abort ENotAMob,
  }
}

public(package) fun fighter_character_ref(fight: &Fight, fighter: u64): &Character {
  assert!(fighter < fight.authorities.length(), ENotYourFighter);
  character_of(fight, fighter)
}

public(package) fun assert_controlled_character(
  fight: &Fight,
  fighter: u64,
  expected_character: ID,
  ctx: &TxContext,
) {
  let character = assert_fighter_owner(fight, fighter, ctx);
  assert!(character == expected_character, ENotYourFighter);
}

public(package) fun assert_join_door_open(fight: &Fight) {
  assert!(fight.door_policy & DOOR_JOIN == 0, EWrongDoor);
}

public(package) fun assert_start_door_open(fight: &Fight) {
  assert!(fight.door_policy & DOOR_START == 0, EWrongDoor);
}

public(package) fun assert_settle_door_open(fight: &Fight) {
  assert!(fight.door_policy & DOOR_SETTLE == 0, EWrongDoor);
}

public(package) fun assert_forfeit_door_open(fight: &Fight) {
  assert!(fight.door_policy & DOOR_FORFEIT == 0, EWrongDoor);
}

public(package) fun assert_close_door_open(fight: &Fight) {
  assert!(fight.door_policy & DOOR_CLOSE == 0, EWrongDoor);
}

public(package) fun assert_kolizeum_controlled(fight: &Fight) {
  assert!(fight.door_policy == KOLIZEUM_DOOR_POLICY, EWrongDoor);
}

public(package) fun side_players(fight: &Fight, team: u8): u64 {
  combat::player_count(&fight.combat, team)
}

public(package) fun set_placement_clock(fight: &mut Fight, placement_ms: u64) {
  combat::set_placement_started_ms(&mut fight.combat, placement_ms);
}

public(package) fun in_placement(fight: &Fight): bool { combat::in_placement(&fight.combat) }

public(package) fun winners_remaining(fight: &Fight): u64 {
  combat::winners_remaining(&fight.combat)
}

public(package) fun fight_world(fight: &Fight): String { fight.world }

public(package) fun placement_started_ms(fight: &Fight): u64 {
  combat::placement_started_ms(&fight.combat)
}

#[test_only]
fun authority_test_stats(): FighterStats {
  combat::new_fighter_stats(
    combat::new_sheet(0, 0, 0, 0, 0, 0, 0, 0, 1),
    100, 6, 3,
    item_stats::shift() as u64,
    item_stats::shift() as u64,
    item_stats::shift() as u64,
    item_stats::shift() as u64,
  )
}

#[test_only]
fun authority_test_player(team: u8, cell: u64): Fighter {
  combat::new_player_fighter(team, cell, 100, authority_test_stats())
}

#[test_only]
fun authority_test_mob(team: u8, cell: u64): Fighter {
  combat::new_mob_fighter(
    team, cell, authority_test_stats(),
    combat::new_mob_snapshot(b"authority_test".to_string(), 1, vector[], 0, vector[]),
  )
}

#[test_only]
public(package) fun retry_boundary_fight_for_testing(committed: u64, ctx: &mut TxContext): Fight {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let mob_cell = board.start_cells_a()[0];
  let player_cell = board.start_cells_b()[0];
  Fight {
    id: object::new(ctx), world: b"retry_boundary_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    authorities: vector[
      FighterAuthority::Mob,
      FighterAuthority::Player { character: object::id_from_address(@0xBEEF), owner: ctx.sender() },
    ],
    combat: combat::new_state(
      board,
      vector[
        authority_test_mob(0, mob_cell),
        authority_test_player(1, player_cell),
      ],
      0,
    ),
    dungeon: option::none(), door_policy: 0, drops_rolled: false,
    next_turn_entropy: committed, loot_entropy_ready: false,
  }
}

#[test_only]
public(package) fun next_turn_entropy_for_testing(fight: &Fight): u64 {
  fight.next_turn_entropy
}

#[test_only]
public(package) fun turn_seed_for_testing(event: &TurnSeedUsed): u64 { event.seed }

#[test_only]
public(package) fun destroy_retry_boundary_for_testing(fight: Fight) {
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
}

#[test_only]
public(package) fun retry_loot_fight_for_testing(
  character: Character,
  committed: u64,
  ctx: &mut TxContext,
): Fight {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let character_id = character::id(&character);
  let player = authority_test_player(0, board.start_cells_a()[0]);
  let mob = combat::new_mob_fighter(
    1,
    board.start_cells_b()[0],
    authority_test_stats(),
    combat::new_mob_snapshot(
      b"retry_loot_mob".to_string(),
      1,
      vector[],
      0,
      vector[mob_data::new_loot_entry(b"retry_fang".to_string(), 10_000, 1, 5)],
    ),
  );
  let mut state = combat::new_state(board, vector[player, mob], 0);
  combat::set_ended_for_testing(&mut state, option::some(0));
  let mut fight = Fight {
    id: object::new(ctx), world: b"retry_loot_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::some(character_id), opener_b: option::none(),
    authorities: vector[
      FighterAuthority::Player { character: character_id, owner: ctx.sender() },
      FighterAuthority::Mob,
    ],
    combat: state, dungeon: option::none(), door_policy: 0, drops_rolled: false,
    next_turn_entropy: committed, loot_entropy_ready: true,
  };
  dynamic_object::add(&mut fight.id, FighterKey(0), character);
  fight
}

#[test_only]
public(package) fun drops_quantity_for_testing(event: &DropsRolled): u32 {
  combat::drop_quantity(&event.drops[0])
}

#[test_only]
public(package) fun side_admission_for_testing(
  side_access: u8,
  opener: Option<ID>,
  occupied: bool,
  joiner: ID,
  ctx: &mut TxContext,
): bool {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let mut authorities = vector[];
  let mut fighters = vector[];
  if (occupied) {
    authorities.push_back(FighterAuthority::Player {
      character: opener.get_with_default(joiner), owner: @0x1,
    });
    fighters.push_back(authority_test_player(1, board.start_cells_b()[0]));
  };
  let fight = Fight {
    id: object::new(ctx), world: b"access_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: side_access,
    opener_a: option::none(), opener_b: opener, authorities,
    combat: combat::new_state(board, fighters, 0), dungeon: option::none(),
    door_policy: 0, drops_rolled: false, next_turn_entropy: 1, loot_entropy_ready: false,
  };
  let claims = claims_side(&fight, 1, joiner);
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
  claims
}

#[test_only]
fun authority_lifecycle_fight_for_testing(
  owner: address,
  other_player: bool,
  current_settled: bool,
  other_settled: bool,
  ended: bool,
  door_policy: u64,
  ctx: &mut TxContext,
): Fight {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let current_character = object::id_from_address(@0xC0FFEE);
  let mut authorities = vector[
    FighterAuthority::Player { character: current_character, owner },
  ];
  let mut fighters = vector[authority_test_player(0, board.start_cells_a()[0])];
  if (other_player) {
    authorities.push_back(FighterAuthority::Player {
      character: object::id_from_address(@0xBAD), owner: @0xBEEF,
    });
    fighters.push_back(authority_test_player(1, board.start_cells_b()[0]));
  } else {
    authorities.push_back(FighterAuthority::Mob);
    fighters.push_back(authority_test_mob(1, board.start_cells_b()[0]));
  };
  let mut state = combat::new_state(board, fighters, 0);
  combat::set_fighter_settled_for_testing(&mut state, 0, current_settled);
  combat::set_fighter_settled_for_testing(&mut state, 1, other_settled);
  if (ended) combat::set_ended_for_testing(&mut state, option::some(0));
  Fight {
    id: object::new(ctx), world: b"authority_lifecycle_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(), authorities, combat: state,
    dungeon: option::none(), door_policy, drops_rolled: ended, next_turn_entropy: 1,
    loot_entropy_ready: ended,
  }
}

#[test_only]
public(package) fun close_for_testing(owner: address, settled: bool, ctx: &mut TxContext) {
  close(authority_lifecycle_fight_for_testing(
    owner, false, settled, true, true, 0, ctx,
  ), ctx);
}

#[test_only]
public(package) fun assert_last_settler_for_testing(
  owner: address,
  other_settled: bool,
  ctx: &mut TxContext,
) {
  let fight = authority_lifecycle_fight_for_testing(
    owner, true, false, other_settled, true, 0, ctx,
  );
  assert_last_settlers(&fight, &vector[0], ctx);
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
}

#[test_only]
public(package) fun assert_duplicate_last_settlers_for_testing(owner: address, ctx: &mut TxContext) {
  let fight = authority_lifecycle_fight_for_testing(owner, true, false, true, true, 0, ctx);
  assert_last_settlers(&fight, &vector[0, 0], ctx);
  abort 999
}

#[test_only]
public(package) fun assert_last_live_player_for_testing(
  owner: address,
  other_settled: bool,
  ctx: &mut TxContext,
) {
  let fight = authority_lifecycle_fight_for_testing(
    owner, true, false, other_settled, false, KOLIZEUM_DOOR_POLICY, ctx,
  );
  assert_last_live_player(&fight, 0, ctx);
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
}

#[test_only]
public(package) fun party_authority_fight_for_testing(
  character: Character,
  owner: address,
  settled: bool,
  ctx: &mut TxContext,
): Fight {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let character_id = character::id(&character);
  let fighter = combat::new_player_fighter(
    0, board.start_cells_a()[0], 100, authority_test_stats(),
  );
  let mut state = combat::new_state(board, vector[fighter], 0);
  combat::set_fighter_settled_for_testing(&mut state, 0, settled);
  let mut fight = Fight {
    id: object::new(ctx), world: b"party_authority_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(),
    authorities: vector[FighterAuthority::Player { character: character_id, owner }],
    combat: state, dungeon: option::none(), door_policy: 0, drops_rolled: false,
    next_turn_entropy: 1, loot_entropy_ready: false,
  };
  dynamic_object::add(&mut fight.id, FighterKey(0), character);
  fight
}

#[test_only]
public(package) fun mob_party_authority_fight_for_testing(ctx: &mut TxContext): Fight {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let fighter = combat::new_mob_fighter(
    0,
    board.start_cells_a()[0],
    authority_test_stats(),
    combat::new_mob_snapshot(b"authority_test".to_string(), 1, vector[], 0, vector[]),
  );
  Fight {
    id: object::new(ctx), world: b"party_authority_mob_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::none(), opener_b: option::none(), authorities: vector[FighterAuthority::Mob],
    combat: combat::new_state(board, vector[fighter], 0), dungeon: option::none(),
    door_policy: 0, drops_rolled: false, next_turn_entropy: 1, loot_entropy_ready: false,
  }
}

#[test_only]
public(package) fun take_party_authority_character_for_testing(mut fight: Fight): Character {
  let character: Character = dynamic_object::remove(&mut fight.id, FighterKey(0));
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
  character
}

#[test_only]
public(package) fun destroy_party_authority_mob_fight_for_testing(fight: Fight) {
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
}

#[test_only]
public(package) fun wrapper_lifecycle_for_testing(
  character: Character,
  clock: &Clock,
  ctx: &mut TxContext,
): vector<u64> {
  let board = aresrpg_math::combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let mob_cell = player_cell + 1;
  let character_id = character::id(&character);
  let player = combat::new_player_fighter(0, player_cell, 100, authority_test_stats());
  let mob = combat::cap_fighter_hp(authority_test_mob(1, mob_cell), 1);
  let mut fight = Fight {
    id: object::new(ctx), world: b"wrapper_lifecycle_test".to_string(), x: 0, z: 0,
    access_a: ACCESS_UNSET, access_b: ACCESS_UNSET,
    opener_a: option::some(character_id), opener_b: option::none(),
    authorities: vector[
      FighterAuthority::Player { character: character_id, owner: ctx.sender() },
      FighterAuthority::Mob,
    ],
    combat: combat::new_state(board, vector[player, mob], clock.timestamp_ms()),
    dungeon: option::none(), door_policy: 0, drops_rolled: false, next_turn_entropy: 1,
    loot_entropy_ready: false,
  };
  dynamic_object::add(&mut fight.id, FighterKey(0), character);
  let final_ready = ready(&mut fight, 0, ctx);
  let mut entropy = sui::random::new_generator_from_seed_for_testing(b"wrapper_lifecycle");
  start(&mut fight, &mut entropy, clock);
  strike(&mut fight, 0, mob_cell, ctx);
  let ended = combat::ended(&fight.combat);
  let winner = combat::winner(&fight.combat).get_with_default(255);
  let character: Character = dynamic_object::remove(&mut fight.id, FighterKey(0));
  character::destroy(character);
  let Fight {
    id, world: _, x: _, z: _, access_a: _, access_b: _, opener_a: _, opener_b: _,
    authorities: _, combat: state, dungeon: _, door_policy: _, drops_rolled: _,
    next_turn_entropy: _, loot_entropy_ready: _,
  } = fight;
  combat::destroy(state);
  id.delete();
  vector[if (final_ready) 1 else 0, if (ended) 1 else 0, winner as u64]
}
