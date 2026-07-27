// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module aresrpg_fight::fight;

use aresrpg_fight::{
  fight_events,
  mob::{Self, MobSpec, FightMob, MobLootEntry, MobKit},
  participant::{Self, Participant, Combatant, WeaponLine},
  fight_registry::{Self, FightRegistry},
  interleave::Actor,
  version::Version
};
use aresrpg_foundation::{board, prng, spell_board::{Self, BoardState}};
use std::{string::String, type_name::{Self, TypeName}};
use sui::{clock::Clock, dynamic_field as df};


const STATUS_PLACEMENT: u8 = 0; // board shown, players pick cells + READY
const STATUS_ACTIVE: u8 = 1; // turns running
const STATUS_VICTORY: u8 = 2; // a winning side exists (see winner_team) — claims open
const STATUS_DEFEAT: u8 = 3; // no winning side (PvM loss / PvP mutual wipe) — no loot/xp (§7 defeat costs only time)

public fun status_placement(): u8 { STATUS_PLACEMENT }
public fun status_active(): u8 { STATUS_ACTIVE }
public fun status_victory(): u8 { STATUS_VICTORY }
public fun status_defeat(): u8 { STATUS_DEFEAT }

const MODE_PVM: u8 = 0;
const MODE_PVP: u8 = 1;
public fun mode_pvm(): u8 { MODE_PVM }
public fun mode_pvp(): u8 { MODE_PVP }

const HOUR_MS: u64 = 3_600_000;


const EZeroHp: u64 = 101; // create/join: a fighter at 0 HP cannot enter (§17.23 — core reads authentic HP)
const ETeamFull: u64 = 102; // join: the side is already at the bound
const ENotPlacement: u64 = 103; // join: the fight already started (join only during placement)
const ENotParty: u64 = 104; // join: a party-only fight, and the joiner's claimed party differs
const EBadStartCells: u64 = 105; // create: the derived board produced too few start cells (structurally impossible)
const EAlreadySeated: u64 = 108; // join: this character already holds a seat in this fight (F-01)
const EGatedJoins: u64 = 109; // join: a door-created (dungeon/kolizeum) fight — only VOUCHED joins seat
const EBadTeam: u64 = 110; // join: team 1 is only a PvP concept
const EWrongBrand: u64 = 112; // join: the witness type does not match the brand the fight was created under
const ERosterFull: u64 = 113; // add_member: every committed member already landed — this call has no slot
const EWrongMember: u64 = 114; // add_member: the template is not the NEXT committed member (swap / reorder refused)
const EPartialRoster: u64 = 115; // create_members: fewer members landed than the commitment names


public struct Dials has copy, drop {
  turn_ms: u64,
  placement_ms: u64,
  team_bound: u64,
  archimob_bp: u64,
  aging_bp_per_hour: u64,
  aging_cap_bp: u64,
  xp_mult: u64,
  loot_mult: u64,
}

public fun new_dials(turn_ms: u64, placement_ms: u64, team_bound: u64, archimob_bp: u64, aging_bp_per_hour: u64, aging_cap_bp: u64, xp_mult: u64, loot_mult: u64): Dials {
  Dials { turn_ms, placement_ms, team_bound, archimob_bp, aging_bp_per_hour, aging_cap_bp, xp_mult, loot_mult }
}

public struct Fight has key {
  id: UID,
  brand: TypeName,
  world: ID,
  spawn_id: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  public_fight: bool,
  party_id: Option<ID>,
  aged_bp: u64,
  turn_ms: u64,
  placement_ms: u64,
  team_bound: u64,
  xp_mult: u64, // settlement multiplier snapshots (see Dials)
  loot_mult: u64,
  status: u8,
  mode: u8,
  winner_team: Option<u8>,
  gated_joins: bool, // door-created fights: only VOUCHED joins seat (the consumer verified its own entry proof)
  participants: vector<Participant>,
  mobs: vector<FightMob>,
  board: BoardGeom,
  fx: BoardState,
  queue: vector<Actor>,
  turn_ptr: u64,
  turn_deadline_ms: u64,
  last_action_ms: u64,
  placement_deadline_ms: u64,
  group: GroupContent,
}

public struct BoardGeom has store {
  width: u64,
  height: u64,
  shape_mask: vector<u64>,
  obstacles: vector<u64>,
  holes: vector<u64>,
  start_cells_a: vector<u64>,
  start_cells_b: vector<u64>,
}

public struct GroupContent has store {
  template: ID,
  xp: u64,
  loot: vector<MobLootEntry>,
  kit: MobKit,
}


public fun create<W: drop>(
  _w: W,
  registry: &mut FightRegistry,
  world: ID,
  spawn_id: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  spec: &MobSpec,
  group_size: u16,
  group_seed: u64,
  content_template: ID,
  creator: Combatant,
  creator_lines: vector<WeaponLine>,
  creator_category: Option<String>, // §387 — the creator's equipped-weapon FINE category (drives the strike shape); none = tool/bare
  dials: Dials,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  create_inner(_w, registry, world, spawn_id, 0, world_seed, anchor_x, anchor_z, spawned_at_ms, is_public, party_id, gated_joins, spec, group_size, group_seed, content_template, creator, creator_lines, creator_category, dials, version, clock, ctx);
}

