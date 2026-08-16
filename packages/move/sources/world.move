// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The 20 hardcoded worlds + everything about a character's place in them. Position lives as
/// dynamic fields ON the character (one checkpoint per visited world — automatic memory), so
/// joining and moving touch zero shared objects. The shared `World` objects carry per-world
/// content settings (mobs, resources, dungeon key — designed later) and load only when read.
module aresrpg::world;

use aresrpg::{character::Character, equipment, progression};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EUnknownWorld: u64 = 301;
const ELevelTooLow: u64 = 302;
const ENotInWorld: u64 = 303;
const EOutOfBounds: u64 = 304;
const ETravelTooFar: u64 = 305;

/// Worlds are BOUNDED at 100k × 100k (owner 2026-08-14) — small enough that the biome map
/// covers EVERY zone (196² cells), so the chain's biome truth is total, never approximate.
const WORLD_SIZE: u32 = 100_000;
/// Chain coords are unsigned — the center maps to the client's 0;0 (the corner-bug law).
const WORLD_CENTER: u32 = 50_000;
/// Game-wide, blocks/sec ×100 fixed-point — engine RUN_SPEED 10.5 b/s +10% terrain slack.
const SPEED_BUDGET: u64 = 1150;
const SPEED_SCALE: u64 = 100_000; // ÷100 (fixed-point) then ÷1000 (ms→s)
const PET_NUM: u64 = 3; // pet = ×1.5
const PET_DEN: u64 = 2;
const MAX_LINEAR: u64 = 1_000_000; // dwarfs any in-world distance; overflow guard for the square

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One shared object per world — the content settings home. Filled by the seeding
/// (SeedCap-gated doors, so the one seal closes world content too); after the seal no door can
/// ever write again — immutability by door-absence. Identity and entry level stay hardcoded law.
public struct World has key {
  id: UID,
  name: String,
  mobs: vector<MobRow>,
  resources: vector<ResourceRow>,
  dungeon_key: Option<String>, // the key item's slug — a key burns to enter this world's dungeon
  dungeon_rooms: vector<DungeonRoom>, // the room sequence; last room carries the boss (empty = no dungeon)
  biome_map: BiomeMap, // one biome id per zone — the spawn filter's ground truth
}

/// The world's biome grid at ZONE granularity, derived by the seeding from the terrain
/// recipe (the engine's own sampler — parity by construction, never a second implementation).
/// Biome id = index into the recipe's biome array. An EMPTY map (side 0) reads 0 everywhere:
/// a world without a terrain recipe seeds its mobs as biome 0 — "the whole world" — so
/// map-less worlds spawn exactly as before. A seeded map covers the WHOLE bounded world
/// (window (0,0) side 196 ≥ every zone of a 100k world); its cells exceed the 16,384-byte
/// pure-argument cap, so the seeding declares the window once and APPENDS cell slices —
/// atomic when the calls share one PTB. Edge clamping survives only as a never-hit guard.
public struct BiomeMap has copy, drop, store {
  zone_x0: u32, // window origin, in zone coords
  zone_z0: u32,
  side: u16, // window is side × side zones; 0 = no map
  cells: vector<u8>, // row-major [ (zz - zone_z0) * side + (zx - zone_x0) ]
}

/// One dungeon room: the mobs seated when it is engaged (the last room's list carries the
/// boss). `scalar` (0..100) maps each mob into its template's level band, like a zone member.
public struct DungeonRoom has copy, drop, store {
  mobs: vector<RoomMob>,
}

public struct RoomMob has copy, drop, store {
  mob_type: String,
  level_scalar: u8,
}

/// A mob family of this world and the biomes it roams (ruling 2026-08-14: the config is the
/// only spawn limit; one row per mob — a mob needing DIFFERENT weights per biome is two rows
/// with disjoint biome lists). Weight biases every family pick among the zone's biome rows.
/// Group SIZE and COMPOSITION are not authored — they roll from distance + the zone seed
/// (ruling 2026-08-09), mixing families freely. Bosses never roam (dungeon rooms, always alone).
public struct MobRow has copy, drop, store {
  mob_type: String,
  weight_bp: u16,
  biomes: vector<u8>, // every biome id this mob spawns in ([0] = whole world while the map is empty)
}

