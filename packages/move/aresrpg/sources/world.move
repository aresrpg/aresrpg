// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// WORLD — the §4 world TEMPLATE: a shared, admin-minted object defining one playable world's identity and its
/// spawn philosophy. A world carries a `seed` (procedural voxel terrain — the client derives Y; the chain stores
/// only (x,z), §4), a `biome` (visual/audio identity), a `required_level` to enter, finite `bounds` (energy
/// barriers; default 500k×500k — sparse zones, §17.10), the discovery `zone_size` in blocks (default 512, §17.18),
/// a `zone_ttl_ms` (default 2h lazy refresh, §17.1), a `speed_budget` (blocks/sec ×100 fixed-point, tuned
/// slightly BELOW the flat-line max — a per-world value, §17.3), a `spawn_zone` (first-join roll box, default
/// 1000×1000, §4), density dials (groups/nodes per discovered zone, §17.18), a `protector_bp` gather-ambush rate
/// (§6/§17.22), the two spawn TABLES (stackable RESOURCES + MOB GROUPS — rows hold TEMPLATE IDs, never typed refs,
/// the cross-package seam law), the `dungeon_key_template`, and the room-by-room dungeon roster (§9).
///
/// PLACEMENT-BY-RESPONSIBILITY: this module owns the template DATA + its own field validity (clamp bands). It is a
/// dependency LEAF — it imports no sibling game module and no `GameConfig`: the LIVE engine bound on mob group
/// size (§17.8 team_size_bound = 6) is one home on `GameConfig` and is applied at SPAWN time by `zones` (which
/// holds `&GameConfig` there); a world only stores per-world authored sizes (sane-clamped). Setters are AdminCap-
/// + Version-gated and CLAMP (coercion, not rejection — a compromised cap can rebalance a world but never store an
/// out-of-band value); an out-of-range table index ABORTS (no meaningful clamp). Zone coordinate math is
/// OVERFLOW-PROOF by construction: a zone index is `pos / zone_size` (u32/u32, no overflow), bounds-checked first.
module aresrpg::world;

use aresrpg::{admin::AdminCap, version::Version};
use std::string::String;
use sui::{dynamic_field as df, event};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EOutOfBounds: u64 = 101; // a coordinate fell outside the world's barrier bounds (zone math would be meaningless)
const EBadEntryIndex: u64 = 102; // a table setter/getter was given a row index past the vector end (non-clampable)
const EBadRange: u64 = 103; // a min/max pair setter got max < min after clamping (a range must be well-formed)
const EWorldNotEmpty: u64 = 104; // destroy_world: the inline spawn tables still hold rows — clear_tables first

// ╔════════════════ [ Clamp bands — walls a compromised AdminCap can never breach ] ═ ]
const LEVEL_MIN: u64 = 1;
const LEVEL_MAX: u64 = 200; // the character curve ceiling (§17.20)
const BOUND_MIN: u32 = 512; // a world at least one zone across
const BOUND_MAX: u32 = 2_000_000; // 4× the default; the travel-math overflow guard is proven safe to this ceiling
const ZONE_SIZE_MIN: u32 = 32; // one engine chunk (§17.18 chunk = 32 blocks)
const ZONE_SIZE_MAX: u32 = 65_536;
const TTL_MIN: u64 = 60_000; // 1 min — a shorter refresh is a doorbell, not an expedition
const TTL_MAX: u64 = 2_592_000_000; // 30 days
const SPEED_MIN: u64 = 1; // blocks/sec ×100 → 0.01 blocks/s floor (never zero: wait_seconds divides by it)
const SPEED_MAX: u64 = 100_000; // 1000 blocks/s ×100 — a generous ceiling; the travel overflow guard is safe to it
const BP_MAX: u64 = 10_000; // 100.00% in basis points (protector rate ceiling)
const DENSITY_MAX: u16 = 64; // a hard rail on groups/nodes per zone (defaults are 8/16 — §17.18 — well within)
const GROUP_MIN: u16 = 1; // §5 groups are 1–6 individuals; the LIVE 6 bound is GameConfig's, applied at spawn
const GROUP_MAX: u16 = 64; // storage sanity rail only; `zones` re-clamps the rolled size to config.team_size_bound