/// `create` for a RE-ENGAGED group (#609 — a defeat releases the group back into the world at its spot, so it
/// can be fought again). Identical in every way except the fight's derived ADDRESS, which is namespaced by the
/// group's engagement `round` (a derived address is claimed once, forever — see `fight_registry`). Round 0 IS
/// `create`, same address, same everything: the consumer reads the round off its own world state and passes it.
public fun create_round<W: drop>(
  _w: W,
  registry: &mut FightRegistry,
  world: ID,
  spawn_id: u64,
  round: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  spec: &MobSpec,
  group_size: u16,
  group_seed: u64,
  content_template: ID,
  creator: Combatant,
  creator_lines: vector<WeaponLine>,
  dials: Dials,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  create_inner(_w, registry, world, spawn_id, round, world_seed, anchor_x, anchor_z, spawned_at_ms, is_public, party_id, gated_joins, spec, group_size, group_seed, content_template, creator, creator_lines, option::none(), dials, version, clock, ctx);
}

fun create_inner<W: drop>(
  _w: W,
  registry: &mut FightRegistry,
  world: ID,
  spawn_id: u64,
  round: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  spec: &MobSpec,
  group_size: u16,
  group_seed: u64,
  content_template: ID,
  creator: Combatant,
  creator_lines: vector<WeaponLine>,
  creator_category: Option<String>,
  dials: Dials,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_enabled();
  let now = clock.timestamp_ms();
  let aged_bp = aging_bp(&dials, now, spawned_at_ms);
  let mut fight = assemble(
    registry, type_name::with_defining_ids<W>(), world, spawn_id, round, world_seed, anchor_x, anchor_z,
    is_public, party_id, gated_joins, aged_bp,
    GroupContent { template: content_template, xp: mob::spec_xp(spec), loot: mob::spec_loot(spec), kit: mob::kit_of(spec) },
    creator, dials, now, ctx,
  );

  let all_starts = union_starts_stored(&fight);
  let n_mobs = clamp_group(group_size as u64, dials.team_bound);
  let mut state = aresrpg_foundation::prng::rng_seed(group_seed);
  let mut i = 0;
  while (i < n_mobs) {
    let (m, st) = mob::spawn_seeded(spec, &fight.board.shape_mask, &fight.board.obstacles, &fight.board.holes, &all_starts, dials.archimob_bp, state);
    state = st;
    fight.mobs.push_back(m);
    i = i + 1;
  };

  seat_creator(fight, registry, creator_lines, creator_category);
}

/// The ONE Fight assembler both create paths share: the §17.23 0-HP gate, the board derivation, the first-come
/// derived-address claim, and the struct literal. The paths differ ONLY in what they seat afterwards (one spec ×
/// N mobs, or one spec per committed member) — keeping the literal here is what stops the two from drifting.
fun assemble(
  registry: &mut FightRegistry,
  brand: TypeName,
  world: ID,
  spawn_id: u64,
  round: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  aged_bp: u64,
  group: GroupContent,
  creator: Combatant,
  dials: Dials,
  now: u64,
  ctx: &TxContext,
): Fight {
  assert!(participant::combatant_hp(&creator) > 0, EZeroHp); // §17.23 — a 0-HP fighter cannot enter

  let bspec = board::generate_for_anchor(world_seed, anchor_x, anchor_z);
  assert!(bspec.start_cells_a().length() >= dials.team_bound, EBadStartCells);

  // The first-come gate. The branch is the whole #609 story: every fight ever created claimed the plain
  // (world, spawn_id) address, and a claimed address is `Reserved` forever — so a RE-ENGAGED group (round ≥ 1)
  // must claim in the round-namespaced key or its rematch would abort on an address nobody occupies any more.
  let id = if (round == 0) {
    sui::derived_object::claim(fight_registry::uid_mut(registry), fight_registry::new_key(world, spawn_id))
  } else {
    sui::derived_object::claim(fight_registry::uid_mut(registry), fight_registry::new_round_key(world, spawn_id, round))
  };

  Fight {
    id,
    brand,
    world,
    spawn_id,
    world_seed,
    anchor_x,
    anchor_z,
    public_fight: is_public,
    party_id,
    aged_bp,
    turn_ms: dials.turn_ms,
    placement_ms: dials.placement_ms,
    team_bound: dials.team_bound,
    xp_mult: dials.xp_mult,
    loot_mult: dials.loot_mult,
    status: STATUS_PLACEMENT,
    mode: MODE_PVM,
    winner_team: option::none(),
    gated_joins,
    participants: vector[participant::new(creator, ctx.sender(), 0, *bspec.start_cells_a().borrow(0))],
    mobs: vector[],
    board: geom_of(&bspec),
    fx: spell_board::empty(),
    queue: vector[],
    turn_ptr: 0,
    turn_deadline_ms: 0,
    last_action_ms: 0,
    placement_deadline_ms: now + dials.placement_ms,
    group,
  }
}