/// A gatherable resource: which item mints, which JOB works it, its tier, the protector
/// mob that may ambush (the 2% law lives in gathering), and the GOLDEN-GATHER rare variant
/// (the 0.1% additive jackpot; empty = none). No rate — abundance grows with distance from
/// the center (distance IS the rate).
public struct ResourceRow has copy, drop, store {
  item_type: String,
  job: String, // FARMER | HERBALIST | MINER (the tool derives — tool_of_job)
  tier: u8,
  protector: String, // mob_type; empty = this resource never ambushes
  rare_item_type: String, // the linked rare variant; empty = no jackpot draw
  biomes: vector<u8>, // every biome id this resource spawns in ([0] = whole world while the
  // map is empty) — ONE row per resource, so divergent per-biome copies cannot exist
}

/// DF key on the character → the world it is in NOW (a `String` world name).
public struct CurrentWorldKey has copy, drop, store {}

/// DF key on the character → its `Checkpoint` in that world. One per visited world.
public struct CheckpointKey(String) has copy, drop, store;

/// The last proven position — everything the speed check needs rides here.
public struct Checkpoint has copy, drop, store {
  x: u32,
  z: u32,
  at_ms: u64,
  pet: bool, // ×1.5 speed; written by the equipment layer later
}

public struct WorldJoined has copy, drop { character: ID, world: String, x: u32, z: u32, first_join: bool }

// ╔════════════════ [ init — the 20 worlds ] ═════════════════════════════════ ]

fun init(ctx: &mut TxContext) {
  let mut names = world_names();
  while (!names.is_empty()) {
    transfer::share_object(World {
      id: object::new(ctx),
      name: names.pop_back(),
      mobs: vector[],
      resources: vector[],
      dungeon_key: option::none(),
      dungeon_rooms: vector[],
      biome_map: BiomeMap { zone_x0: 0, zone_z0: 0, side: 0, cells: vector[] },
    });
  };
}

// ╔════════════════ [ Content authoring (seeding doors, sealed with the rest) ] ═══════ ]

const EInvalidRate: u64 = 306; // authoring: a zero or >100% family weight
const EInvalidBiomeMap: u64 = 311; // authoring: cells do not fill the declared side × side window
const EInvalidJob: u64 = 308; // authoring: not one of the 3 gathering jobs
const ENoSuchResource: u64 = 309; // resource_row_of: this world does not spawn that resource
const EEmptyRoom: u64 = 310; // new_dungeon_room: a room with no mobs is meaningless

public fun new_mob_row(mob_type: String, weight_bp: u16, biomes: vector<u8>): MobRow {
  assert!(weight_bp > 0 && weight_bp <= 10000, EInvalidRate);
  assert!(!biomes.is_empty(), EInvalidRate);
  MobRow { mob_type, weight_bp, biomes }
}

/// Declare the map window and clear any previous cells — the seeding's first map call.
public(package) fun set_biome_map_window(world: &mut World, zone_x0: u32, zone_z0: u32, side: u16) {
  world.biome_map = BiomeMap { zone_x0, zone_z0, side, cells: vector[] };
}

/// Append one slice of cells. A full 196² map exceeds Sui's 16,384-byte pure-argument cap,
/// so the seeding uploads slices — window + appends share one PTB, so the partial state is
/// never observable between transactions (and `biome_of_zone` aborts on it regardless).
public(package) fun append_biome_map_cells(world: &mut World, cells: vector<u8>) {
  world.biome_map.cells.append(cells);
  let side = world.biome_map.side as u64;
  assert!(world.biome_map.cells.length() <= side * side, EInvalidBiomeMap);
}

public fun new_resource_row(
  item_type: String,
  job: String,
  tier: u8,
  protector: String,
  rare_item_type: String,
  biomes: vector<u8>,
): ResourceRow {
  assert!(
    job == b"FARMER".to_string() || job == b"HERBALIST".to_string() || job == b"MINER".to_string(),
    EInvalidJob,
  );
  assert!(!biomes.is_empty(), EInvalidRate);
  ResourceRow { item_type, job, tier, protector, rare_item_type, biomes }
}

/// Overwrite-while-unsealed: the seeding may correct itself until the seal; then never again.
public(package) fun set_mobs(world: &mut World, rows: vector<MobRow>) { world.mobs = rows; }

public(package) fun set_resources(world: &mut World, rows: vector<ResourceRow>) { world.resources = rows; }

public(package) fun set_dungeon_key(world: &mut World, item_type: String) {
  world.dungeon_key = option::some(item_type);
}

