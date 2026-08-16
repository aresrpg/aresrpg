// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Zones — proof-of-discovery spawning (ruling 2026-08-09). Searching a zone draws FRESH
/// entropy: nothing is predictable before the act, so exploration is forced — and cheap: a
/// zone stores ONE seed + two consumed-bitmaps, nothing per mob. Everything DERIVES from the
/// seed through the deterministic PRNG (the client mirrors the same math):
///   the zone's BIOME (the seeded map) → its spawnable mob AND resource rows — exactly the
///   biome's authored config, nothing else (ruling 2026-08-14: no per-zone caps; mob weights
///   bias every pick) → groups whose count, SIZE and MIXED composition grow with DISTANCE
///   from the center (distance IS the rate) → resource packs, ditto.
/// A searched zone refreshes after the TTL with a new seed. Consumption (a fight claiming a
/// group, a gather claiming a node) flips one bit.
module aresrpg::zone;

use aresrpg::{character::Character, world::{Self, MobRow, World}};
use aresrpg_math::prng;
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, event, random::RandomGenerator};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongWorld: u64 = 1301; // search: the character stands in another world
const ENothingThere: u64 = 1302; // consume: index out of range or already taken
const ENotSearched: u64 = 1303; // derive/consume: the zone has no live search

const ZONE_SIZE: u32 = 512; // blocks per zone side
const RESEARCH_TTL_MS: u64 = 7_200_000; // 2h — then the next search redraws the seed

// ── the dials (rulings 2026-08-09) ──
// PACK COUNTS ARE FIXED per zone — never distance-scaled. Distance scales what's INSIDE:
// mob pack size + levels, resource nodes per pack.
const GROUPS_MIN: u64 = 48; // mob packs per zone (the LIVE shipped density — ruling 07-13)
const GROUPS_MAX: u64 = 64;
const RES_PACKS_MIN: u64 = 24; // resource packs per zone (the shipped band)
const RES_PACKS_MAX: u64 = 42;
const GROUP_SIZE_FULL_AT: u64 = 10_000; // always 6-mob packs from here (blocks from center)
const GROUP_SIZE_AVG3_AT: u64 = 2_000; // the hi-ramp anchor: avg 3 around here
const LEVEL_RAMP_AT: u64 = 20_000; // the level floor reaches its cap here
const LEVEL_FLOOR_CAP: u64 = 75; // far zones roll scalars in [75,100]
const NODES_RAMP_AT: u64 = 20_000; // nodes PER RESOURCE PACK: 2-4 at center → 16-22 here
const HOMOGENEOUS_BP: u64 = 5_000; // 50% of mob packs are single-family (levels still vary)
const PORTAL_BP: u64 = 1_000; // 10% of zone seeds spawn a dungeon portal (owner 2026-08-11)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// DF key on the World → the zone's state.
public struct ZoneKey has copy, drop, store { zx: u32, zz: u32 }

/// The whole cost of a discovered zone: one seed, one clock, one bitmap, one counter list.
/// Mob groups consume WHOLE (a fight claims the pack — one bit); resources consume BY NODE
/// (owner 2026-08-10: each node is one gather transaction) — `res_taken[i]` counts the nodes
/// already gathered from pack i, grown lazily to the touched index.
public struct Zone has copy, drop, store {
  seed: u64,
  searched_at_ms: u64,
  mob_taken: u128, // one bit per derived pack — up to 128
  res_taken: vector<u8>, // nodes consumed per resource pack
}

/// A derived mob group — never stored, always recomputed from the seed.
public struct MobGroup has copy, drop {
  index: u64,
  x: u32,
  z: u32,
  members: vector<MobMember>,
}

/// One mob in a group. `level_scalar` (0..100) maps into the template's level band at fight
/// seating — the same mob type rolls different levels member to member.
public struct MobMember has copy, drop {
  mob_type: String,
  level_scalar: u8,
}

/// A derived resource PACK — one point in the zone (a field, a vein) holding several nodes of
/// one resource. Never stored. `nodes` grows with distance: no lone wheat stalk, ever.
public struct ResourcePack has copy, drop {
  index: u64,
  x: u32,
  z: u32,
  item_type: String,
  nodes: u8,
}

public struct ZoneSearched has copy, drop { world: String, zx: u32, zz: u32, seed: u64, fresh: bool }

// ╔════════════════ [ Search (the discovery act) ] ═══════════════════════════ ]