/// The shared create TAIL: attach the creator's weapon lines + §387 shape category, latch the seat, announce, share.
fun seat_creator(mut fight: Fight, registry: &mut FightRegistry, creator_lines: vector<WeaponLine>, creator_category: Option<String>) {
  let fid = object::id(&fight);
  let creator_id = participant::character(fight.participants.borrow(0));
  attach_weapon_lines(&mut fight, 0, creator_lines); // §17.27 wave-2a — the creator seats at index 0
  attach_weapon_category(&mut fight, 0, creator_category); // §387 — the creator's weapon shape category
  fight_registry::latch_character(registry, fight.brand, creator_id, fid); // S-12f — brand-scoped: one live fight per character per consumer
  fight_events::emit_created(fid, fight.world, fight.spawn_id, fight.anchor_x, fight.anchor_z, fight.public_fight, fight.aged_bp, fight.mobs.length());
  fight_events::emit_joined(fid, creator_id, 0);
  transfer::share_object(fight);
}

// ╔════════════════ [ THE MEMBER DOOR (#1110 amendment 3 — the hot-potato builder) ] ═ ]

/// A group under construction — a HOT POTATO (no abilities: it cannot be stored, dropped or copied, so the PTB
/// that opened it MUST finish it in the same transaction).
///
/// WHY A BUILDER AT ALL: a mixed pack needs N `&MobTemplate` shared objects in one create, and Move has no
/// `&vector<SharedObject>` — there is no signature that takes a variable roster. The potato is the seam: one
/// `add_member` command per template, each one checked against the commitment.
///
/// WHAT MAKES IT SAFE: `committed` is the roster the ZONE COMMITMENT binds (it rides the claim ticket, whose only
/// constructor sits behind the full claim gauntlet), and `add_member` accepts templates only in that exact order.
/// A caller cannot swap in a softer species, repeat the weakest row, or reorder the pack — the fight can only be
/// the fight the world advertised.
public struct GroupBuild {
  brand: TypeName,
  world: ID,
  spawn_id: u64,
  round: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  group_seed: u64,
  progress: u64, // §4 distance difficulty 0-1000 — the graded level window's input (#1111)
  content_template: ID, // the PRIMARY's template: the group's identity row, `committed[0]`
  committed: vector<ID>, // the roster the commitment binds, IN DRAW ORDER
  landed: vector<MobSpec>, // one spec per `add_member`, positional against `committed`
  creator: Combatant,
  creator_lines: vector<WeaponLine>,
  dials: Dials,
}

/// OPEN a member-list group. The consumer package unpacks its own claim ticket and passes the committed roster;
/// everything the fight needs is captured here so `add_member` and `create_members` take no trusted input.
public fun open_group<W: drop>(
  _w: W,
  world: ID,
  spawn_id: u64,
  round: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  gated_joins: bool,
  group_seed: u64,
  progress: u64,
  committed: vector<ID>,
  creator: Combatant,
  creator_lines: vector<WeaponLine>,
  dials: Dials,
  version: &Version,
): GroupBuild {
  version.assert_enabled();
  assert!(!committed.is_empty(), EPartialRoster); // a group with no committed member is not a group
  let content_template = committed[0];
  GroupBuild {
    brand: type_name::with_defining_ids<W>(),
    world, spawn_id, round, world_seed, anchor_x, anchor_z, spawned_at_ms, is_public, party_id, gated_joins,
    group_seed, progress, content_template, committed, landed: vector[], creator, creator_lines, dials,
  }
}

/// ADD the next committed member. The spec is the consumer's mirror of ITS template; `template_id` is that
/// template's object id, and it must equal the NEXT committed id — out-of-order, foreign, and duplicate
/// templates all abort here, which is the whole anti-swap mechanism (there is no second check downstream).
public fun add_member(build: &mut GroupBuild, template_id: ID, spec: &MobSpec) {
  let slot = build.landed.length();
  assert!(slot < build.committed.length(), ERosterFull);
  assert!(build.committed[slot] == template_id, EWrongMember);
  build.landed.push_back(*spec);
}