public fun new_room_mob(mob_type: String, level_scalar: u8): RoomMob {
  RoomMob { mob_type, level_scalar }
}

public fun new_dungeon_room(mobs: vector<RoomMob>): DungeonRoom {
  assert!(!mobs.is_empty(), EEmptyRoom);
  DungeonRoom { mobs }
}

public(package) fun set_dungeon_rooms(world: &mut World, rooms: vector<DungeonRoom>) {
  world.dungeon_rooms = rooms;
}

/// Zone state rides the World's UID — the zone module is the only writer.
public(package) fun uid(world: &World): &UID { &world.id }

public(package) fun uid_mut(world: &mut World): &mut UID { &mut world.id }

public fun world_center(): u32 { WORLD_CENTER }

// ╔════════════════ [ Content reads ] ═════════════════════════════════════════ ]

public fun name(world: &World): String { world.name }

public fun mobs(world: &World): vector<MobRow> { world.mobs }

public fun resources(world: &World): vector<ResourceRow> { world.resources }

public fun dungeon_key(world: &World): Option<String> { world.dungeon_key }

public fun dungeon_room_count(world: &World): u64 { world.dungeon_rooms.length() }

/// The mobs of room `n` (1-based) — the dungeon seats these when the room is engaged.
public fun dungeon_room_mobs(world: &World, room: u64): vector<RoomMob> {
  world.dungeon_rooms[room - 1].mobs
}

public fun room_mob_type(m: &RoomMob): String { m.mob_type }

public fun room_mob_scalar(m: &RoomMob): u8 { m.level_scalar }

public fun mob_row_type(row: &MobRow): String { row.mob_type }

public fun mob_row_weight_bp(row: &MobRow): u16 { row.weight_bp }

public fun mob_row_biomes(row: &MobRow): vector<u8> { row.biomes }

/// The biome of zone (zx, zz) — the ONE read every spawn filter goes through. An empty map
/// answers 0 for every zone. A seeded map covers every zone of the bounded world, so the
/// edge clamp below is a never-hit guard, not a semantic.
public fun biome_of_zone(world: &World, zx: u32, zz: u32): u8 {
  let map = &world.biome_map;
  if (map.side == 0) return 0;
  // A declared window with missing cells is a half-run seeding — abort loudly rather than
  // serve a wrong biome (the whole design is that the chain's biome truth is TOTAL).
  assert!(map.cells.length() == (map.side as u64) * (map.side as u64), EInvalidBiomeMap);
  let last = (map.side as u32) - 1;
  let cx = clamp_to_window(zx, map.zone_x0, last);
  let cz = clamp_to_window(zz, map.zone_z0, last);
  map.cells[(cz as u64) * (map.side as u64) + (cx as u64)]
}

fun clamp_to_window(zone: u32, origin: u32, last: u32): u32 {
  if (zone <= origin) 0 else if (zone - origin >= last) last else zone - origin
}

public fun resource_row_type(row: &ResourceRow): String { row.item_type }

public fun resource_row_job(row: &ResourceRow): String { row.job }

public fun resource_row_tier(row: &ResourceRow): u8 { row.tier }

public fun resource_row_protector(row: &ResourceRow): String { row.protector }

public fun resource_row_rare(row: &ResourceRow): String { row.rare_item_type }

public fun resource_row_biomes(row: &ResourceRow): vector<u8> { row.biomes }

/// The authored row for a resource type — gathering's gates read it. Aborts when the world
/// does not spawn this resource (a derived pack always has its row; absence is a code bug).
public fun resource_row_of(world: &World, item_type: String): ResourceRow {
  let mut i = 0;
  while (i < world.resources.length()) {
    if (world.resources[i].item_type == item_type) return world.resources[i];
    i = i + 1;
  };
  abort ENoSuchResource
}

// ╔════════════════ [ Travel ] ═══════════════════════════════════════════════ ]