// ╔════════════════ [ Defaults — the ratified world-template values (§4/§17.1/.18) ] ═══════ ]
const DEFAULT_BOUND: u32 = 500_000; // §17.10
const DEFAULT_ZONE_SIZE: u32 = 512; // §17.18 (16×16 chunks)
const DEFAULT_TTL: u64 = 7_200_000; // 2h (§17.1)
const DEFAULT_SPEED: u64 = 1150; // controller RUN_SPEED 10.5 b/s ×100 +10% terrain slack — D758/resolved 2026-07-18
const DEFAULT_SPAWN_ZONE: u32 = 1000; // §4 (1000×1000 first-join roll box)
const DEFAULT_PROTECTOR_BP: u64 = 200; // 2.00% (§6/§17.22)
const DEFAULT_MIN_GROUPS: u16 = 3; // §17.18 (3–8 mob groups)
const DEFAULT_MAX_GROUPS: u16 = 8;
const DEFAULT_MIN_NODES: u16 = 8; // §17.18 (8–16 resource nodes)
const DEFAULT_MAX_NODES: u16 = 16;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// One stackable-RESOURCE spawn row. `template_id` is the item template's ID (never a typed ref — seam law);
/// `rate_bp` weights the roll; `min_qty`/`max_qty` bound a node's HARVEST count (gathers before depletion);
/// `job` (0 FARMER / 1 HERBALIST / 2 MINER) + `tier` (T1–T11) ride HERE because the item base carries neither
/// (verified `item.move`: template = name/item_type/category/level only) and gathering needs both — the job for
/// the tool + XP, the tier for the yield formula (§18 annex §5) and the unlock gate. DECLARED deviation from the
/// brief's uniform {template,rate,min,max} shape: resources need gathering metadata; mobs do not.
public struct ResourceEntry has store, copy, drop {
  template_id: ID,
  rate_bp: u16,
  min_qty: u16,
  max_qty: u16,
  job: u8,
  tier: u8,
}

/// One MOB-GROUP spawn row. Same rate/size skeleton; `min_group`/`max_group` bound the individuals per group
/// (§5, 1–6). No job/tier — mobs are not gathered.
public struct MobEntry has store, copy, drop {
  template_id: ID,
  rate_bp: u16,
  min_group: u16,
  max_group: u16,
}

/// One dungeon room: the mob TEMPLATE IDs composing it (the last room is traditionally the strongest — §8/§9,
/// no boss mechanic). IDs, never typed refs.
public struct DungeonRoom has store, copy, drop { mobs: vector<ID> }

/// GOLDEN-GATHER (§6 jackpot) DF KEY on the World UID: a base resource TEMPLATE id → its unique RARE variant's
/// template id (`wheat → golden_wheat`). A dynamic field (NOT a `World`/`ResourceEntry` field) so both frozen
/// struct layouts stay untouched — adding golden-gather is upgrade-legal (new DF key + new fns only). The gather
/// roll READS it (`rare_link`); the AdminCap doors below WRITE it.
public struct RareLinkKey has copy, drop, store { template: ID }

/// DISTANCE-DIFFICULTY (§4 wave-2b) DF KEY on the World UID: a mob TEMPLATE id → its ELIGIBILITY LEVEL (the
/// template's `max_level` ceiling — the toughest member it can roll). A dynamic field (NOT a `MobEntry`/`World`
/// field) so both frozen struct layouts stay untouched under the COMPATIBLE upgrade — adding distance-difficulty
/// is a new DF key + new fns only, exactly the golden-gather `RareLinkKey` precedent above. `zones::search_zone`
/// READS it to gate which roster mobs may spawn at a zone's distance; the AdminCap door below WRITES it at
/// authoring (the level already lives in the seed's mobs.json → ONE seed home, projected here so the spawn roll
/// stays level-aware WITHOUT loading every MobTemplate object).
public struct MobLevelKey has copy, drop, store { template: ID }

/// GATHER-AMBUSH PIN (P1-1) DF KEY on the World UID: a resource TEMPLATE id → the MobTemplate id an ambush MUST
/// seat (closing the client-chosen-defender hole — `gathering` asserts the passed defender against this). A
/// dynamic field (NOT a `ResourceEntry` field) because the LIVE struct layout is FROZEN under the COMPATIBLE
/// upgrade policy — a field add (like a param add on `add_resource_entry`) is a hard publish-time reject; this is
/// exactly the `MobLevelKey` precedent above. `none`/absent = this resource never ambushes. The AdminCap door
/// below WRITES it; `resource_protector` READS it.
public struct ProtectorKey has copy, drop, store { template: ID }