/// CONSUME the potato and build the fight: every committed member must have landed, then each seats from ITS OWN
/// spec at the graded level window. `group_size` is `min(committed roster, team bound)` — the roster is derived at
/// the RAW rolled size (stream law), the live bound only decides how many of it seat.
///
/// Per-member CONTENT (xp / loot / kit) lands as one indexed dynamic field per seated mob; the shared
/// `GroupContent` keeps the PRIMARY's block so every reader that never learns about members still reads something
/// true (and every pre-door fight keeps reading exactly what it read before).
public fun create_members(
  build: GroupBuild,
  registry: &mut FightRegistry,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_enabled();
  let GroupBuild {
    brand, world, spawn_id, round, world_seed, anchor_x, anchor_z, spawned_at_ms, is_public, party_id,
    gated_joins, group_seed, progress, content_template, committed, landed, creator, creator_lines, dials,
  } = build;
  assert!(landed.length() == committed.length(), EPartialRoster);

  let now = clock.timestamp_ms();
  let aged_bp = aging_bp(&dials, now, spawned_at_ms);
  let primary = &landed[0];
  let mut fight = assemble(
    registry, brand, world, spawn_id, round, world_seed, anchor_x, anchor_z, is_public, party_id, gated_joins,
    aged_bp,
    GroupContent { template: content_template, xp: mob::spec_xp(primary), loot: mob::spec_loot(primary), kit: mob::kit_of(primary) },
    creator, dials, now, ctx,
  );

  let all_starts = union_starts_stored(&fight);
  let n_mobs = clamp_group(landed.length(), dials.team_bound);
  let mut state = aresrpg_foundation::prng::rng_seed(group_seed);
  let mut i = 0;
  while (i < n_mobs) {
    let spec = &landed[i];
    let (m, st) = mob::spawn_seeded_graded(spec, &fight.board.shape_mask, &fight.board.obstacles, &fight.board.holes, &all_starts, dials.archimob_bp, progress, state);
    state = st;
    fight.mobs.push_back(m);
    df::add(&mut fight.id, MemberContentKey { index: i }, GroupContent {
      template: committed[i], xp: mob::spec_xp(spec), loot: mob::spec_loot(spec), kit: mob::kit_of(spec),
    });
    i = i + 1;
  };

  seat_creator(fight, registry, creator_lines, option::none()); // format-3 door: no §387 category input exists on GroupBuild
}

public fun create_pvp<W: drop>(
  _w: W,
  registry: &mut FightRegistry,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  per_side_bound: u64,
  creator: Combatant,
  dials: Dials,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  version.assert_enabled();
  assert!(per_side_bound >= 1 && per_side_bound <= dials.team_bound, EBadTeam);
  let now = clock.timestamp_ms();
  let bspec = board::generate_for_anchor(world_seed, anchor_x, anchor_z);
  assert!(bspec.start_cells_a().length() >= per_side_bound && bspec.start_cells_b().length() >= per_side_bound, EBadStartCells);
  let id = sui::derived_object::claim(fight_registry::uid_mut(registry), fight_registry::new_key(scope, nonce));
  let fid = id.to_inner();
  let creator_id = participant::combatant_character(&creator);

  let fight = Fight {
    id,
    brand: type_name::with_defining_ids<W>(),
    world: scope,
    spawn_id: nonce,
    world_seed,
    anchor_x,
    anchor_z,
    public_fight: false,
    party_id: option::none(),
    aged_bp: 0,
    turn_ms: dials.turn_ms,
    placement_ms: dials.placement_ms,
    team_bound: per_side_bound * 2,
    xp_mult: dials.xp_mult,
    loot_mult: dials.loot_mult,
    status: STATUS_PLACEMENT,
    mode: MODE_PVP,
    winner_team: option::none(),
    gated_joins: true,
    participants: vector[participant::new(participant::with_full_hp(creator), ctx.sender(), 0, *bspec.start_cells_a().borrow(0))],
    mobs: vector[],
    board: geom_of(&bspec),
    fx: spell_board::empty(),
    queue: vector[],
    turn_ptr: 0,
    turn_deadline_ms: 0,
    last_action_ms: 0,
    placement_deadline_ms: now + dials.placement_ms,
    group: GroupContent { template: scope, xp: 0, loot: vector[], kit: mob::empty_kit() }, // PvP: no mobs — settlement + kit never read (mode-gated)
  };
  fight_registry::latch_character(registry, fight.brand, creator_id, fid); // S-12f — brand-scoped: one live fight per character per consumer
  fight_events::emit_created(fid, scope, nonce, anchor_x, anchor_z, false, 0, 0);
  fight_events::emit_joined(fid, creator_id, 0);
  transfer::share_object(fight);
}

fun geom_of(bspec: &board::GridSpec): BoardGeom {
  BoardGeom {
    width: bspec.grid_width(),
    height: bspec.grid_height(),
    shape_mask: bspec.shape_mask(),
    obstacles: bspec.obstacles(),
    holes: bspec.holes(),
    start_cells_a: bspec.start_cells_a(),
    start_cells_b: bspec.start_cells_b(),
  }
}


public fun join<W: drop>(
  _w: W,
  fight: &mut Fight,
  registry: &mut FightRegistry,
  joiner: Combatant,
  joiner_lines: vector<WeaponLine>,
  joiner_category: Option<String>, // §387 — the joiner's equipped-weapon FINE category
  joiner_party: Option<ID>,
  team: u8,
  vouched: bool,
  version: &Version,
  ctx: &TxContext,
) {
  join_inner(_w, fight, registry, joiner, joiner_lines, joiner_category, joiner_party, team, vouched, version, ctx);
}

