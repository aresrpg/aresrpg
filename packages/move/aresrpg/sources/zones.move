// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// ZONES — world membership, sparse search state, and authenticated mob/resource consumption. Search stores a
/// seed, bitmaps, and an adjacent mob-root DF derived on chain from the advertised facts. Original claims retain
/// live derivation; proof claims authenticate committed search-time facts before sharing the same security tail.
module aresrpg::zones;

use aresrpg::{
  admin::AdminCap,
  character_link,
  checkpoint,
  config::GameConfig,
  equipment,
  version::Version,
  world::{Self, World},
  zone_comp
};
use aresrpg_foundation::{world_math, zone_gen};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, dynamic_field as df, event, kiosk::Kiosk, random::{Self, Random, RandomGenerator}, vec_map::{Self, VecMap}};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ELevelTooLow: u64 = 101; // join: the character's level is below the world's required_level
const ENotInWorld: u64 = 102; // search: the character's world field is not this world (join it first)
const ENoCheckpoint: u64 = 103; // search: no checkpoint for this world (defensive — a joined character always has one)
// (104 EZoneNotOccupied retired at upgrade #4 — travel-verify replaced the occupancy lock; code stays reserved)
const EZoneFresh: u64 = 105; // search: the zone is discovered and its TTL has not elapsed (re-search too early)
const EBadNode: u64 = 106; // gathering seam: resource cell index out of the derived range (or zone undiscovered)
const ENodeEmpty: u64 = 107; // gathering seam: the resource cell is already harvested (its bitmap bit is set)
const ESpawnNotFound: u64 = 108; // claim: no LIVE derived group with this spawn_id in the target zone (an unsearched/undiscovered zone has no Zone DF → also 108)
const EBadDrainInput: u64 = 109; // drain_zones: the zx / zy coordinate lists have mismatched lengths
const EBadGroupProof: u64 = 110; // claim: supplied facts/index/proof do not authenticate against the searched-zone root
const EGroupNotConsumed: u64 = 111; // release: the group is already live in the world — nothing to put back

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A discovered zone's state — a DF on the World UID under `ZoneKey`. THE COST SHAPE (search-cost rework): one
/// timestamp + one seed + two consumed-bitmaps, NOTHING per-mob/per-cell — the spawn lists derive from `seed`
/// (`zone_gen`), and bit `i` of a bitmap marks derivation-stream entry `i` consumed. Bitmaps start EMPTY (all
/// live) and grow lazily on the first consume that needs their byte. `discovered_at_ms` drives the lazy TTL AND
/// is every derived group's spawn time (§8 aging — the whole zone spawns at discovery).
public struct Zone has store {
  discovered_at_ms: u64,
  seed: u64,
  mob_bitmap: vector<u8>,
  res_bitmap: vector<u8>,
}

public struct ZoneKey has copy, drop, store { zx: u32, zy: u32 }

/// Adjacent root storage is owned here: no sibling module can construct this private-field key or write roots.
public struct ZoneGroupRootKey has copy, drop, store { zx: u32, zy: u32 }
public struct ZoneGroupCommitment has store { root: vector<u8>, count: u64 }

/// The zone's ENGAGEMENT ROUNDS (#609 — a group the mobs WON goes back into the world at its spot): `spawn_id →
/// how many times this group has been released`. Absent, or a spawn absent from the map, means 0 — never lost to.
/// A fight's derived address is claimed once and stays reserved forever, so the round is what gives the NEXT
/// fight over a released group an address to live at (`fight_registry::group_fight_address`). Zone-scoped: the
/// re-search that re-rolls the seed (new seed = new spawn ids) drops it with the bitmaps, and `drain_zones`
/// reclaims it with the rest of the zone.
public struct ZoneRoundsKey has copy, drop, store { zx: u32, zy: u32 }
public struct ZoneRounds has store { rounds: VecMap<u64, u64> }

/// The PROVENANCE HOT POTATO a successful `claim_mob_group` returns — the ONLY way to open a world fight.
/// No abilities: it cannot be stored, dropped, or copied, so the claiming PTB MUST consume it in the same tx
/// (in practice: `aresrpg::fight::create`). Carrying the verified spawn facts as an unforgeable value —
/// instead of loose scalars — is what closes the create-forgery class: `fight::create` accepts no raw provenance,
/// and this struct's only constructor sits behind the full claim gauntlet (derivation lookup, travel-verify,
/// checkpoint write, consumed-bit set). `character` binds the claim to the claimant so a ticket can't seat someone
/// else's (stronger/weaker) character; `x`/`z` double as the fight's board anchor.
public struct GroupTicket {
  world: ID,
  character: ID,
  spawn_id: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  spawned_at_ms: u64,
  group_seed: u64,
}