/// The STAR GATE (ruling 2026-08-09): every world's portal stands at its center (client 0;0).
/// Switching requires WALKING to the portal — the character proves travel to the center of its
/// CURRENT world, then materializes at the DESTINATION portal. A fresh character (no world
/// yet) joins free: there is no origin gate to walk to. The level requirement checks every
/// time. Package-private: the public door is `api::join_world` (kiosk-borrowing).
public(package) fun join_world(character: &mut Character, world: String, clock: &Clock) {
  assert!(character.level() >= entry_level(&world), ELevelTooLow);
  progression::touch(character, clock);

  let character_id = character.id();
  let now = clock.timestamp_ms();
  let in_a_world = dfield::exists(character.uid_mut(), CurrentWorldKey {});
  // Reaching the gate coord IS the whole proof — the speed check to the portal.
  if (in_a_world) { prove_move(character, WORLD_CENTER, WORLD_CENTER, clock); };

  let uid = character.uid_mut();
  if (in_a_world) {
    *dfield::borrow_mut(uid, CurrentWorldKey {}) = world;
  } else {
    dfield::add(uid, CurrentWorldKey {}, world);
  };

  // Arrival = the destination portal. The pet flag RE-DERIVES from the live equipment —
  // a stale flag from a past visit would be free speed (or stolen speed) forever.
  let pet = equipment::pet_equipped(character);
  let uid = character.uid_mut();
  let first_join = !dfield::exists(uid, CheckpointKey(world));
  if (first_join) {
    dfield::add(uid, CheckpointKey(world), Checkpoint { x: WORLD_CENTER, z: WORLD_CENTER, at_ms: now, pet });
  } else {
    let cp: &mut Checkpoint = dfield::borrow_mut(uid, CheckpointKey(world));
    cp.x = WORLD_CENTER;
    cp.z = WORLD_CENTER;
    cp.at_ms = now;
    cp.pet = pet;
  };
  event::emit(WorldJoined { character: character_id, world, x: WORLD_CENTER, z: WORLD_CENTER, first_join });
}

/// Every future world interaction (fight, gather, …) calls this: proves the character could
/// have walked from its last checkpoint to (x, z) at the speed budget, then saves the new
/// position. Returns the current world name for the caller's own logic.
public(package) fun prove_move(character: &mut Character, x: u32, z: u32, clock: &Clock): String {
  assert!(x < WORLD_SIZE && z < WORLD_SIZE, EOutOfBounds);
  progression::touch(character, clock);
  // The ×1.5 pet speed is a BOTH-END rule (audit 2026-08-10): a pet on the slot NOW earns
  // the boost only over a leg that also STARTED with a pet — never retroactively over time
  // banked before it was equipped. `cp.pet` is the start-point snapshot; this saves the
  // live state as the next leg's start.
  let pet_now = equipment::pet_equipped(character);
  let (world, cp) = current_checkpoint_mut(character);
  let now = clock.timestamp_ms();
  assert!(travel_ok(cp, x, z, now, pet_now), ETravelTooFar);
  cp.x = x;
  cp.z = z;
  cp.at_ms = now;
  cp.pet = pet_now;
  world
}

/// ROOT the character in place until `extra_ms` from now (the hytale gather-time law,
/// owner 2026-08-10): a FUTURE-dated checkpoint makes `travel_ok` refuse every proof —
/// no move, no next gather, no fight join — until the clock catches up. The gather duration
/// rides the machinery that already exists instead of a new timer field.
public(package) fun delay_checkpoint(character: &mut Character, extra_ms: u64, clock: &Clock) {
  let (_, cp) = current_checkpoint_mut(character);
  cp.at_ms = clock.timestamp_ms() + extra_ms;
}

/// Is the character ROOTED right now? A future-dated checkpoint (`at_ms > now`) means a
/// gather-time root or a fired protector verdict is holding them — no action may fire until
/// the clock catches up. Every out-of-fight action door that isn't itself a `prove_move`
/// (consumables) must gate on this, or a recall potion would wipe the root.
public(package) fun is_rooted(character: &Character, clock: &Clock): bool {
  let uid = character.uid();
  assert!(dfield::exists(uid, CurrentWorldKey {}), ENotInWorld);
  let world: String = *dfield::borrow(uid, CurrentWorldKey {});
  let cp: &Checkpoint = dfield::borrow(uid, CheckpointKey(world));
  cp.at_ms > clock.timestamp_ms()
}

/// TELEPORT TO CENTER (the recall consumable): the checkpoint jumps to the world portal
/// (client 0;0), exactly like a fresh arrival — the pet flag re-derives, the clock resets.
public(package) fun teleport_center(character: &mut Character, clock: &Clock) {
  let pet = equipment::pet_equipped(character);
  let now = clock.timestamp_ms();
  let (_, cp) = current_checkpoint_mut(character);
  cp.x = WORLD_CENTER;
  cp.z = WORLD_CENTER;
  cp.at_ms = now;
  cp.pet = pet;
}