fun join_inner<W: drop>(
  _w: W,
  fight: &mut Fight,
  registry: &mut FightRegistry,
  joiner: Combatant,
  joiner_lines: vector<WeaponLine>,
  joiner_category: Option<String>,
  joiner_party: Option<ID>,
  team: u8,
  vouched: bool,
  version: &Version,
  ctx: &TxContext,
) {
  version.assert_enabled();
  assert!(fight.brand == type_name::with_defining_ids<W>(), EWrongBrand);
  assert!(team == 0 || (team == 1 && fight.mode == MODE_PVP), EBadTeam); // team 1 exists only in PvP fights
  if (!vouched) {
    assert!(!fight.gated_joins, EGatedJoins); // door-created fights seat only through vouched joins
    if (!fight.public_fight) {
      assert!(joiner_party.is_some() && fight.party_id.is_some() && *joiner_party.borrow() == *fight.party_id.borrow(), ENotParty);
    };
  };
  fight_registry::latch_character(registry, fight.brand, participant::combatant_character(&joiner), object::id(fight)); // S-12f (brand-scoped)
  let joiner = if (fight.mode == MODE_PVP) participant::with_full_hp(joiner) else joiner;
  let seat = seat_joiner(fight, joiner, ctx.sender(), team);
  attach_weapon_lines(fight, seat, joiner_lines); // §17.27 wave-2a
  attach_weapon_category(fight, seat, joiner_category); // §387 — the joiner's weapon shape category
}

fun seat_joiner(fight: &mut Fight, joiner: Combatant, owner: address, team: u8): u64 {
  assert!(fight.status == STATUS_PLACEMENT, ENotPlacement);
  assert!(participant::combatant_hp(&joiner) > 0, EZeroHp);
  assert!(fight.participants.length() < fight.team_bound, ETeamFull);
  let jid = participant::combatant_character(&joiner);
  assert!(seat_of(fight, jid).is_none(), EAlreadySeated); // F-01 — one character, one seat
  let seat = fight.participants.length();
  let side_idx = team_count(fight, team);
  if (fight.mode == MODE_PVP) assert!(side_idx < fight.team_bound / 2, ETeamFull);
  let cell = if (team == 0) *fight.board.start_cells_a.borrow(side_idx) else *fight.board.start_cells_b.borrow(side_idx);
  fight.participants.push_back(participant::new(joiner, owner, team, cell));
  fight_events::emit_joined(object::id(fight), jid, seat);
  seat
}

fun team_count(fight: &Fight, team: u8): u64 {
  let n = fight.participants.length();
  let (mut c, mut i) = (0, 0);
  while (i < n) { if (participant::team(fight.participants.borrow(i)) == team) c = c + 1; i = i + 1; };
  c
}


fun union_starts_stored(fight: &Fight): vector<u64> {
  let mut out = fight.board.start_cells_a;
  out.append(fight.board.start_cells_b);
  out
}

fun aging_bp(dials: &Dials, now: u64, spawned_at_ms: u64): u64 {
  if (now <= spawned_at_ms) return 0;
  let hours = (now - spawned_at_ms) / HOUR_MS;
  let bp = hours * dials.aging_bp_per_hour;
  let cap = dials.aging_cap_bp;
  if (bp > cap) cap else bp
}

fun clamp_group(v: u64, bound: u64): u64 {
  let capped = if (v > bound) bound else v;
  if (capped < 1) 1 else capped
}


public(package) fun brand(fight: &Fight): TypeName { fight.brand }


public(package) fun participants(fight: &Fight): &vector<Participant> { &fight.participants }
public(package) fun participants_mut(fight: &mut Fight): &mut vector<Participant> { &mut fight.participants }
public(package) fun mobs(fight: &Fight): &vector<FightMob> { &fight.mobs }
public(package) fun mobs_mut(fight: &mut Fight): &mut vector<FightMob> { &mut fight.mobs }
public(package) fun fx(fight: &Fight): &BoardState { &fight.fx }
public(package) fun fx_mut(fight: &mut Fight): &mut BoardState { &mut fight.fx }

public fun participant_count(fight: &Fight): u64 { fight.participants.length() }
public fun mob_count(fight: &Fight): u64 { fight.mobs.length() }

public(package) fun seat_of(fight: &Fight, character_id: ID): Option<u64> {
  let n = fight.participants.length();
  let mut i = 0;
  while (i < n) {
    if (participant::character(fight.participants.borrow(i)) == character_id) return option::some(i);
    i = i + 1;
  };
  option::none()
}


public(package) fun status(fight: &Fight): u8 { fight.status }
public(package) fun set_status(fight: &mut Fight, s: u8) { fight.status = s; }
public(package) fun turn_ptr(fight: &Fight): u64 { fight.turn_ptr }
public(package) fun turn_deadline_ms(fight: &Fight): u64 { fight.turn_deadline_ms }
public(package) fun last_action_ms(fight: &Fight): u64 { fight.last_action_ms }
public(package) fun set_last_action_ms(fight: &mut Fight, ms: u64) { fight.last_action_ms = ms; }
public(package) fun placement_deadline_ms(fight: &Fight): u64 { fight.placement_deadline_ms }
public(package) fun turn_ms(fight: &Fight): u64 { fight.turn_ms }
public(package) fun team_bound(fight: &Fight): u64 { fight.team_bound }
public(package) fun xp_mult(fight: &Fight): u64 { fight.xp_mult }
public(package) fun loot_mult(fight: &Fight): u64 { fight.loot_mult }