/// THE BOSS FENCE (#1110 design amendment 2) DF KEY on the World UID: the world-scoped list of mob-table row
/// INDEXES that are BOSS rows. Mixed-species packs draw their non-primary members from the eligible roster, and
/// 9 boss rows sit in the live pick tables — without a boss predicate the draw could mint multi-boss packs or a
/// boss riding a chicklet group. `MobTemplate` carries no family/boss field and a COMPATIBLE upgrade cannot add
/// one to a frozen struct, so the predicate lives here as a dynamic field — the same extension-gate pattern
/// `MobLevelKey` and `ProtectorKey` already set.
///
/// SHAPE: `vector<u16>` of row indexes, NOT a positional bitmask. Most worlds carry 0-1 boss rows (9 across all
/// 20 worlds; 11 worlds are dungeon-only-boss and mask to EMPTY), so the vector is usually empty or tiny,
/// `contains` is the whole read, and ABSENT ≡ EMPTY gives one uniform degradation path with no bit math.
/// Written in the SAME PTB family that writes/reorders the mob table (`set_boss_mask` + the table doors), so the
/// mask and the table can never drift across a reseed — the alternative, a loose off-chain artifact, rots on the
/// first row reorder.
public struct BossMaskKey has copy, drop, store {}

/// THE world template. Shared once at `create_world`; every field is admin-tunable within its clamp band. Spawn
/// tables + roster grow via the append setters. `spawn_nonce` mints unique per-world spawn ids for `zones`.
public struct World has key {
  id: UID,
  seed: u64,
  biome: String,
  required_level: u16,
  bounds_x: u32,
  bounds_z: u32,
  zone_size: u32,
  zone_ttl_ms: u64,
  speed_budget: u64, // blocks/sec ×100 fixed-point (§17.3)
  spawn_zone_x: u32,
  spawn_zone_z: u32,
  protector_bp: u64, // gather-ambush rate, basis points (§17.22)
  min_groups: u16,
  max_groups: u16,
  min_nodes: u16,
  max_nodes: u16,
  dungeon_key_template: Option<ID>,
  resources: vector<ResourceEntry>,
  mobs: vector<MobEntry>,
  dungeon_rooms: vector<DungeonRoom>,
  spawn_nonce: u64,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct WorldCreated has copy, drop { world: ID, seed: u64, biome: String }

public struct WorldUpdated has copy, drop { world: ID } // any dial/table edit — the RPC re-reads the object

/// A base→rare golden-gather link was set/overwritten (§6). The indexer projects the link table from these.
public struct RareLinkSet has copy, drop { world: ID, template: ID, rare_template: ID }

/// A base resource's golden-gather link was removed (§6) — no more jackpot for it.
public struct RareLinkCleared has copy, drop { world: ID, template: ID }

/// A batch of this module's own dynamic-field children (RareLinkKey → ID, MobLevelKey → u16, ProtectorKey → ID)
/// was drained ahead of a `destroy_world` (storage reclaim). Counts what actually existed — the drain is idempotent.
public struct WorldLinksDrained has copy, drop { world: ID, rare_removed: u64, levels_removed: u64, protectors_removed: u64 }

/// The world shell was destroyed on-chain (world templates are always deletable, by design).
public struct WorldBurned has copy, drop { world: ID, seed: u64, biome: String }

// ╔════════════════ [ Create (admin-minted, version-gated) ] ══════════════════ ]

/// Mint + SHARE a new world with all spec defaults and EMPTY spawn tables/roster. Admin then tunes dials and
/// appends spawn rows via the setters below (all while the package is dark — authoring gates on `assert_latest`).
public fun create_world(cap: &AdminCap, version: &Version, seed: u64, biome: String, ctx: &mut TxContext): ID {
  cap.verify(ctx);
  version.assert_latest();
  let world = World {
    id: object::new(ctx),
    seed,
    biome,
    required_level: 1,
    bounds_x: DEFAULT_BOUND,
    bounds_z: DEFAULT_BOUND,
    zone_size: DEFAULT_ZONE_SIZE,
    zone_ttl_ms: DEFAULT_TTL,
    speed_budget: DEFAULT_SPEED,
    spawn_zone_x: DEFAULT_SPAWN_ZONE,
    spawn_zone_z: DEFAULT_SPAWN_ZONE,
    protector_bp: DEFAULT_PROTECTOR_BP,
    min_groups: DEFAULT_MIN_GROUPS,
    max_groups: DEFAULT_MAX_GROUPS,
    min_nodes: DEFAULT_MIN_NODES,
    max_nodes: DEFAULT_MAX_NODES,
    dungeon_key_template: option::none(),
    resources: vector[],
    mobs: vector[],
    dungeon_rooms: vector[],
    spawn_nonce: 0,
  };
  let wid = object::id(&world);
  event::emit(WorldCreated { world: wid, seed, biome: world.biome });
  transfer::share_object(world);
  wid
}

// ╔════════════════ [ Scalar-dial setters (cap + version gated, clamped) ] ════ ]

public fun set_required_level(cap: &AdminCap, w: &mut World, value: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.required_level = clamp_u16(value, LEVEL_MIN as u16, LEVEL_MAX as u16);
  touched(w);
}

public fun set_bounds(cap: &AdminCap, w: &mut World, x: u32, z: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.bounds_x = clamp_u32(x, BOUND_MIN, BOUND_MAX);
  w.bounds_z = clamp_u32(z, BOUND_MIN, BOUND_MAX);
  touched(w);
}

public fun set_zone_size(cap: &AdminCap, w: &mut World, value: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.zone_size = clamp_u32(value, ZONE_SIZE_MIN, ZONE_SIZE_MAX);
  touched(w);
}

public fun set_zone_ttl_ms(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.zone_ttl_ms = clamp_u64(value, TTL_MIN, TTL_MAX);
  touched(w);
}

public fun set_speed_budget(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.speed_budget = clamp_u64(value, SPEED_MIN, SPEED_MAX);
  touched(w);
}

public fun set_spawn_zone(cap: &AdminCap, w: &mut World, x: u32, z: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  // the spawn box can never exceed the world bounds (a roll inside it must land in-bounds)
  w.spawn_zone_x = clamp_u32(x, 1, w.bounds_x);
  w.spawn_zone_z = clamp_u32(z, 1, w.bounds_z);
  touched(w);
}

public fun set_protector_bp(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.protector_bp = clamp_u64(value, 0, BP_MAX);
  touched(w);
}

/// Density: how many mob GROUPS and resource NODES a discovered zone tops up toward (§17.18). Each is a [min,max]
/// band; a search rolls a target within it. Clamped to the hard rail, then `max ≥ min` enforced (`EBadRange`).
public fun set_density(cap: &AdminCap, w: &mut World, min_groups: u16, max_groups: u16, min_nodes: u16, max_nodes: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.min_groups = clamp_u16(min_groups, 0, DENSITY_MAX);
  w.max_groups = clamp_u16(max_groups, 0, DENSITY_MAX);
  w.min_nodes = clamp_u16(min_nodes, 0, DENSITY_MAX);
  w.max_nodes = clamp_u16(max_nodes, 0, DENSITY_MAX);
  assert!(w.max_groups >= w.min_groups && w.max_nodes >= w.min_nodes, EBadRange);
  touched(w);
}

public fun set_dungeon_key(cap: &AdminCap, w: &mut World, template_id: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.dungeon_key_template = option::some(template_id);
  touched(w);
}

// ╔════════════════ [ Golden-gather rare links (cap + version gated; DF on the World UID) ] ═ ]

/// LINK a base resource `template` to its unique RARE variant `rare_template` — the §6 golden-gather jackpot the
/// gather roll mints on a `RARE_BP` hit. UPSERT: re-linking overwrites. Cap + version gated like every authoring
/// door. Storing an id (not a typed ref) mirrors the spawn-table seam law.
public fun set_rare_link(cap: &AdminCap, w: &mut World, template: ID, rare_template: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let key = RareLinkKey { template };
  if (df::exists(&w.id, key)) { *df::borrow_mut<RareLinkKey, ID>(&mut w.id, key) = rare_template; }
  else { df::add(&mut w.id, key, rare_template); };
  event::emit(RareLinkSet { world: object::id(w), template, rare_template });
  touched(w);
}

/// UNLINK a base resource's rare variant (no more jackpot for it). Aborts if no link exists (`df::remove`).
public fun clear_rare_link(cap: &AdminCap, w: &mut World, template: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let _: ID = df::remove(&mut w.id, RareLinkKey { template });
  event::emit(RareLinkCleared { world: object::id(w), template });
  touched(w);
}

/// SET (upsert) the DISTANCE-DIFFICULTY eligibility LEVEL for mob `template` — its `max_level` ceiling, authored
/// once per roster mob (§4 wave-2b) so `zones` gates spawns by zone distance WITHOUT loading every MobTemplate.
/// UNSET templates default to level 0 (always eligible → a world with NO levels authored keeps the pre-wave-2b
/// "every mob everywhere" behaviour, feature-dormant). Cap + version gated like every authoring door; a scalar
/// keyed by template id mirrors the spawn-table seam law (the level's ONE home is the seed JSON — projected here).
public fun set_mob_level(cap: &AdminCap, w: &mut World, template: ID, level: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let key = MobLevelKey { template };
  if (df::exists(&w.id, key)) { *df::borrow_mut<MobLevelKey, u16>(&mut w.id, key) = level; }
  else { df::add(&mut w.id, key, level); };
  touched(w);
}

/// SET the world's BOSS MASK — the mob-table row indexes that are boss rows (#1110). Overwrites wholesale: the
/// mask is a projection of the seed's authored bestiary, so a partial edit has no meaning, and rewriting it in
/// the SAME PTB that (re)writes the table is what keeps mask and table in lockstep across a reseed. Passing an
/// EMPTY vector is a legal, meaningful state (a world whose bosses are all dungeon-only) and is identical to
/// having no mask at all — one degradation path, never two.
///
/// FAIL-CLOSED on a stale mask: every index must name a REAL row of the live table, so a mask written against a
/// table that has since shrunk aborts here instead of silently fencing the wrong species.
public fun set_boss_mask(cap: &AdminCap, w: &mut World, rows: vector<u16>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let n = w.mobs.length();
  let mut i = 0;
  while (i < rows.length()) {
    assert!((rows[i] as u64) < n, EBadEntryIndex);
    i = i + 1;
  };
  let key = BossMaskKey {};
  if (df::exists(&w.id, key)) { *df::borrow_mut<BossMaskKey, vector<u16>>(&mut w.id, key) = rows; }
  else { df::add(&mut w.id, key, rows); };
  touched(w);
}

/// The world's BOSS row indexes — EMPTY when no mask was ever written (the uniform absent ≡ empty rule). Read by
/// `zone_comp` when it builds the member pick table for a format-3 zone.
public fun boss_mask(w: &World): vector<u16> {
  let key = BossMaskKey {};
  if (df::exists(&w.id, key)) *df::borrow<BossMaskKey, vector<u16>>(&w.id, key) else vector[]
}

/// PIN (or clear) the gather-ambush defender for resource `template_id` — a `ProtectorKey → ID` DF on the World
/// UID (P1-1 live-ops dial; worlds seeded before the pin re-arm through this). `some` UPSERTS the pin; `none`
/// DISARMS (removes the DF — idempotent: disarming a never-pinned template is a no-op). Cap + version gated,
/// MIRRORING `set_mob_level` exactly — including its roster-agnostic shape: no row lookup, the key is the
/// template id (DECLARED change from the retired row-field draft, which aborted `EBadEntryIndex` on a missing
/// row; the DF door pins by template identity, valid before OR after the row lands).
public fun set_resource_protector(cap: &AdminCap, w: &mut World, template_id: ID, protector_template: Option<ID>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let key = ProtectorKey { template: template_id };
  if (protector_template.is_some()) {
    let pid = *protector_template.borrow();
    if (df::exists(&w.id, key)) { *df::borrow_mut<ProtectorKey, ID>(&mut w.id, key) = pid; }
    else { df::add(&mut w.id, key, pid); };
  } else if (df::exists(&w.id, key)) {
    let _: ID = df::remove(&mut w.id, key);
  };
  touched(w);
}

// ╔════════════════ [ Spawn-table + roster append/clear (cap + version gated) ] ═ ]

/// Append a RESOURCE spawn row. `job`/`tier` are stored as authored (data — no whitelist here); the qty band is
/// well-formed (`max ≥ min`, both ≥ 1: a node yields at least one harvest).
public fun add_resource_entry(cap: &AdminCap, w: &mut World, template_id: ID, rate_bp: u16, min_qty: u16, max_qty: u16, job: u8, tier: u8, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let lo = clamp_u16(min_qty, 1, DENSITY_MAX);
  let hi = clamp_u16(max_qty, 1, DENSITY_MAX);
  assert!(hi >= lo, EBadRange);
  w.resources.push_back(ResourceEntry { template_id, rate_bp: clamp_u16(rate_bp, 0, BP_MAX as u16), min_qty: lo, max_qty: hi, job, tier });
  touched(w);
}

/// Append a MOB-GROUP spawn row. Group size is sane-clamped for storage; `zones` re-clamps the ROLLED size to the
/// LIVE `GameConfig.team_size_bound` at spawn (one home for the engine bound).
public fun add_mob_entry(cap: &AdminCap, w: &mut World, template_id: ID, rate_bp: u16, min_group: u16, max_group: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let lo = clamp_u16(min_group, GROUP_MIN, GROUP_MAX);
  let hi = clamp_u16(max_group, GROUP_MIN, GROUP_MAX);
  assert!(hi >= lo, EBadRange);
  w.mobs.push_back(MobEntry { template_id, rate_bp: clamp_u16(rate_bp, 0, BP_MAX as u16), min_group: lo, max_group: hi });
  touched(w);
}

/// Append a dungeon room (its mob-template IDs). Rooms are ordered; the roster is `dungeon_rooms` in order (§9).
public fun add_dungeon_room(cap: &AdminCap, w: &mut World, mob_templates: vector<ID>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.dungeon_rooms.push_back(DungeonRoom { mobs: mob_templates });
  touched(w);
}

/// REPLACE the dungeon room at `index` in place (its mob-template IDs) — repairs an authored room (e.g. one
/// referencing a retired mob-template id) without reflowing the rest of the roster order (§9). Aborts
/// `EBadEntryIndex` past the room count, mirroring the getters' bounds check (`dungeon_room`). `add_dungeon_room`
/// performs no empty-vector check, so neither does this — same idiom, same event (`touched`).
public fun set_dungeon_room(cap: &AdminCap, w: &mut World, index: u64, mob_templates: vector<ID>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  assert!(index < w.dungeon_rooms.length(), EBadEntryIndex);
  *w.dungeon_rooms.borrow_mut(index) = DungeonRoom { mobs: mob_templates };
  touched(w);
}

/// Clear the spawn tables + roster for re-authoring (dark-package tuning). Live zone DFs are untouched — only the
/// TEMPLATE tables reset; already-spawned entities persist until they age/expire (§8).
public fun clear_tables(cap: &AdminCap, w: &mut World, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  w.resources = vector[];
  w.mobs = vector[];
  w.dungeon_rooms = vector[];
  // the boss mask indexes the mob table BY POSITION — a mask that outlives its table names the wrong species,
  // so retiring the content retires the mask with it (and leaves nothing stranded for `destroy_world`).
  let key = BossMaskKey {};
  if (df::exists(&w.id, key)) { let _: vector<u16> = df::remove(&mut w.id, key); };
  touched(w);
}

// ╔════════════════ [ Burn / teardown (cap + version gated, unrestricted template deletion) ] ═ ]

/// DRAIN this module's own DYNAMIC-FIELD children — the golden-gather links (`RareLinkKey → ID`), the
/// distance-difficulty levels (`MobLevelKey → u16`) and the gather-ambush pins (`ProtectorKey → ID`) — for the
/// given template ids, so a subsequent `destroy_world` strands no storage. IDEMPOTENT (each removal is
/// `exists`-guarded, tolerating already-drained / never-set keys) and BATCHED: the firing script reads the
/// world's live dynamic fields off-chain (`getDynamicFields`) and feeds the per-class template-id lists here,
/// chunked. Cap + version gated like every authoring door. Mirrors the item burn, which detaches its typed DFs
/// through their owning modules BEFORE the UID delete — here the World owns these three DF classes, so it drains
/// them; `zones` owns the fourth (`ZoneKey → Zone`) and drains it via `zones::drain_zones`.
public fun drain_world_links(
  cap: &AdminCap,
  w: &mut World,
  rare_templates: vector<ID>,
  mob_templates: vector<ID>,
  protector_templates: vector<ID>,
  version: &Version,
  ctx: &TxContext,
) {
  gate(cap, version, ctx);
  let mut rare_removed = 0;
  let mut i = 0;
  while (i < rare_templates.length()) {
    let key = RareLinkKey { template: rare_templates[i] };
    if (df::exists(&w.id, key)) {
      let _: ID = df::remove(&mut w.id, key);
      rare_removed = rare_removed + 1;
    };
    i = i + 1;
  };
  let mut levels_removed = 0;
  let mut j = 0;
  while (j < mob_templates.length()) {
    let key = MobLevelKey { template: mob_templates[j] };
    if (df::exists(&w.id, key)) {
      let _: u16 = df::remove(&mut w.id, key);
      levels_removed = levels_removed + 1;
    };
    j = j + 1;
  };
  let mut protectors_removed = 0;
  let mut k = 0;
  while (k < protector_templates.length()) {
    let key = ProtectorKey { template: protector_templates[k] };
    if (df::exists(&w.id, key)) {
      let _: ID = df::remove(&mut w.id, key);
      protectors_removed = protectors_removed + 1;
    };
    k = k + 1;
  };
  event::emit(WorldLinksDrained { world: object::id(w), rare_removed, levels_removed, protectors_removed });
  touched(w);
}

/// DESTROY an emptied world shell: delete the shared `World` object. Cap + version gated, MIRRORING `create_world`.
/// ABORTS (`EWorldNotEmpty`) unless the inline spawn tables (`resources` / `mobs` / `dungeon_rooms`) are ALL empty
/// — the deliberate two-step burn (`clear_tables` retires the content, THEN this deletes the shell), so a fully
/// populated LIVE world can never be nuked by a single fat-fingered call. The inline rows are `copy + drop`, so the
/// vectors carry NO stranding risk (they drop with the struct); the real stranding risk is the UID's DYNAMIC
/// FIELDS — this module's links (`drain_world_links`) and `zones`' discovered zones (`zones::drain_zones`). Raw
/// dynamic fields carry NO on-chain size, and a per-object counter cannot be retro-added to the frozen struct under
/// the COMPATIBLE upgrade policy, so their COMPLETE removal is proven OFF-CHAIN (`getDynamicFields == []`) exactly
/// as the item ghost burn proved zero references off-chain (PTB-first law: Move enforces the invariants it can, the
/// firing script proves the rest). Emits `WorldBurned`.
public fun destroy_world(cap: &AdminCap, w: World, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(w.resources.is_empty() && w.mobs.is_empty() && w.dungeon_rooms.is_empty(), EWorldNotEmpty);
  let World {
    id,
    seed,
    biome,
    required_level: _,
    bounds_x: _,
    bounds_z: _,
    zone_size: _,
    zone_ttl_ms: _,
    speed_budget: _,
    spawn_zone_x: _,
    spawn_zone_z: _,
    protector_bp: _,
    min_groups: _,
    max_groups: _,
    min_nodes: _,
    max_nodes: _,
    dungeon_key_template: _,
    resources: _,
    mobs: _,
    dungeon_rooms: _,
    spawn_nonce: _,
  } = w;
  event::emit(WorldBurned { world: id.to_inner(), seed, biome });
  object::delete(id);
}

// ╔════════════════ [ Zone coordinate math (overflow-proof, bounds-checked) ] ══ ]

/// Abort unless `(x,z)` is inside the world's barrier bounds — the precondition that makes every zone index
/// meaningful. Called before any `zone_of`.
public fun assert_in_bounds(w: &World, x: u32, z: u32) {
  assert!(x < w.bounds_x && z < w.bounds_z, EOutOfBounds);
}

/// The zone index owning `(x,z)`: `(x / zone_size, z / zone_size)`. u32/u32 division — NO overflow is possible.
/// Bounds-checked first, so an out-of-world coordinate ABORTS rather than indexing a phantom zone.
public fun zone_of(w: &World, x: u32, z: u32): (u32, u32) {
  assert_in_bounds(w, x, z);
  (x / w.zone_size, z / w.zone_size)
}

/// The block origin (min corner) of zone `(zx, zy)`. `zx * zone_size` can overflow u32 only for a zx past the
/// world's own zone count — callers derive `zx` from an in-bounds `zone_of`, so this is safe there; a raw caller
/// gets Move's checked-arithmetic abort (never a silent wrap).
public fun zone_origin(w: &World, zx: u32, zy: u32): (u32, u32) {
  (zx * w.zone_size, zy * w.zone_size)
}

// ╔════════════════ [ Package seam (zones attaches zone DFs) ] ═══════════════ ]
// (`reserve_spawn_ids` retired with the search-cost rework — spawn ids now DERIVE from the zone seed; the
// `spawn_nonce` World field stays as an inert struct slot so the World BCS layout is untouched mid-train.)

public(package) fun uid(self: &World): &UID { &self.id }

public(package) fun uid_mut(self: &mut World): &mut UID { &mut self.id }

// ╔════════════════ [ Getters (hot paths + RPC read these) ] ══════════════════ ]

public fun seed(w: &World): u64 { w.seed }
public fun biome(w: &World): String { w.biome }
public fun required_level(w: &World): u16 { w.required_level }
public fun bounds_x(w: &World): u32 { w.bounds_x }
public fun bounds_z(w: &World): u32 { w.bounds_z }
public fun zone_size(w: &World): u32 { w.zone_size }
public fun zone_ttl_ms(w: &World): u64 { w.zone_ttl_ms }
public fun speed_budget(w: &World): u64 { w.speed_budget }
public fun spawn_zone_x(w: &World): u32 { w.spawn_zone_x }
public fun spawn_zone_z(w: &World): u32 { w.spawn_zone_z }
public fun protector_bp(w: &World): u64 { w.protector_bp }
public fun min_groups(w: &World): u16 { w.min_groups }
public fun max_groups(w: &World): u16 { w.max_groups }
public fun min_nodes(w: &World): u16 { w.min_nodes }
public fun max_nodes(w: &World): u16 { w.max_nodes }
public fun dungeon_key_template(w: &World): Option<ID> { w.dungeon_key_template }

/// The RARE variant linked to base resource `template`, or `none` (no golden-gather jackpot for it). FREE read —
/// the gather roll and the RPC both consume it; `df::exists` guards the typed borrow.
public fun rare_link(w: &World, template: ID): Option<ID> {
  let key = RareLinkKey { template };
  if (df::exists(&w.id, key)) option::some(*df::borrow<RareLinkKey, ID>(&w.id, key)) else option::none()
}
public fun resource_count(w: &World): u64 { w.resources.length() }

/// The pinned gather-ambush defender for resource `template` (a `ProtectorKey → ID` DF read). `none` = never
/// ambushes (also the answer for an unknown template — defensive read). FREE read — the gather ambush gate
/// consumes it; `df::exists` guards the typed borrow, mirroring `rare_link`.
public fun resource_protector(w: &World, template: ID): Option<ID> {
  let key = ProtectorKey { template };
  if (df::exists(&w.id, key)) option::some(*df::borrow<ProtectorKey, ID>(&w.id, key)) else option::none()
}
public fun mob_count(w: &World): u64 { w.mobs.length() }

/// The distance-difficulty eligibility level for mob `template` (its authored `max_level` ceiling), or 0 when
/// unset (always eligible — feature dormant for that mob). FREE read; `df::exists` guards the typed borrow.
public fun mob_level(w: &World, template: ID): u16 {
  let key = MobLevelKey { template };
  if (df::exists(&w.id, key)) *df::borrow<MobLevelKey, u16>(&w.id, key) else 0
}

/// The eligibility level of EVERY mob-table row, in table order (PARALLEL to `mobs_snapshot`). `zones` snapshots
/// this to gate the distance roll without holding `&World` while it also holds the zone-DF `&mut UID`. Derived
/// from the same `mobs` vector order, so it can never desync from the roster it mirrors.
public fun mob_levels_snapshot(w: &World): vector<u16> {
  let n = w.mobs.length();
  let mut v = vector[];
  let mut i = 0;
  while (i < n) { v.push_back(mob_level(w, w.mobs[i].template_id)); i = i + 1; };
  v
}
public fun room_count(w: &World): u64 { w.dungeon_rooms.length() }

/// Full-table copies (rows are `copy`) — `zones` snapshots these to roll spawns WITHOUT holding `&World` while it
/// also holds the zone-DF `&mut UID`; the RPC reads them for the encyclopedia.
public fun resources_snapshot(w: &World): vector<ResourceEntry> { w.resources }
public fun mobs_snapshot(w: &World): vector<MobEntry> { w.mobs }

/// Immutable borrow of a resource row (aborts `EBadEntryIndex` out of range). `zones` reads these to roll spawns.
public fun resource_entry(w: &World, i: u64): &ResourceEntry {
  assert!(i < w.resources.length(), EBadEntryIndex);
  &w.resources[i]
}

public fun mob_entry(w: &World, i: u64): &MobEntry {
  assert!(i < w.mobs.length(), EBadEntryIndex);
  &w.mobs[i]
}

public fun dungeon_room(w: &World, i: u64): &DungeonRoom {
  assert!(i < w.dungeon_rooms.length(), EBadEntryIndex);
  &w.dungeon_rooms[i]
}

// Row field accessors (RPC + zones).
public fun re_template(e: &ResourceEntry): ID { e.template_id }
public fun re_rate_bp(e: &ResourceEntry): u16 { e.rate_bp }
public fun re_min_qty(e: &ResourceEntry): u16 { e.min_qty }
public fun re_max_qty(e: &ResourceEntry): u16 { e.max_qty }
public fun re_job(e: &ResourceEntry): u8 { e.job }
public fun re_tier(e: &ResourceEntry): u8 { e.tier }

public fun me_template(e: &MobEntry): ID { e.template_id }
public fun me_rate_bp(e: &MobEntry): u16 { e.rate_bp }
public fun me_min_group(e: &MobEntry): u16 { e.min_group }
public fun me_max_group(e: &MobEntry): u16 { e.max_group }

public fun room_mobs(r: &DungeonRoom): vector<ID> { r.mobs }

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

fun gate(cap: &AdminCap, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
}

fun touched(w: &World) { event::emit(WorldUpdated { world: object::id(w) }); }

fun clamp_u64(v: u64, lo: u64, hi: u64): u64 { if (v < lo) lo else if (v > hi) hi else v }
fun clamp_u32(v: u32, lo: u32, hi: u32): u32 { if (v < lo) lo else if (v > hi) hi else v }
fun clamp_u16(v: u16, lo: u16, hi: u16): u16 { if (v < lo) lo else if (v > hi) hi else v }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun set_spawn_nonce_for_testing(w: &mut World, n: u64) { w.spawn_nonce = n; }