/// The ONE door to the current world's checkpoint — every writer (`prove_move`,
/// `delay_checkpoint`) reads and mutates through here; nobody re-derives the DF pair.
fun current_checkpoint_mut(character: &mut Character): (String, &mut Checkpoint) {
  let uid = character.uid_mut();
  assert!(dfield::exists(uid, CurrentWorldKey {}), ENotInWorld);
  let world: String = *dfield::borrow(uid, CurrentWorldKey {});
  (world, dfield::borrow_mut(uid, CheckpointKey(world)))
}

/// Exact squared-distance compare (consensus path — no sqrt), saturating overflow guard.
/// The ×1.5 boost needs a pet at BOTH ends: `cp.pet` (the leg's start) AND `pet_now`.
fun travel_ok(cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_now: bool): bool {
  if (now_ms < cp.at_ms) return false;
  let eff = if (cp.pet && pet_now) SPEED_BUDGET * PET_NUM / PET_DEN else SPEED_BUDGET;
  let budget = (now_ms - cp.at_ms) * eff / SPEED_SCALE; // blocks
  if (budget >= MAX_LINEAR) return true;
  let dx = abs_diff(to_x, cp.x);
  let dz = abs_diff(to_z, cp.z);
  budget * budget >= dx * dx + dz * dz
}

fun abs_diff(a: u32, b: u32): u64 {
  if (a > b) ((a - b) as u64) else ((b - a) as u64)
}

// ╔════════════════ [ The 20 worlds — hardcoded law ] ════════════════════════ ]

/// Where every fresh character spawns.
public fun first_world(): String { b"01_first_shore".to_string() }

/// Entry level of a world — the single gate function. Aborts `EUnknownWorld` on any other name.
public fun entry_level(world: &String): u16 {
  if (*world == b"01_first_shore".to_string()) return 1;
  if (*world == b"02_verdant_hollow".to_string()) return 1;
  if (*world == b"03_emberfall_steppe".to_string()) return 10;
  if (*world == b"04_mistral_heights".to_string()) return 14;
  if (*world == b"05_drowned_fen".to_string()) return 18;
  if (*world == b"06_pandora_reach".to_string()) return 22;
  if (*world == b"07_cinderforge_depths".to_string()) return 30;
  if (*world == b"08_palewood".to_string()) return 34;
  if (*world == b"09_coral_throne".to_string()) return 40;
  if (*world == b"10_sunspire_dunes".to_string()) return 45;
  if (*world == b"11_rootheart".to_string()) return 52;
  if (*world == b"12_static_fields".to_string()) return 60;
  if (*world == b"13_mirrormere".to_string()) return 68;
  if (*world == b"14_charnel_marches".to_string()) return 75;
  if (*world == b"15_silent_atoll".to_string()) return 82;
  if (*world == b"16_the_sundering".to_string()) return 95;
  if (*world == b"17_obsidian_choir".to_string()) return 110;
  if (*world == b"18_abyssal_weald".to_string()) return 125;
  if (*world == b"19_hollow_crown".to_string()) return 145;
  if (*world == b"20_zenith_scar".to_string()) return 170;
  abort EUnknownWorld
}

fun world_names(): vector<String> {
  vector[
    b"01_first_shore".to_string(),
    b"02_verdant_hollow".to_string(),
    b"03_emberfall_steppe".to_string(),
    b"04_mistral_heights".to_string(),
    b"05_drowned_fen".to_string(),
    b"06_pandora_reach".to_string(),
    b"07_cinderforge_depths".to_string(),
    b"08_palewood".to_string(),
    b"09_coral_throne".to_string(),
    b"10_sunspire_dunes".to_string(),
    b"11_rootheart".to_string(),
    b"12_static_fields".to_string(),
    b"13_mirrormere".to_string(),
    b"14_charnel_marches".to_string(),
    b"15_silent_atoll".to_string(),
    b"16_the_sundering".to_string(),
    b"17_obsidian_choir".to_string(),
    b"18_abyssal_weald".to_string(),
    b"19_hollow_crown".to_string(),
    b"20_zenith_scar".to_string(),
  ]
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun test_init(ctx: &mut TxContext) { init(ctx) }