public(package) fun set_turn_ptr_and_deadline(fight: &mut Fight, ptr: u64, deadline: u64) {
  fight.turn_ptr = ptr;
  fight.turn_deadline_ms = deadline;
}

public(package) fun turn_seed(fight: &Fight, seat: u64): u64 {
  let disc = prng::mix(fight.world_seed, fight.spawn_id);
  let turned = prng::mix(disc, fight.turn_deadline_ms);
  prng::mix(turned, seat)
}

#[test_only]
public fun turn_seed_for_testing(fight: &Fight, seat: u64): u64 { turn_seed(fight, seat) }
public(package) fun set_queue(fight: &mut Fight, queue: vector<Actor>) { fight.queue = queue; }
public(package) fun queue_len(fight: &Fight): u64 { fight.queue.length() }
public(package) fun queue_actor(fight: &Fight, i: u64): Actor { *fight.queue.borrow(i) }


public(package) fun shape_mask(fight: &Fight): vector<u64> { fight.board.shape_mask }
public(package) fun obstacles(fight: &Fight): vector<u64> { fight.board.obstacles }
public(package) fun holes(fight: &Fight): vector<u64> { fight.board.holes }

public(package) fun all_start_cells(fight: &Fight): vector<u64> {
  let mut out = fight.board.start_cells_a;
  out.append(fight.board.start_cells_b);
  out
}

public(package) fun is_start_cell_a(fight: &Fight, cell: u64): bool { fight.board.start_cells_a.contains(&cell) }
public(package) fun is_start_cell_b(fight: &Fight, cell: u64): bool { fight.board.start_cells_b.contains(&cell) }


public fun aged_bp(fight: &Fight): u64 { fight.aged_bp }
public fun mode(fight: &Fight): u8 { fight.mode }
public fun winning_side(fight: &Fight): Option<u8> {
  if (fight.status == STATUS_VICTORY || fight.status == STATUS_DEFEAT) fight.winner_team else option::none()
}
public(package) fun set_winner(fight: &mut Fight, team: Option<u8>) { fight.winner_team = team; }
public(package) fun world(fight: &Fight): ID { fight.world }
public(package) fun group_template(fight: &Fight): ID { fight.group.template }
public(package) fun group_xp(fight: &Fight): u64 { fight.group.xp }
public(package) fun group_loot(fight: &Fight): &vector<MobLootEntry> { &fight.group.loot }
public(package) fun group_kit(fight: &Fight): &MobKit { &fight.group.kit }

// ── PER-MEMBER content (#1110): one indexed DF per seated mob, written by `create_members` ──

/// The dynamic-field key holding mob `index`'s own content block. Only the member door writes these; a fight
/// created through any other path has none, which is exactly what makes the accessor below total.
public struct MemberContentKey has copy, drop, store { index: u64 }

/// THE per-index content door — every group read in the package goes through it. ABSENT ⇒ the fight's shared
/// block, so a single-spec fight (and every fight that predates the member door) reads what it always read, with
/// no branch at the call site. One home for "what is mob `index` made of".
public(package) fun member_content(fight: &Fight, index: u64): &GroupContent {
  let k = MemberContentKey { index };
  if (df::exists(&fight.id, k)) df::borrow(&fight.id, k) else &fight.group
}

/// Does this fight seat SEVERAL specs? Settlement needs it (a mixed pack's loot checklist is the members' tables
/// concatenated, a mono pack's is one table repeated — §4.3 of the spec), and so does any reader deciding whether
/// one species name describes the whole board.
public fun is_mixed(fight: &Fight): bool { df::exists(&fight.id, MemberContentKey { index: 0 }) }

/// The SPECIES seated at mob `index` — the read a client, an indexer or a consumer needs to paint a mixed pack.
/// Falls back to the group's own template, so it answers for every fight ever created.
public fun mob_template_at(fight: &Fight, index: u64): ID { member_content(fight, index).template }

/// What mob `index` is worth in XP — the per-member half of the settlement kernel, readable from outside.
public fun mob_xp_at(fight: &Fight, index: u64): u64 { member_content(fight, index).xp }

public(package) fun content_template(c: &GroupContent): ID { c.template }
public(package) fun content_xp(c: &GroupContent): u64 { c.xp }
public(package) fun content_loot(c: &GroupContent): &vector<MobLootEntry> { &c.loot }
public(package) fun content_kit(c: &GroupContent): &MobKit { &c.kit }


// ╔════════════════ [ Dynamic-field reclaim (S-07 — `object::delete` does not track fields) ] ═ ]
//
// A field left attached at delete is unreachable FOREVER and its storage deposit is never rebated. Every family
// the engine writes onto this UID therefore has to be removed before the struct dies. Two shapes, because the
// families have two shapes:
//
//   • BOUNDED domain (per seat / per mob / per fighter-id) — `drop_field` in a loop over the known count. No
//     hot-path cost at all: the destroy walk regenerates the key space.
//   • UNBOUNDED domain (a spell ID or a board cell in the key) — the key space cannot be regenerated, so each
//     family carries a WRITE-SET INDEX: the first write of a key pushes it into `FieldIndexKey<K>`, and
//     `sweep_indexed` reclaims exactly those rows. One vector push per NEW key, never per write.
//
// Families live in the modules that own their key types (cast, retro_effects, displacement, action_envelope);
// `settlement::sweep_fields` is the one orchestrator that runs them all before `destroy` — a module that owns a
// key type cannot be imported here without a dependency cycle, so the generic seam lives here and the type
// knowledge stays where the keys are.