/// Prove the walk to (x, z), then discover its zone: a missing or expired zone draws a fresh
/// seed (unpredictable before this very transaction); a live zone is a no-op re-read.
public(package) fun search(
  chr: &mut Character,
  x: u32,
  z: u32,
  w: &mut World,
  gen: &mut RandomGenerator,
  clock: &Clock,
) {
  let current = world::prove_move(chr, x, z, clock);
  assert!(current == w.name(), EWrongWorld);

  let (zx, zz) = (x / ZONE_SIZE, z / ZONE_SIZE);
  let key = ZoneKey { zx, zz };
  let now = clock.timestamp_ms();
  let uid = world::uid_mut(w);

  let (seed, fresh) = if (dfield::exists(uid, key)) {
    let zone: &mut Zone = dfield::borrow_mut(uid, key);
    if (now >= zone.searched_at_ms + RESEARCH_TTL_MS) {
      zone.seed = gen.generate_u32() as u64;
      zone.searched_at_ms = now;
      zone.mob_taken = 0;
      zone.res_taken = vector[];
      (zone.seed, true)
    } else {
      (zone.seed, false)
    }
  } else {
    let seed = gen.generate_u32() as u64;
    dfield::add(uid, key, Zone { seed, searched_at_ms: now, mob_taken: 0, res_taken: vector[] });
    (seed, true)
  };
  event::emit(ZoneSearched { world: current, zx, zz, seed, fresh });
}

// ╔════════════════ [ Derivation (pure — the client mirrors this math) ] ═════ ]