/// Internal value carrying client facts to the proof-aware branch. The public doors accept only plain BCS values;
/// private fields prevent callers from fabricating a value for any package-internal seam.
public struct GroupClaimProof has drop {
  index: u64,
  template: ID,
  x: u32,
  z: u32,
  group_size: u16,
  group_seed: u64,
  proof: vector<u8>,
}

/// Unpack a `GroupTicket` → `(world, character, spawn_id, template, x, z, group_size, spawned_at_ms, group_seed)`.
/// PUBLIC on purpose: a hot potato's security lives entirely in its CREATION gate — anyone holding one already
/// paid the real claim (the group's bit is set), and unpacking outside `fight::create` only forfeits that claim
/// (self-griefing, never gain). Cross-package `public(package)` does not exist, so this is the seam.
public(package) fun consume_group_ticket(t: GroupTicket): (ID, ID, u64, ID, u32, u32, u16, u64, u64) {
  let GroupTicket { world, character, spawn_id, template, x, z, group_size, spawned_at_ms, group_seed } = t;
  (world, character, spawn_id, template, x, z, group_size, spawned_at_ms, group_seed)
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct WorldJoined has copy, drop { world: ID, character: ID, x: u32, z: u32, first_join: bool }

public struct ZoneSearched has copy, drop { world: ID, zx: u32, zy: u32, at_ms: u64, mob_groups: u64, resource_nodes: u64 }

public struct MobGroupClaimed has copy, drop { world: ID, character: ID, spawn_id: u64, template: ID, x: u32, z: u32, group_size: u16 }

/// The mobs won: their group is back in the world at its spot, fightable again at engagement `round` (#609).
public struct MobGroupReleased has copy, drop { world: ID, spawn_id: u64, x: u32, z: u32, round: u64 }

/// A batch of discovered-zone dynamic fields (`ZoneKey → Zone`) was drained off a World UID ahead of a
/// `world::destroy_world` (storage reclaim). `zones_removed` counts what actually existed — the drain is idempotent.
public struct ZonesDrained has copy, drop { world: ID, zones_removed: u64 }

// ╔════════════════ [ JOIN WORLD (terminal &Random — first join rolls a spawn) ] ═ ]

/// Join `world`. FIRST join (no checkpoint here yet): gate on `required_level`, roll a random spawn inside the
/// spawn zone (§4), init the checkpoint, write the world field. REJOIN: restore — just re-point the world field;
/// the existing checkpoint (position AND clock) is untouched, so switching worlds is never a teleport-home and
/// never erases travel debt (§4/§5). A private `entry` consuming `&Random` (the terminal-call law).
entry fun join_world(
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  join_internal(world, kiosk, pkcap, character_id, config, version, clock, &mut gen);
}

fun join_internal(
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  gen: &mut RandomGenerator,
) {
  config.assert_enabled();
  version.assert_enabled();
  let now = clock.timestamp_ms();
  let wid = object::id(world);
  let owner_cap = personal_kiosk::borrow(pkcap);
  let character = kiosk.borrow_mut(owner_cap, character_id);

  let first_join = !character_link::has_checkpoint(character, wid);
  let (x, z) = if (first_join) {
    // required-level gate uses the character's own experience through the immutable curve (no DF needed)
    assert!(character_link::level(character) >= (world::required_level(world) as u64), ELevelTooLow);
    // Spawn box CENTERED on the world center (bounds/2 = the chain-frame image of the client's signed-coord
    // ORIGIN, D186). The raw [0, spawn_zone) roll put first-joins in the chain CORNER — ~bounds/2 blocks from
    // where the client renders them, so the very first search_zone died ETravelTooFar for everyone (r5 P0,
    // 2026-07-11). Saturating base keeps tiny worlds (spawn_zone ≈ bounds) legal.
    let half_x = world::spawn_zone_x(world) / 2;
    let half_z = world::spawn_zone_z(world) / 2;
    let cx = world::bounds_x(world) / 2;
    let cz = world::bounds_z(world) / 2;
    let base_x = if (cx > half_x) cx - half_x else 0;
    let base_z = if (cz > half_z) cz - half_z else 0;
    let sx = base_x + world_math::roll_u32(gen, 0, world::spawn_zone_x(world) - 1);
    let sz = base_z + world_math::roll_u32(gen, 0, world::spawn_zone_z(world) - 1);
    let pet = equipment::pet_equipped(character);
    character_link::write_checkpoint(character, wid, checkpoint::new_checkpoint(sx, sz, now, pet), version);
    (sx, sz)
  } else {
    // rejoin: keep the existing checkpoint exactly (position + clock); read it only for the event
    let cp = character_link::checkpoint(character, wid);
    (checkpoint::x(&cp), checkpoint::z(&cp))
  };
  character_link::set_world_field(character, wid, version);
  event::emit(WorldJoined { world: wid, character: character_id, x, z, first_join });
}

// ╔════════════════ [ SEARCH ZONE (terminal &Random — draw the composition seed) ] ═ ]

/// Discover (or re-search after TTL) the zone containing the caller's CLAIMED standing position `(x, z)` — §5:
/// discovery is POSITION-PROVING. Travel-verifies checkpoint → (x, z) at the world speed budget (§17.3, ×1.5
/// under the §17.2 both-ends pet rule) and WRITES the checkpoint there — the exact `claim_mob_group` legs. Draws
/// ONE u64 with fresh randomness — the zone's composition SEED; everything the zone contains derives from it
/// (search-cost rework: the searcher stores seed+bitmaps, never the spawn rows).
entry fun search_zone(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  search_internal(world, kiosk, pkcap, character_id, x, z, config, version, clock, &mut gen);
}

fun search_internal(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  gen: &mut RandomGenerator,
) {
  config.assert_enabled();
  version.assert_enabled();
  let now = clock.timestamp_ms();
  let wid = object::id(world);
  let owner_cap = personal_kiosk::borrow(pkcap);

  // ── REFUSALS FIRST (a refused search costs only gas — no state mutates until every check passes) ──
  let (cp, pet_now) = {
    let character = kiosk.borrow(owner_cap, character_id);
    assert!(character_link::in_world(character, wid), ENotInWorld);
    assert!(character_link::has_checkpoint(character, wid), ENoCheckpoint);
    (character_link::checkpoint(character, wid), equipment::pet_equipped(character))
  };
  // travel verification: you must have been able to WALK from your checkpoint to (x, z) — the §17.3 position
  // proof that REPLACES the old spawn-zone occupancy lock (teach-don't-reject: a refused caller waits and retries)
  let pet_both = checkpoint::pet_equipped(&cp) && pet_now;
  checkpoint::verify_travel(world, &cp, x, z, now, pet_both);
  // the zone your PROVEN standing position sits in (zone_of bounds-checks — an out-of-world (x,z) aborts)
  let (zx, zy) = world::zone_of(world, x, z);

  // lazy TTL: a still-fresh discovered zone cannot be re-searched (read-only borrow)
  let key = ZoneKey { zx, zy };
  let ttl = world::zone_ttl_ms(world);
  if (df::exists(world::uid(world), key)) {
    let zone: &Zone = df::borrow(world::uid(world), key);
    assert!(now >= zone.discovered_at_ms + ttl, EZoneFresh);
  };

  // ── THE roll: one u64 seed — the entire composition derives from it (composition-at-discovery) ──
  let seed = gen.generate_u64();

  // ── write: advance the checkpoint to the PROVEN standing position (§5 — discovery writes a checkpoint) ──
  {
    let character = kiosk.borrow_mut(owner_cap, character_id);
    let pet = equipment::pet_equipped(character);
    character_link::write_checkpoint(character, wid, checkpoint::new_checkpoint(x, z, now, pet), version);
  };

  // derived counts for the honest event (compute-only — nothing per-row is stored)
  let (msids, mt, mx, mz, ms, mg) = zone_comp::derive_mobs(world, zx, zy, seed, config.team_size_bound());
  let (rsids, _rt, _rx, _rz, _rj, _rr) = zone_comp::derive_res(world, zx, zy, seed);

  // ── write: create-or-RE-ROLL the zone DF (new seed, bitmaps reset — the top-up's derivation-model successor) ──
  let wuid = world::uid_mut(world);
  if (df::exists(wuid, key)) {
    let zone: &mut Zone = df::borrow_mut(wuid, key);
    zone.discovered_at_ms = now;
    zone.seed = seed;
    zone.mob_bitmap = vector[];
    zone.res_bitmap = vector[];
  } else {
    df::add(wuid, key, Zone { discovered_at_ms: now, seed, mob_bitmap: vector[], res_bitmap: vector[] });
  };
  let group_root = zone_gen::mob_group_root(wid, zx, zy, seed, now, &msids, &mt, &mx, &mz, &ms, &mg);
  let root_key = ZoneGroupRootKey { zx, zy };
  if (df::exists(wuid, root_key)) {
    let stored: &mut ZoneGroupCommitment = df::borrow_mut(wuid, root_key);
    stored.root = group_root;
    stored.count = msids.length();
  } else {
    df::add(wuid, root_key, ZoneGroupCommitment { root: group_root, count: msids.length() });
  };
  drop_zone_rounds(wuid, zx, zy); // the re-roll renames every spawn — the old rounds name nothing

  event::emit(ZoneSearched { world: wid, zx, zy, at_ms: now, mob_groups: msids.length(), resource_nodes: rsids.length() });
}

// ╔════════════════ [ CLAIM MOB GROUP (fight-entry seam — travel-verify, checkpoint, consume the bit) ] ═ ]

/// OCCUPIED-ZONE claim door — the group must sit in the zone the caller's proven checkpoint OCCUPIES. A special
/// case of `claim_mob_group_in_zone` with the zone DERIVED from the checkpoint; both funnel through
/// `claim_group_at_zone`.
public fun claim_mob_group(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  spawn_id: u64,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
): GroupTicket {
  claim_group_at_zone(world, kiosk, pkcap, character_id, option::none(), spawn_id, option::none(), config, version, clock)
}

/// GLOBAL-SEARCH door: name any searched zone, then enforce the same reachability and hot-potato gauntlet.
public fun claim_mob_group_in_zone(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zy: u32,
  spawn_id: u64,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
): GroupTicket {
  claim_group_at_zone(world, kiosk, pkcap, character_id, option::some(ZoneKey { zx, zy }), spawn_id, option::none(), config, version, clock)
}

/// Proof-taking occupied-zone door. A committed zone verifies one authenticated index; a pre-commitment zone
/// falls back to the original derivation. A present commitment never falls back after a bad proof.
public fun claim_mob_group_with_proof(
  world: &mut World, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, index: u64,
  spawn_id: u64, template: ID, x: u32, z: u32, group_size: u16, group_seed: u64, proof: vector<u8>,
  config: &GameConfig, version: &Version, clock: &Clock,
): GroupTicket {
  let p = GroupClaimProof { index, template, x, z, group_size, group_seed, proof };
  claim_group_at_zone(world, kiosk, pkcap, character_id, option::none(), spawn_id, option::some(p), config, version, clock)
}

/// Proof-taking global-search door: identical proof/claim semantics with explicit searched-zone coordinates.
public fun claim_mob_group_in_zone_with_proof(
  world: &mut World, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, zx: u32, zy: u32,
  index: u64, spawn_id: u64, template: ID, x: u32, z: u32, group_size: u16, group_seed: u64,
  proof: vector<u8>, config: &GameConfig, version: &Version, clock: &Clock,
): GroupTicket {
  let p = GroupClaimProof { index, template, x, z, group_size, group_seed, proof };
  claim_group_at_zone(world, kiosk, pkcap, character_id, option::some(ZoneKey { zx, zy }), spawn_id, option::some(p), config, version, clock)
}

/// One shared security tail: authenticate facts (derive or proof), travel-check, consume bit, checkpoint, ticket.
fun claim_group_at_zone(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  zone: Option<ZoneKey>,
  spawn_id: u64,
  claim_proof: Option<GroupClaimProof>,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
): GroupTicket {
  config.assert_enabled();
  version.assert_enabled();
  let now = clock.timestamp_ms();
  let wid = object::id(world);
  let owner_cap = personal_kiosk::borrow(pkcap);

  // ── refusals first (a refused claim costs only gas) — read the proven position + pet (immutable borrow) ──
  let (cp, pet_now) = {
    let character = kiosk.borrow(owner_cap, character_id);
    assert!(character_link::in_world(character, wid), ENotInWorld);
    assert!(character_link::has_checkpoint(character, wid), ENoCheckpoint);
    (character_link::checkpoint(character, wid), equipment::pet_equipped(character))
  };
  // the zone to claim in: the caller-named globally-searched zone, or (special case) the zone the checkpoint OCCUPIES
  let (zx, zy) = if (zone.is_some()) {
    let ZoneKey { zx, zy } = zone.destroy_some();
    (zx, zy)
  } else {
    zone.destroy_none();
    world::zone_of(world, checkpoint::x(&cp), checkpoint::z(&cp))
  };

  // Authenticate the LIVE group by original derivation or by the adjacent search-time commitment.
  let (template_id, mx, mz, group_size, spawned_at_ms, group_seed, index) =
    resolve_mob_group(world, zx, zy, spawn_id, claim_proof, config.team_size_bound());

  // travel verification: you must have been able to WALK from your checkpoint to the group (teach-don't-reject)
  let pet_both = checkpoint::pet_equipped(&cp) && pet_now;
  checkpoint::verify_travel(world, &cp, mx, mz, now, pet_both);

  // ── WRITES: consume the group (set its bit) + advance the entry checkpoint to the group's position ──
  mark_mob_consumed(world, zx, zy, index);
  {
    let character = kiosk.borrow_mut(owner_cap, character_id);
    let pet = equipment::pet_equipped(character);
    character_link::write_checkpoint(character, wid, checkpoint::new_checkpoint(mx, mz, now, pet), version);
  };

  event::emit(MobGroupClaimed { world: wid, character: character_id, spawn_id, template: template_id, x: mx, z: mz, group_size });
  GroupTicket { world: wid, character: character_id, spawn_id, template: template_id, x: mx, z: mz, group_size, spawned_at_ms, group_seed }
}

fun resolve_mob_group(
  world: &World, zx: u32, zy: u32, spawn_id: u64, claim_proof: Option<GroupClaimProof>, team_bound: u64,
): (ID, u32, u32, u16, u64, u64, u64) {
  if (claim_proof.is_none()) {
    claim_proof.destroy_none();
    return find_mob_group(world, zx, zy, spawn_id, team_bound)
  };
  let GroupClaimProof { index, template, x, z, group_size, group_seed, proof } = claim_proof.destroy_some();
  let uid = world::uid(world);
  let root_key = ZoneGroupRootKey { zx, zy };
  if (!df::exists(uid, root_key)) {
    return find_mob_group(world, zx, zy, spawn_id, team_bound)
  };
  let key = ZoneKey { zx, zy };
  assert!(df::exists(uid, key), ESpawnNotFound);
  let zone: &Zone = df::borrow(uid, key);
  let stored: &ZoneGroupCommitment = df::borrow(uid, root_key);
  assert!(zone_gen::mob_group_root_matches(
    &stored.root, stored.count, object::id(world), zx, zy, zone.seed, zone.discovered_at_ms, index, spawn_id, template,
    x, z, group_size, group_seed, &proof,
  ), EBadGroupProof);
  assert!(!bit_get(&zone.mob_bitmap, index), ESpawnNotFound);
  (template, x, z, group_size, zone.discovered_at_ms, group_seed, index)
}

/// Locate a LIVE derived mob group by `spawn_id` in zone `(zx,zy)`; returns `(template_id, x, z, group_size,
/// spawned_at_ms, group_seed, derivation index)`. Aborts `ESpawnNotFound` if the zone is undiscovered, no derived
/// group carries that id, or its consumed bit is already set.
fun find_mob_group(world: &World, zx: u32, zy: u32, spawn_id: u64, team_bound: u64): (ID, u32, u32, u16, u64, u64, u64) {
  let key = ZoneKey { zx, zy };
  assert!(df::exists(world::uid(world), key), ESpawnNotFound);
  let zone: &Zone = df::borrow(world::uid(world), key);
  let (sids, tpls, xs, zs, sizes, gseeds) = derive_mobs(world, zx, zy, zone.seed, team_bound);
  let n = sids.length();
  let mut i = 0;
  while (i < n) {
    if (sids[i] == spawn_id) {
      assert!(!bit_get(&zone.mob_bitmap, i), ESpawnNotFound); // consumed = gone (no double-fight of one group)
      return (tpls[i], xs[i], zs[i], sizes[i], zone.discovered_at_ms, gseeds[i], i)
    };
    i = i + 1;
  };
  abort ESpawnNotFound
}

/// Set the consumed bit of derived mob group `index` in zone `(zx,zy)` — the write that replaced the row removal.
fun mark_mob_consumed(world: &mut World, zx: u32, zy: u32, index: u64) {
  let zone: &mut Zone = df::borrow_mut(world::uid_mut(world), ZoneKey { zx, zy });
  bit_set(&mut zone.mob_bitmap, index);
}

// ╔════════════════ [ RELEASE THE GROUP (#609 — only a player VICTORY consumes it) ] ═ ]

/// Put a consumed group BACK in the world at its spot: clear its consumed bit and bump its engagement round.
/// §7 says a defeat costs only time — the mobs winning is not a reason for them to vanish, and without this the
/// world's mob population drains as a pure function of player deaths. Package-internal on purpose: the ONLY
/// caller is `aresrpg::fight::release_group`, which authenticates the defeat against the fight's derived address
/// before asking for this write (this module owns the bitmap; that one owns the fight's semantics). The new round
/// — the address namespace the next fight over the group will claim — rides the event.
public(package) fun release_mob_group(world: &mut World, zx: u32, zy: u32, index: u64, spawn_id: u64, x: u32, z: u32) {
  assert!(!mob_group_live(world, zx, zy, index), EGroupNotConsumed);
  let wid = object::id(world);
  let wuid = world::uid_mut(world);
  {
    let zone: &mut Zone = df::borrow_mut(wuid, ZoneKey { zx, zy });
    bit_clear(&mut zone.mob_bitmap, index);
  };
  let round = bump_group_round(wuid, zx, zy, spawn_id);
  event::emit(MobGroupReleased { world: wid, spawn_id, x, z, round });
}

/// The group's ENGAGEMENT ROUND — 0 until the group has been released, +1 per release. `fight::create` reads it
/// to namespace the fight's derived address; the release door reads it to authenticate an outcome against that
/// same address. An undiscovered zone (no rounds DF) is 0, like every never-lost-to group.
public fun group_round(world: &World, zx: u32, zy: u32, spawn_id: u64): u64 {
  let key = ZoneRoundsKey { zx, zy };
  if (!df::exists(world::uid(world), key)) return 0;
  let stored: &ZoneRounds = df::borrow(world::uid(world), key);
  if (stored.rounds.contains(&spawn_id)) *stored.rounds.get(&spawn_id) else 0
}

/// +1 to the group's round, creating the zone's rounds map on first use. Returns the new value.
fun bump_group_round(wuid: &mut UID, zx: u32, zy: u32, spawn_id: u64): u64 {
  let key = ZoneRoundsKey { zx, zy };
  if (!df::exists(wuid, key)) df::add(wuid, key, ZoneRounds { rounds: vec_map::empty() });
  let stored: &mut ZoneRounds = df::borrow_mut(wuid, key);
  if (!stored.rounds.contains(&spawn_id)) {
    stored.rounds.insert(spawn_id, 1);
    return 1
  };
  let r = stored.rounds.get_mut(&spawn_id);
  *r = *r + 1;
  *r
}

/// Drop a zone's rounds map (the re-search re-roll and the pre-destruction drain — both already discard the
/// bitmaps, and a new seed means new spawn ids, so the old rounds name nothing).
fun drop_zone_rounds(wuid: &mut UID, zx: u32, zy: u32) {
  let key = ZoneRoundsKey { zx, zy };
  if (df::exists(wuid, key)) {
    let ZoneRounds { rounds: _ } = df::remove(wuid, key);
  };
}

// ╔════════════════ [ Gathering seam (package-internal derived-cell read + consume) ] ══ ]

/// Read a LIVE derived resource cell's (x, z, job, tier, template_id) by its derivation index. Aborts `EBadNode`
/// (undiscovered zone / index past the derived range) or `ENodeEmpty` (already harvested — bit set). Immutable.
public(package) fun read_resource_node(world: &World, zx: u32, zy: u32, node_index: u64): (u32, u32, u8, u8, ID) {
  let key = ZoneKey { zx, zy };
  assert!(df::exists(world::uid(world), key), EBadNode);
  let zone: &Zone = df::borrow(world::uid(world), key);
  let (_sids, tpls, xs, zs, jobs, tiers) = derive_res(world, zx, zy, zone.seed);
  assert!(node_index < xs.length(), EBadNode);
  assert!(!bit_get(&zone.res_bitmap, node_index), ENodeEmpty);
  (xs[node_index], zs[node_index], jobs[node_index], tiers[node_index], tpls[node_index])
}

/// Consume a resource cell: set its bit (one-harvest/one-bit design; the multi-charge `remaining`
/// concept collapsed into the bitmap). Aborts `EBadNode` on an undiscovered zone, `ENodeEmpty` on a double
/// harvest. The single live caller (`gathering::gather`) bounds `node_index` via `read_resource_node` in the SAME
/// tx, so this door does not re-derive the cell list (a phantom over-range bit is unreachable through the seam
/// and harmless anyway — a re-search resets bitmaps).
public(package) fun consume_resource_node(world: &mut World, zx: u32, zy: u32, node_index: u64) {
  let key = ZoneKey { zx, zy };
  let wuid = world::uid_mut(world);
  assert!(df::exists(wuid, key), EBadNode);
  let zone: &mut Zone = df::borrow_mut(wuid, key);
  assert!(!bit_get(&zone.res_bitmap, node_index), ENodeEmpty);
  bit_set(&mut zone.res_bitmap, node_index);
}

// ╔════════════════ [ Burn / teardown — the module owning ZoneKey/Zone drains them (cap + version gated) ] ═ ]

/// Drain Zone and adjacent root DFs before World destruction; idempotent, batched, cap/version gated.
public fun drain_zones(cap: &AdminCap, world: &mut World, zxs: vector<u32>, zys: vector<u32>, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(zxs.length() == zys.length(), EBadDrainInput);
  let wid = object::id(world);
  let wuid = world::uid_mut(world);
  let mut removed = 0;
  let mut i = 0;
  while (i < zxs.length()) {
    let key = ZoneKey { zx: zxs[i], zy: zys[i] };
    if (df::exists(wuid, key)) {
      let Zone { discovered_at_ms: _, seed: _, mob_bitmap: _, res_bitmap: _ } = df::remove(wuid, key);
      removed = removed + 1;
    };
    let root_key = ZoneGroupRootKey { zx: zxs[i], zy: zys[i] };
    if (df::exists(wuid, root_key)) {
      let ZoneGroupCommitment { root: _, count: _ } = df::remove(wuid, root_key);
    };
    drop_zone_rounds(wuid, zxs[i], zys[i]);
    i = i + 1;
  };
  event::emit(ZonesDrained { world: wid, zones_removed: removed });
}

// ╔════════════════ [ Getters (RPC + tests read zone state — all DERIVE from the seed) ] ═ ]
// Per-index getters take the DERIVATION index (stream order — stable across consumption, unlike the retired
// swap-remove positional index). `*_count` getters return the LIVE (unconsumed) population; `*_total` the full
// derived population (the index bound). Deriving per call is compute-only — nothing is stored beyond
// seed+bitmaps, which IS the cost invariant. Derivations that never read a group SIZE pass team_bound = 1: the
// size clamp draws nothing, so ids/positions/templates are identical for ANY bound (kernel stream law).

public fun zone_exists(world: &World, zx: u32, zy: u32): bool {
  df::exists(world::uid(world), ZoneKey { zx, zy })
}

public fun zone_discovered_at(world: &World, zx: u32, zy: u32): u64 { borrow_zone(world, zx, zy).discovered_at_ms }
public fun zone_seed(world: &World, zx: u32, zy: u32): u64 { borrow_zone(world, zx, zy).seed }

/// The COST-SHAPE probes: stored bitmap byte lengths (0 right after a search — bits grow lazily on consume).
/// Together with the `Zone` struct shape these PROVE a search stores nothing per-mob/per-cell.
public fun mob_bitmap_bytes(world: &World, zx: u32, zy: u32): u64 { borrow_zone(world, zx, zy).mob_bitmap.length() }
public fun res_bitmap_bytes(world: &World, zx: u32, zy: u32): u64 { borrow_zone(world, zx, zy).res_bitmap.length() }

/// Is derived mob group `i` still LIVE (its consumed bit clear)? The bit-side probe `zones_view` filters with.
public fun mob_group_live(world: &World, zx: u32, zy: u32, i: u64): bool {
  !bit_get(&borrow_zone(world, zx, zy).mob_bitmap, i)
}

/// One-harvest/one-bit law: 1 while resource cell `i` is live, 0 once harvested (the legacy charge counter's shape).
public fun resource_remaining(world: &World, zx: u32, zy: u32, i: u64): u16 {
  if (bit_get(&borrow_zone(world, zx, zy).res_bitmap, i)) 0 else 1
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

/// Derive this zone's mob groups the way the zone's OWN stored commitment says it was derived. A zone carrying
/// a format-2 commitment was placed on the lattice; anything else (including a zone with no commitment at all)
/// is legacy. The dispatch lives HERE because only this module can see the stored bytes — `zone_comp` is pure
/// over a World, and the foundation kernel is pure over scalars. Every in-package reader of a zone's groups goes
/// through this door, so a zone can never be read with a derivation other than the one it was written with.
public(package) fun derive_mobs(world: &World, zx: u32, zy: u32, seed: u64, team_bound: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u16>, vector<u64>) {
  if (group_commitment_format(world, zx, zy) == 2) { // 2 = zone_gen lattice commitment
    zone_comp::derive_mobs_grid(world, zx, zy, seed, team_bound)
  } else {
    zone_comp::derive_mobs(world, zx, zy, seed, team_bound)
  }
}

/// The resource twin of `derive_mobs` — the SAME commitment byte selects both streams, so a zone's mobs and its
/// resource cells are always derived by one algorithm.
public(package) fun derive_res(world: &World, zx: u32, zy: u32, seed: u64): (vector<u64>, vector<ID>, vector<u32>, vector<u32>, vector<u8>, vector<u8>) {
  if (group_commitment_format(world, zx, zy) == 2) { // 2 = zone_gen lattice commitment
    zone_comp::derive_res_grid(world, zx, zy, seed)
  } else {
    zone_comp::derive_res(world, zx, zy, seed)
  }
}

/// The zone's derivation format, read off its stored commitment. A MISSING commitment reports `1` (legacy) —
/// the zone predates commitments entirely, so its groups were placed by the spaced sampler.
fun group_commitment_format(world: &World, zx: u32, zy: u32): u8 {
  let key = ZoneGroupRootKey { zx, zy };
  if (!df::exists(world::uid(world), key)) return 1; // no commitment = a pre-commitment zone = legacy
  let stored: &ZoneGroupCommitment = df::borrow(world::uid(world), key);
  zone_gen::mob_group_commitment_format(&stored.root)
}

fun borrow_zone(world: &World, zx: u32, zy: u32): &Zone {
  df::borrow(world::uid(world), ZoneKey { zx, zy })
}

/// Read bit `i` of a lazily-grown bitmap — a byte past the stored length reads 0 (live). The JS mirror
/// (`zone_derive.js::bit_get`) uses the identical layout: byte `i / 8`, bit `i % 8`.
fun bit_get(bm: &vector<u8>, i: u64): bool {
  let byte = i / 8;
  if (byte >= bm.length()) return false;
  (bm[byte] >> ((i % 8) as u8)) & 1 == 1
}

/// Set bit `i`, growing the bitmap with zero bytes up to the needed byte (lazy — a fresh zone stores NO bytes).
fun bit_set(bm: &mut vector<u8>, i: u64) {
  let byte = i / 8;
  while (bm.length() <= byte) { bm.push_back(0); };
  let b = &mut bm[byte];
  *b = *b | (1 << ((i % 8) as u8));
}

/// Clear bit `i`, then pop trailing zero bytes — the exact inverse of `bit_set`, so a released group leaves the
/// bitmap byte-identical to what it was before its claim (the cost shape stays lazy, and the JS mirror's
/// `bit_get` reads a shorter vector as all-live).
fun bit_clear(bm: &mut vector<u8>, i: u64) {
  let byte = i / 8;
  if (byte >= bm.length()) return;
  let b = &mut bm[byte];
  *b = *b & (255u8 ^ (1u8 << ((i % 8) as u8)));
  while (!bm.is_empty() && bm[bm.length() - 1] == 0) { bm.pop_back(); };
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Overwrite the zone's stored commitment with a FORMAT-2 (lattice) one — the shape every zone searched by the
/// deployed package carries. Lets a test drive the derivation dispatch without replaying a chain search.
public fun set_lattice_commitment_for_testing(world: &mut World, zx: u32, zy: u32, team_bound: u64) {
  let seed = zone_seed(world, zx, zy);
  let now = zone_discovered_at(world, zx, zy);
  let wid = object::id(world);
  let (sids, tpls, xs, zs, sizes, gseeds) = zone_comp::derive_mobs_grid(world, zx, zy, seed, team_bound);
  let root = zone_gen::mob_group_commitment(wid, zx, zy, seed, now, &sids, &tpls, &xs, &zs, &sizes, &gseeds);
  let count = sids.length();
  let wuid = world::uid_mut(world);
  let stored: &mut ZoneGroupCommitment = df::borrow_mut(wuid, ZoneGroupRootKey { zx, zy });
  stored.root = root;
  stored.count = count;
}

#[test_only]
/// The zone's stored mob-bitmap BYTES — what the client's `zone_derive.js` mirror reads verbatim. Tests pin the
/// exact bytes so the sim's parity fixture (`packages/sim/test/fixtures/zone_group_release.json`) has provenance.
public fun mob_bitmap_for_testing(world: &World, zx: u32, zy: u32): vector<u8> { borrow_zone(world, zx, zy).mob_bitmap }

#[test_only]
public fun reopen_mob_group_for_testing(world: &mut World, zx: u32, zy: u32, index: u64) {
  let zone: &mut Zone = df::borrow_mut(world::uid_mut(world), ZoneKey { zx, zy });
  bit_clear(&mut zone.mob_bitmap, index);
}

#[test_only]
public fun remove_group_commitment_for_testing(world: &mut World, zx: u32, zy: u32) {
  let uid = world::uid_mut(world);
  let key = ZoneGroupRootKey { zx, zy };
  if (df::exists(uid, key)) {
    let ZoneGroupCommitment { root: _, count: _ } = df::remove(uid, key);
  };
}

#[test_only]
public fun group_commitment_exists_for_testing(world: &World, zx: u32, zy: u32): bool {
  df::exists(world::uid(world), ZoneGroupRootKey { zx, zy })
}

#[test_only]
public fun join_for_testing(
  world: &World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
) {
  let mut gen = random::new_generator_for_testing();
  join_internal(world, kiosk, pkcap, character_id, config, version, clock, &mut gen);
}

#[test_only]
public fun search_for_testing(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  x: u32,
  z: u32,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
) {
  let mut gen = random::new_generator_for_testing();
  search_internal(world, kiosk, pkcap, character_id, x, z, config, version, clock, &mut gen);
}