/// The write-set index of an unbounded key family: `FieldIndexKey<CastKey> → vector<CastKey>`.
public struct FieldIndexKey<phantom K> has copy, drop, store {}

/// Record a key of an UNBOUNDED family. Call once, on the branch that CREATES the row.
public(package) fun note_field<K: copy + drop + store>(fight: &mut Fight, key: K) {
  let ik = FieldIndexKey<K> {};
  if (!df::exists(&fight.id, ik)) df::add(&mut fight.id, ik, vector<K>[]);
  df::borrow_mut<FieldIndexKey<K>, vector<K>>(&mut fight.id, ik).push_back(key);
}

/// Reclaim one row of a BOUNDED family if it exists.
public(package) fun drop_field<K: copy + drop + store, V: store + drop>(fight: &mut Fight, key: K) {
  if (df::exists(&fight.id, key)) { let _: V = df::remove<K, V>(&mut fight.id, key); };
}

/// Reclaim every row of an UNBOUNDED family, plus the index itself.
public(package) fun sweep_indexed<K: copy + drop + store, V: store + drop>(fight: &mut Fight) {
  let ik = FieldIndexKey<K> {};
  if (!df::exists(&fight.id, ik)) return;
  let keys = df::remove<FieldIndexKey<K>, vector<K>>(&mut fight.id, ik);
  let mut i = 0;
  while (i < keys.length()) {
    drop_field<K, V>(fight, keys[i]);
    i = i + 1;
  };
}

/// Reclaim the three families THIS module writes: the per-member content blocks and the two seat-indexed weapon
/// families. All bounded, so the destroy walk regenerates the whole key space.
public(package) fun sweep_own_fields(fight: &mut Fight) {
  let seated = fight.mobs.length();
  let mut m = 0;
  while (m < seated) {
    let k = MemberContentKey { index: m };
    if (df::exists(&fight.id, k)) {
      let GroupContent { template: _, xp: _, loot: _, kit: _ } = df::remove<MemberContentKey, GroupContent>(&mut fight.id, k);
    };
    m = m + 1;
  };
  let seats = fight.participants.length();
  let mut s = 0;
  while (s < seats) {
    drop_field<WeaponLinesKey, vector<WeaponLine>>(fight, WeaponLinesKey { seat: s });
    drop_field<WeaponCategoryKey, String>(fight, WeaponCategoryKey { seat: s });
    s = s + 1;
  };
}

#[test_only]
/// Do this module's rows still exist? (Key structs are module-private — the probe must live here.)
public fun test_rows_exist(fight: &Fight, seat: u64, member: u64): bool {
  df::exists(&fight.id, WeaponLinesKey { seat })
    || df::exists(&fight.id, WeaponCategoryKey { seat })
    || df::exists(&fight.id, MemberContentKey { index: member })
}

public(package) fun destroy(mut fight: Fight) {
  sweep_own_fields(&mut fight);
  let Fight {
    id, brand: _, world: _, spawn_id: _, world_seed: _, anchor_x: _, anchor_z: _, public_fight: _, party_id: _, aged_bp: _,
    turn_ms: _, placement_ms: _, team_bound: _, xp_mult: _, loot_mult: _, status: _, mode: _, winner_team: _, gated_joins: _, participants: _, mobs: _,
    board, fx: _, queue: _, turn_ptr: _, turn_deadline_ms: _, last_action_ms: _, placement_deadline_ms: _, group,
  } = fight;
  let BoardGeom { width: _, height: _, shape_mask: _, obstacles: _, holes: _, start_cells_a: _, start_cells_b: _ } = board;
  let GroupContent { template: _, xp: _, loot: _, kit: _ } = group;
  object::delete(id);
}

public(package) fun id(fight: &Fight): ID { object::id(fight) }

public(package) fun uid_mut(fight: &mut Fight): &mut UID { &mut fight.id }
public(package) fun uid(fight: &Fight): &UID { &fight.id }


public struct WeaponLinesKey has copy, drop, store { seat: u64 }

public(package) fun attach_weapon_lines(fight: &mut Fight, seat: u64, lines: vector<WeaponLine>) {
  if (lines.is_empty()) return;
  df::add(&mut fight.id, WeaponLinesKey { seat }, lines);
}

public(package) fun weapon_lines_at(fight: &Fight, seat: u64): vector<WeaponLine> {
  let k = WeaponLinesKey { seat };
  if (df::exists(&fight.id, k)) *df::borrow<WeaponLinesKey, vector<WeaponLine>>(&fight.id, k) else vector[]
}