/// Chebyshev distance of the zone's center from the world center, in BLOCKS — every distance
/// dial reads this.
fun distance_blocks(zx: u32, zz: u32): u64 {
  let center = world::world_center() as u64;
  let px = (zx as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
  let pz = (zz as u64) * (ZONE_SIZE as u64) + (ZONE_SIZE as u64) / 2;
  let dx = if (px >= center) px - center else center - px;
  let dz = if (pz >= center) pz - center else center - pz;
  if (dx >= dz) dx else dz
}

fun ramp(d: u64, at: u64, from: u64, to: u64): u64 {
  let capped = if (d > at) at else d;
  from + (to - from) * capped / at
}

/// The rows a zone may spawn — exactly its biome's authored list (ruling 2026-08-14: the old
/// per-zone family cap is REPEALED for mobs; the config is the only limitation). A biome with
/// no rows (ocean) spawns nothing; resources and portals are unaffected.
fun biome_rows(w: &World, zx: u32, zz: u32): vector<MobRow> {
  let all = w.mobs();
  let biome = world::biome_of_zone(w, zx, zz);
  let mut rows = vector[];
  let mut k = 0;
  while (k < all.length()) {
    if (all[k].mob_row_biomes().contains(&biome)) rows.push_back(all[k]);
    k = k + 1;
  };
  rows
}

/// Every mob family the zone can spawn — the client's "what's huntable here" read.
public fun families(w: &World, zx: u32, zz: u32): vector<String> {
  let rows = biome_rows(w, zx, zz);
  let mut types = vector[];
  let mut i = 0;
  while (i < rows.length()) {
    types.push_back(rows[i].mob_row_type());
    i = i + 1;
  };
  types
}

/// One weighted family pick over the biome's rows — `weight_bp` is the ONLY bias (the config
/// shapes everything; `total` is the caller's precomputed weight sum, always > 0 here since
/// every row's weight is asserted ≥ 1 at authoring).
fun weighted_family(rows: &vector<MobRow>, total: u64, state: &mut u64): String {
  let roll = prng::draw(state) % total;
  let mut acc = 0u64;
  let mut j = 0;
  loop {
    acc = acc + (rows[j].mob_row_weight_bp() as u64);
    if (roll < acc) return rows[j].mob_row_type();
    j = j + 1;
  }
}

/// The zone's live mob groups. The rulings, mechanized:
///   size: lo ramps 1→6 over 10k blocks, hi ramps 1→6 anchored so ~2k blocks averages 3;
///   from 10k blocks every group is exactly 6.
///   levels: each member rolls a scalar whose FLOOR rises with distance — far zones only
///   roll high; the fight maps the scalar into the template's band.
///   composition: 50% of groups are single-family (same mob, different levels), 50% mix.
public fun mob_groups(w: &World, zx: u32, zz: u32): vector<MobGroup> {
  let zone = live_zone(w, zx, zz);
  let rows = biome_rows(w, zx, zz);
  if (rows.is_empty()) return vector[];
  let mut total = 0u64;
  let mut r = 0;
  while (r < rows.length()) {
    total = total + (rows[r].mob_row_weight_bp() as u64);
    r = r + 1;
  };
  let d = distance_blocks(zx, zz);
  let mut state = prng::rng_seed(prng::mix(zone.seed, 2));

  let count = GROUPS_MIN + prng::draw(&mut state) % (GROUPS_MAX - GROUPS_MIN + 1);
  let size_lo = ramp(d, GROUP_SIZE_FULL_AT, 1, 6);
  let size_hi_raw = ramp(d, GROUP_SIZE_AVG3_AT * 3, 1, 6); // reaches 6 by ~6k blocks (avg 3 near 2k)
  let size_hi = if (size_hi_raw < size_lo) size_lo else size_hi_raw;
  let level_floor = ramp(d, LEVEL_RAMP_AT, 0, LEVEL_FLOOR_CAP);

  let mut groups = vector[];
  let mut i = 0u64;
  while (i < count) {
    let gx = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let gz = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let size = size_lo + prng::draw(&mut state) % (size_hi - size_lo + 1);
    let homogeneous = prng::draw(&mut state) % 10_000 < HOMOGENEOUS_BP;
    let family = weighted_family(&rows, total, &mut state);
    let mut members = vector[];
    let mut m = 0u64;
    while (m < size) {
      let mob_type = if (homogeneous) family else weighted_family(&rows, total, &mut state);
      let scalar = level_floor + prng::draw(&mut state) % (101 - level_floor);
      members.push_back(MobMember { mob_type, level_scalar: (scalar as u8) });
      m = m + 1;
    };
    if (zone.mob_taken & (1u128 << (i as u8)) == 0) {
      groups.push_back(MobGroup { index: i, x: gx, z: gz, members });
    };
    i = i + 1;
  };
  groups
}

/// The zone's resource FAMILIES — every distinct type the ZONE'S OWN BIOME authors, nothing
/// else (ruling 2026-08-14, same law as mobs: no per-zone cap; the config is the only
/// limitation — hunting a resource = finding its biome).
public fun resource_families(w: &World, zx: u32, zz: u32): vector<String> {
  let all = w.resources();
  let biome = world::biome_of_zone(w, zx, zz);
  let mut picked = vector[];
  let mut k = 0;
  while (k < all.length()) {
    if (all[k].resource_row_biomes().contains(&biome)) picked.push_back(all[k].resource_row_type());
    k = k + 1;
  };
  picked
}

/// The zone's live resource packs: a FIXED count band (like mobs), each pack's NODE count
/// growing with distance (2-4 at center → 16-22 at 20k blocks). `nodes` is what REMAINS —
/// every gather takes one node; an exhausted pack disappears from the list.
public fun resource_packs(w: &World, zx: u32, zz: u32): vector<ResourcePack> {
  let zone = live_zone(w, zx, zz);
  let all = derive_res_packs(w, &zone, zx, zz);
  let mut packs = vector[];
  let mut i = 0;
  while (i < all.length()) {
    let ResourcePack { index, x, z, item_type, nodes } = all[i];
    let taken = taken_of(&zone.res_taken, index);
    if (taken < nodes) {
      packs.push_back(ResourcePack { index, x, z, item_type, nodes: nodes - taken });
    };
    i = i + 1;
  };
  packs
}

/// EVERY pack the seed spawns, with TOTAL node counts — the one derivation home; consumption
/// is the callers' concern.
fun derive_res_packs(w: &World, zone: &Zone, zx: u32, zz: u32): vector<ResourcePack> {
  let picked = resource_families(w, zx, zz);
  if (picked.is_empty()) return vector[];
  let d = distance_blocks(zx, zz);
  let mut state = prng::rng_seed(prng::mix(zone.seed, 3));

  let nodes_lo = ramp(d, NODES_RAMP_AT, 2, 16);
  let nodes_hi = ramp(d, NODES_RAMP_AT, 4, 22);
  let count = RES_PACKS_MIN + prng::draw(&mut state) % (RES_PACKS_MAX - RES_PACKS_MIN + 1);
  let mut packs = vector[];
  let mut i = 0u64;
  while (i < count) {
    let nx = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let nz = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
    let item_type = picked[prng::draw(&mut state) % picked.length()];
    let nodes = nodes_lo + prng::draw(&mut state) % (nodes_hi - nodes_lo + 1);
    packs.push_back(ResourcePack { index: i, x: nx, z: nz, item_type, nodes: (nodes as u8) });
    i = i + 1;
  };
  packs
}

fun taken_of(res_taken: &vector<u8>, index: u64): u8 {
  if (index < res_taken.length()) res_taken[index] else 0
}

// ╔════════════════ [ Consumption (fight and gather flip one bit) ] ══════════ ]

public(package) fun consume_mob_group(w: &mut World, zx: u32, zz: u32, index: u64) {
  assert!(index < 128, ENothingThere);
  let zone = live_zone_mut(w, zx, zz);
  let bit = 1u128 << (index as u8);
  assert!(zone.mob_taken & bit == 0, ENothingThere);
  zone.mob_taken = zone.mob_taken | bit;
}

/// The pack at `index` with its REMAINING nodes — gathering's gates read it (a read; the
/// write is `consume_resource_node`). Aborts on a spent or unknown pack.
public fun resource_pack_at(w: &World, zx: u32, zz: u32, index: u64): ResourcePack {
  let zone = live_zone(w, zx, zz);
  let all = derive_res_packs(w, &zone, zx, zz);
  assert!(index < all.length(), ENothingThere);
  let ResourcePack { index: idx, x, z, item_type, nodes } = all[index];
  let taken = taken_of(&zone.res_taken, index);
  assert!(taken < nodes, ENothingThere);
  ResourcePack { index: idx, x, z, item_type, nodes: nodes - taken }
}

/// Gather ONE node off pack `index` (owner 2026-08-10: one node = one transaction). The count
/// re-checks against the derived total — the door never trusts its caller's read.
public(package) fun consume_resource_node(w: &mut World, zx: u32, zz: u32, index: u64) {
  let zone_read = live_zone(w, zx, zz);
  let all = derive_res_packs(w, &zone_read, zx, zz);
  assert!(index < all.length(), ENothingThere);
  let total = all[index].nodes;
  let zone = live_zone_mut(w, zx, zz);
  while ((zone.res_taken.length() as u64) <= index) zone.res_taken.push_back(0);
  let taken = &mut zone.res_taken[index];
  assert!(*taken < total, ENothingThere);
  *taken = *taken + 1;
}

// ╔════════════════ [ Reads + internals ] ════════════════════════════════════ ]

public fun zone_size(): u32 { ZONE_SIZE }

/// The live seed — the fight derives its board from it (client pre-renders before engaging).
public fun seed_of(w: &World, zx: u32, zz: u32): u64 { live_zone(w, zx, zz).seed }

/// The DUNGEON PORTAL of a searched zone — pure derivation off the seed (owner 2026-08-11):
/// PORTAL_BP of zone seeds spawn one, position derived, nothing stored. It lives exactly as
/// long as the zone's seed does (2h TTL, then a re-search may or may not redraw one) — the
/// "while the portal is there and the zone isn't rerolled" law rides the seed for free.
/// Returns `(present, x, z)` — `present` false = no portal here (the coords are then 0,0).
public fun portal_of(w: &World, zx: u32, zz: u32): (bool, u32, u32) {
  if (w.dungeon_room_count() == 0) return (false, 0, 0);
  let seed = live_zone(w, zx, zz).seed;
  let mut state = prng::rng_seed(prng::mix(seed, 5));
  if (prng::draw(&mut state) % 10_000 >= PORTAL_BP) return (false, 0, 0);
  let px = (zx * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
  let pz = (zz * ZONE_SIZE) + ((prng::draw(&mut state) % (ZONE_SIZE as u64)) as u32);
  (true, px, pz)
}

/// The zone's mob level FLOOR (the distance law) — the protector ambush rolls its scalar
/// over the same ramp the zone's own mobs use.
public fun level_floor(zx: u32, zz: u32): u64 {
  ramp(distance_blocks(zx, zz), LEVEL_RAMP_AT, 0, LEVEL_FLOOR_CAP)
}

fun live_zone(w: &World, zx: u32, zz: u32): Zone {
  let uid = world::uid(w);
  assert!(dfield::exists(uid, ZoneKey { zx, zz }), ENotSearched);
  *dfield::borrow(uid, ZoneKey { zx, zz })
}

fun live_zone_mut(w: &mut World, zx: u32, zz: u32): &mut Zone {
  let uid = world::uid_mut(w);
  assert!(dfield::exists(uid, ZoneKey { zx, zz }), ENotSearched);
  dfield::borrow_mut(uid, ZoneKey { zx, zz })
}

public fun group_index(group: &MobGroup): u64 { group.index }

public fun group_x(group: &MobGroup): u32 { group.x }

public fun group_z(group: &MobGroup): u32 { group.z }

public fun group_members(group: &MobGroup): vector<MobMember> { group.members }

public fun member_type(member: &MobMember): String { member.mob_type }

public fun member_level_scalar(member: &MobMember): u8 { member.level_scalar }

/// Build a member outside a zone draw — the dungeon seats its authored room mobs through the
/// SAME `add_mob` path as a zone group.
public fun new_member(mob_type: String, level_scalar: u8): MobMember {
  MobMember { mob_type, level_scalar }
}

public fun pack_index(pack: &ResourcePack): u64 { pack.index }

public fun pack_x(pack: &ResourcePack): u32 { pack.x }

public fun pack_z(pack: &ResourcePack): u32 { pack.z }

public fun pack_item_type(pack: &ResourcePack): String { pack.item_type }

public fun pack_nodes(pack: &ResourcePack): u8 { pack.nodes }