// §387 — the seat's equipped-weapon FINE CATEGORY, the key a shape-aware strike derives its cell set from. A
// per-seat DYNAMIC FIELD, upgrade-safe alongside the frozen `Participant`/`Weapon` layout exactly like the weapon
// lines above (the family already drives reach/element/AP via `Weapon`; only the SHAPE needs the raw slug).
// Absent (a tool / bare hands / a pre-§387 seat) ⇒ `none` ⇒ the 1-cell default.
public struct WeaponCategoryKey has copy, drop, store { seat: u64 }

public(package) fun attach_weapon_category(fight: &mut Fight, seat: u64, category: Option<String>) {
  if (category.is_none()) return;
  df::add(&mut fight.id, WeaponCategoryKey { seat }, category.destroy_some());
}

public(package) fun weapon_category_at(fight: &Fight, seat: u64): Option<String> {
  let k = WeaponCategoryKey { seat };
  if (df::exists(&fight.id, k)) option::some(*df::borrow<WeaponCategoryKey, String>(&fight.id, k)) else option::none()
}


#[test_only]
public struct TestBrand has drop {}

#[test_only]
public fun test_dials(): Dials { new_dials(60_000, 120_000, 6, 50, 100, 10_000, 100, 100) }

#[test_only]
public fun create_for_testing(
  registry: &mut FightRegistry,
  world: ID,
  spawn_id: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  spawned_at_ms: u64,
  is_public: bool,
  party_id: Option<ID>,
  spec: &MobSpec,
  group_size: u16,
  creator: Combatant,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  create(TestBrand {}, registry, world, spawn_id, world_seed, anchor_x, anchor_z, spawned_at_ms, is_public, party_id, false, spec, group_size, 42, world, creator, vector[], option::none(), test_dials(), version, clock, ctx);
}

#[test_only]
/// The member door under the test brand — the suite composes `open → add_member ×N → create_members` exactly as
/// a PTB does.
public fun open_group_for_testing(
  world: ID,
  spawn_id: u64,
  group_seed: u64,
  progress: u64,
  committed: vector<ID>,
  creator: Combatant,
  version: &Version,
): GroupBuild {
  open_group(TestBrand {}, world, spawn_id, 0, 12345, 100, 200, 0, true, option::none(), false, group_seed, progress, committed, creator, vector[], test_dials(), version)
}

#[test_only]
public fun create_dungeon_fight_for_testing(
  registry: &mut FightRegistry,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  creator: Combatant,
  spec: &MobSpec,
  group_size: u16,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  create(TestBrand {}, registry, scope, nonce, world_seed, anchor_x, anchor_z, clock.timestamp_ms(), false, option::none(), true, spec, group_size, 42, scope, creator, vector[], option::none(), test_dials(), version, clock, ctx);
}

#[test_only]
public fun create_pvp_fight_for_testing(
  registry: &mut FightRegistry,
  scope: ID,
  nonce: u64,
  world_seed: u64,
  anchor_x: u32,
  anchor_z: u32,
  per_side_bound: u64,
  creator: Combatant,
  version: &Version,
  clock: &Clock,
  ctx: &TxContext,
) {
  create_pvp(TestBrand {}, registry, scope, nonce, world_seed, anchor_x, anchor_z, per_side_bound, participant::with_full_hp(creator), test_dials(), version, clock, ctx);
}

#[test_only]
public fun join_for_testing(fight: &mut Fight, joiner: Combatant, joiner_party: Option<ID>, version: &Version, ctx: &TxContext) {
  version.assert_enabled();
  assert!(!fight.gated_joins, EGatedJoins);
  if (!fight.public_fight) {
    assert!(joiner_party.is_some() && fight.party_id.is_some() && *joiner_party.borrow() == *fight.party_id.borrow(), ENotParty);
  };
  seat_joiner(fight, joiner, ctx.sender(), 0);
}

#[test_only]
public fun join_latched_for_testing(fight: &mut Fight, registry: &mut FightRegistry, joiner: Combatant, joiner_party: Option<ID>, version: &Version, ctx: &TxContext) {
  fight_registry::latch_character(registry, fight.brand, participant::combatant_character(&joiner), object::id(fight));
  join_for_testing(fight, joiner, joiner_party, version, ctx);
}

#[test_only]
public fun set_status_active_for_testing(fight: &mut Fight) { fight.status = STATUS_ACTIVE; }

#[test_only]
public fun set_mode_pvp_for_testing(fight: &mut Fight) { fight.mode = MODE_PVP; }

#[test_only]
public fun seat_team_for_testing(fight: &mut Fight, joiner: Combatant, owner: address, team: u8) {
  let seat = fight.participants.length();
  let cell = *fight.board.start_cells_a.borrow(seat);
  fight.participants.push_back(participant::new(joiner, owner, team, cell));
}

#[test_only]
public fun join_with_cap_for_testing(fight: &mut Fight, joiner: Combatant, owner: address, team: u8) {
  let joiner = if (fight.mode == MODE_PVP) participant::with_full_hp(joiner) else joiner;
  seat_joiner(fight, joiner, owner, team);
}
