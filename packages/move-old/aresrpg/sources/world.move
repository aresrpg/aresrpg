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
/// dependency leaf except for `config::clamp`, the package's one u64 clamp home; it imports no `GameConfig`.
/// The LIVE engine bound on mob group
/// size (§17.8 team_size_bound = 6) is one home on `GameConfig` and is applied at SPAWN time by `zones` (which
/// holds `&GameConfig` there); a world only stores per-world authored sizes (sane-clamped). Setters are AdminCap-
/// + Version-gated and CLAMP (coercion, not rejection — a compromised cap can rebalance a world but never store an
/// out-of-band value); an out-of-range table index ABORTS (no meaningful clamp). Zone coordinate math is
/// OVERFLOW-PROOF by construction: a zone index is `pos / zone_size` (u32/u32, no overflow), bounds-checked first.
module aresrpg::world;
use aresrpg_foundation::world_math;

use aresrpg::{admin::AdminCap, config, version::Version};
use std::string::String;
use sui::{event, vec_map::{Self, VecMap}, versioned::{Self, Versioned}};

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
/// the tool + XP, the tier for the yield formula (§18 annex §5) and the y16 gate. DECLARED deviation from the
/// brief's uniform {template,rate,min,max} shape: resources need gathering metadata; mobs do not.
public struct ResourceEntry has copy, drop, store {
  template_id: ID,
  rate_bp: u16,
  min_qty: u16,
  max_qty: u16,
  job: u8,
  tier: u8,
}

/// One MOB-GROUP spawn row. Same rate/size skeleton; `min_group`/`max_group` bound the individuals per group
/// (§5, 1–6). No job/tier — mobs are not gathered.
public struct MobEntry has copy, drop, store {
  template_id: ID,
  rate_bp: u16,
  min_group: u16,
  max_group: u16,
}

/// One dungeon room: the mob TEMPLATE IDs composing it (the last room is traditionally the strongest — §8/§9,
/// no boss mechanic). IDs, never typed refs.
public struct DungeonRoom has copy, drop, store { mobs: vector<ID> }




/// THE BOSS FENCE (#1110 design amendment 2) is `WorldInner.boss_mask`: the world-scoped list of mob-table row
/// INDEXES that are BOSS rows. Mixed-species packs draw their non-primary members from the eligible roster, and
/// 9 boss rows sit in the live pick tables — without a boss predicate the draw could mint multi-boss packs or a
/// boss riding a chicklet group. `MobTemplate` carries no family/boss field, so the predicate lives with the
/// world. It was a dynamic field only because a COMPATIBLE upgrade cannot add one to a frozen struct; the
/// republish (#1289) made it a plain inline field, and its key struct is gone.
///

/// THE world template. Shared once at `create_world`; every field is admin-tunable within its clamp band. Spawn
/// tables + roster grow via the append setters. `spawn_nonce` mints unique per-world spawn ids for `zones`.
/// The world SHELL — an id and a version-wrapped payload. The shell's own `UID` still carries the zone dynamic
/// fields (`zones` writes them through `uid_mut`); everything that is *world state* lives in `WorldInner`.
///
/// WHY (#1289): a `key` struct's layout freezes at publish, and this package already paid for that four times —
/// `rare_links`, `mob_levels`, `protectors` and `boss_mask` were all dynamic-field workarounds for a field that
/// could not be added. Wrapping the payload in `Versioned` (the DeepBookV3 `RegistryInner` shape) means the next
/// dial is a new inner struct plus one migrate, never a new DF key class. Costs one indirection per read.
const WORLD_VERSION: u64 = 1;
const EWrongInnerVersion: u64 = 199; // the wrapped payload is not the version this package speaks

public struct World has key {
  id: UID,
  inner: Versioned,
}

/// The world's actual state. Add fields here freely — a new version + `migrate` is the whole ceremony.
public struct WorldInner has store {
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
  // Republish restructure (#1289): these four were dynamic-field workarounds for a frozen layout. The republish
  // window let them become what they always were — state of the world. `mob_levels` is PARALLEL to `mobs`, so a
  // roster snapshot is one field read instead of 2N dynamic-field ops (#1290).
  rare_links: VecMap<ID, ID>,
  mob_levels: vector<u16>,
  protectors: VecMap<ID, ID>,
  boss_mask: vector<u16>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct WorldCreated has copy, drop { world: ID, seed: u64, biome: String }

public struct WorldUpdated has copy, drop { world: ID } // any dial/table edit — the RPC re-reads the object

/// A base→rare golden-gather link was set/overwritten (§6). The indexer projects the link table from these.
public struct RareLinkSet has copy, drop { world: ID, template: ID, rare_template: ID }

/// A base resource's golden-gather link was removed (§6) — no more jackpot for it.
public struct RareLinkCleared has copy, drop { world: ID, template: ID }

/// A batch of this module's own link state (rare links, mob levels, protector pins)
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
  let inner = WorldInner {
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
    rare_links: vec_map::empty(),
    mob_levels: vector[],
    protectors: vec_map::empty(),
    boss_mask: vector[],
    resources: vector[],
    mobs: vector[],
    dungeon_rooms: vector[],
    spawn_nonce: 0,
  };
  let world = World { id: object::new(ctx), inner: versioned::create(WORLD_VERSION, inner, ctx) };
  let wid = object::id(&world);
  event::emit(WorldCreated { world: wid, seed, biome });
  transfer::share_object(world);
  wid
}

// ╔════════════════ [ Scalar-dial setters (cap + version gated, clamped) ] ════ ]

public fun set_required_level(cap: &AdminCap, w: &mut World, value: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).required_level = y147(value, LEVEL_MIN as u16, LEVEL_MAX as u16);
  y144(w);
}

public fun set_bounds(cap: &AdminCap, w: &mut World, x: u32, z: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).bounds_x = y146(x, BOUND_MIN, BOUND_MAX);
  y142(w).bounds_z = y146(z, BOUND_MIN, BOUND_MAX);
  y144(w);
}

public fun set_zone_size(cap: &AdminCap, w: &mut World, value: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).zone_size = y146(value, ZONE_SIZE_MIN, ZONE_SIZE_MAX);
  y144(w);
}

public fun set_zone_ttl_ms(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).zone_ttl_ms = config::clamp(value, TTL_MIN, TTL_MAX);
  y144(w);
}

public fun set_speed_budget(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).speed_budget = config::clamp(value, SPEED_MIN, SPEED_MAX);
  y144(w);
}

public fun set_spawn_zone(cap: &AdminCap, w: &mut World, x: u32, z: u32, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  // the spawn box can never exceed the world bounds (a roll inside it must land in-bounds)
  y142(w).spawn_zone_x = y146(x, 1, y142(w).bounds_x);
  y142(w).spawn_zone_z = y146(z, 1, y142(w).bounds_z);
  y144(w);
}

public fun set_protector_bp(cap: &AdminCap, w: &mut World, value: u64, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).protector_bp = config::clamp(value, 0, BP_MAX);
  y144(w);
}

/// Density: how many mob GROUPS and resource NODES a discovered zone tops up toward (§17.18). Each is a [min,max]
/// band; a search rolls a target within it. Clamped to the hard rail, then `max ≥ min` enforced (`EBadRange`).
public fun set_density(cap: &AdminCap, w: &mut World, min_groups: u16, max_groups: u16, min_nodes: u16, max_nodes: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).min_groups = y147(min_groups, 0, DENSITY_MAX);
  y142(w).max_groups = y147(max_groups, 0, DENSITY_MAX);
  y142(w).min_nodes = y147(min_nodes, 0, DENSITY_MAX);
  y142(w).max_nodes = y147(max_nodes, 0, DENSITY_MAX);
  assert!(y142(w).max_groups >= y142(w).min_groups && y142(w).max_nodes >= y142(w).min_nodes, EBadRange);
  y144(w);
}

public fun set_dungeon_key(cap: &AdminCap, w: &mut World, template_id: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).dungeon_key_template = option::some(template_id);
  y144(w);
}

// ╔════════════════ [ Golden-gather rare links (cap + version gated; DF on the World UID) ] ═ ]

/// LINK a base resource `template` to its unique RARE variant `rare_template` — the §6 golden-gather jackpot the
/// gather roll mints on a `RARE_BP` hit. UPSERT: re-linking overwrites. Cap + version gated like every authoring
/// door. Storing an id (not a typed ref) mirrors the spawn-table seam law.
public fun set_rare_link(cap: &AdminCap, w: &mut World, template: ID, rare_template: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  if (y142(w).rare_links.contains(&template)) { *y142(w).rare_links.get_mut(&template) = rare_template; }
  else { y142(w).rare_links.insert(template, rare_template); };
  event::emit(RareLinkSet { world: object::id(w), template, rare_template });
  y144(w);
}

/// UNLINK a base resource's rare variant (no more jackpot for it). Aborts if `WorldInner.rare_links` has no entry.
public fun clear_rare_link(cap: &AdminCap, w: &mut World, template: ID, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let (_, _) = y142(w).rare_links.remove(&template);
  event::emit(RareLinkCleared { world: object::id(w), template });
  y144(w);
}

/// SET (upsert) the DISTANCE-DIFFICULTY eligibility LEVEL for mob `template` — its `max_level` ceiling, authored
/// once per roster mob (§4 wave-2b) so `zones` gates spawns by zone distance WITHOUT loading every MobTemplate.
/// UNSET templates default to level 0 (always eligible → a world with NO levels authored keeps the pre-wave-2b
/// "every mob everywhere" behaviour, feature-dormant). Cap + version gated like every authoring door; a scalar
/// keyed by template id mirrors the spawn-table seam law (the level's ONE home is the seed JSON — projected here).
public fun set_mob_level(cap: &AdminCap, w: &mut World, template: ID, level: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  // PARALLEL to the table (#1290): the level lives at the row's index, so the snapshot is a plain field read.
  // EVERY row of this template, not just the first. The retired `MobLevelKey` dynamic field was keyed BY
  // TEMPLATE, so one level always applied to every row carrying it; authoring permits duplicate rows, and
  // updating only the first would silently leave the later duplicates dormant at 0. Update-all reproduces the
  // pre-republish semantics exactly and can never reject a corpus that already authored duplicates.
  let n = y141(w).mobs.length();
  let mut i = 0;
  let mut found = false;
  while (i < n) {
    if (y141(w).mobs[i].template_id == template) {
      *&mut y142(w).mob_levels[i] = level;
      found = true;
    };
    i = i + 1;
  };
  assert!(found, EBadEntryIndex);
  y144(w);
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
  let n = y142(w).mobs.length();
  let mut i = 0;
  while (i < rows.length()) {
    assert!((rows[i] as u64) < n, EBadEntryIndex);
    i = i + 1;
  };
  y142(w).boss_mask = rows;
  y144(w);
}

/// The world's BOSS row indexes — EMPTY when no mask was ever written (the uniform absent ≡ empty rule). Read by
/// `zone_comp` when it builds the member pick table for a format-3 zone.
public fun boss_mask(w: &World): vector<u16> {
  y141(w).boss_mask
}

/// PIN (or clear) the gather-ambush defender for resource `template_id` — a real `protectors` map entry
/// (P1-1 live-ops dial; worlds seeded before the pin re-arm through this). `some` UPSERTS the pin; `none`
/// DISARMS (removes the DF — idempotent: disarming a never-pinned template is a no-op). Cap + version gated,
/// MIRRORING `set_mob_level` exactly — including its roster-agnostic shape: no row lookup, the key is the
/// template id (DECLARED change from the retired row-field draft, which aborted `EBadEntryIndex` on a missing
/// row; the DF door pins by template identity, valid before OR after the row lands).
public fun set_resource_protector(cap: &AdminCap, w: &mut World, template_id: ID, protector_template: Option<ID>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  if (protector_template.is_some()) {
    let pid = *protector_template.borrow();
    if (y142(w).protectors.contains(&template_id)) { *y142(w).protectors.get_mut(&template_id) = pid; }
    else { y142(w).protectors.insert(template_id, pid); };
  } else if (y142(w).protectors.contains(&template_id)) {
    let (_, _) = y142(w).protectors.remove(&template_id);
  };
  y144(w);
}

// ╔════════════════ [ Spawn-table + roster append/clear (cap + version gated) ] ═ ]

/// Append a RESOURCE spawn row. `job`/`tier` are stored as authored (data — no whitelist here); the qty band is
/// well-formed (`max ≥ min`, both ≥ 1: a node yields at least one harvest).
public fun add_resource_entry(cap: &AdminCap, w: &mut World, template_id: ID, rate_bp: u16, min_qty: u16, max_qty: u16, job: u8, tier: u8, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let lo = y147(min_qty, 1, DENSITY_MAX);
  let hi = y147(max_qty, 1, DENSITY_MAX);
  assert!(hi >= lo, EBadRange);
  y142(w).resources.push_back(ResourceEntry { template_id, rate_bp: y147(rate_bp, 0, BP_MAX as u16), min_qty: lo, max_qty: hi, job, tier });
  y144(w);
}

/// Append a MOB-GROUP spawn row. Group size is sane-clamped for storage; `zones` re-clamps the ROLLED size to the
/// LIVE `GameConfig.team_size_bound` at spawn (one home for the engine bound).
public fun add_mob_entry(cap: &AdminCap, w: &mut World, template_id: ID, rate_bp: u16, min_group: u16, max_group: u16, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  let lo = y147(min_group, GROUP_MIN, GROUP_MAX);
  let hi = y147(max_group, GROUP_MIN, GROUP_MAX);
  assert!(hi >= lo, EBadRange);
  y142(w).mobs.push_back(MobEntry { template_id, rate_bp: y147(rate_bp, 0, BP_MAX as u16), min_group: lo, max_group: hi });
  y142(w).mob_levels.push_back(0); // stays PARALLEL to `mobs`; 0 = unauthored, the dormant default
  y144(w);
}

/// Append a dungeon room (its mob-template IDs). Rooms are ordered; the roster is `dungeon_rooms` in order (§9).
public fun add_dungeon_room(cap: &AdminCap, w: &mut World, mob_templates: vector<ID>, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).dungeon_rooms.push_back(DungeonRoom { mobs: mob_templates });
  y144(w);
}

/// Clear the spawn tables + roster for re-authoring (dark-package tuning). Live zone DFs are untouched — only the
/// TEMPLATE tables reset; already-spawned entities persist until they age/expire (§8).
public fun clear_tables(cap: &AdminCap, w: &mut World, version: &Version, ctx: &TxContext) {
  gate(cap, version, ctx);
  y142(w).resources = vector[];
  y142(w).mobs = vector[];
  y142(w).dungeon_rooms = vector[];
  // the boss mask indexes the mob table BY POSITION — a mask that outlives its table names the wrong species,
  // so retiring the content retires the mask with it (and leaves nothing stranded for `destroy_world`).
  y142(w).boss_mask = vector[];
  y142(w).mob_levels = vector[]; // parallel to `mobs`, which this call just emptied
  y144(w);
}

// ╔════════════════ [ Burn / teardown (cap + version gated, unrestricted template deletion) ] ═ ]

/// Clear selected entries from the link state stored directly in `WorldInner`: remove `rare_links` and
/// `protectors` keys, and zero the `mob_levels` slots whose parallel `mobs` rows match the supplied templates.
/// Call this before `clear_tables` when the teardown needs per-link removal counts; after the inline mob roster is
/// cleared there is no template-to-level position left to match. The operation is idempotent and may be batched by
/// passing subsets of the current template ids. No dynamic-field discovery is involved — only discovered zones are
/// children of the World UID, and those are drained separately through `zones::drain_zones`.
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
    let t = rare_templates[i];
    if (y142(w).rare_links.contains(&t)) {
      let (_, _) = y142(w).rare_links.remove(&t);
      rare_removed = rare_removed + 1;
    };
    i = i + 1;
  };
  let mut levels_removed = 0;
  let mut j = 0;
  while (j < mob_templates.length()) {
    let t = mob_templates[j];
    let n = y142(w).mobs.length();
    let mut r = 0;
    while (r < n) {
      if (y142(w).mobs[r].template_id == t && y142(w).mob_levels[r] != 0) {
        *&mut y142(w).mob_levels[r] = 0;
        levels_removed = levels_removed + 1;
      };
      r = r + 1;
    };
    j = j + 1;
  };
  let mut protectors_removed = 0;
  let mut k = 0;
  while (k < protector_templates.length()) {
    let t = protector_templates[k];
    if (y142(w).protectors.contains(&t)) {
      let (_, _) = y142(w).protectors.remove(&t);
      protectors_removed = protectors_removed + 1;
    };
    k = k + 1;
  };
  event::emit(WorldLinksDrained { world: object::id(w), rare_removed, levels_removed, protectors_removed });
  y144(w);
}

/// DESTROY an emptied world shell: delete the shared `World` object. Cap + version gated, MIRRORING `create_world`.
/// ABORTS (`EWorldNotEmpty`) unless the inline spawn tables (`resources` / `mobs` / `dungeon_rooms`) are ALL empty
/// — the deliberate two-step burn (`clear_tables` retires the content, THEN this deletes the shell), so a fully
/// populated LIVE world can never be nuked by a single fat-fingered call. The inline rows are `copy + drop`, so the
/// vectors carry NO stranding risk (they drop with the struct). The same is true of `rare_links`, `mob_levels`,
/// `protectors`, and `boss_mask`: they are real `WorldInner` fields and are destructured with the rest of the inner
/// value below; `drain_world_links` is optional accounting cleanup, not a UID-safety prerequisite. Discovered zones
/// are the only dynamic fields attached to the World UID, so teardown drains them through `zones::drain_zones`
/// before deleting the shell. Emits `WorldBurned`.
public fun destroy_world(cap: &AdminCap, w: World, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(y141(&w).resources.is_empty() && y141(&w).mobs.is_empty() && y141(&w).dungeon_rooms.is_empty(), EWorldNotEmpty);
  let World { id, inner } = w;
  let WorldInner {
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
    rare_links: _,
    mob_levels: _,
    protectors: _,
    boss_mask: _,
    resources: _,
    mobs: _,
    dungeon_rooms: _,
    spawn_nonce: _,
  } = versioned::destroy(inner);
  event::emit(WorldBurned { world: id.to_inner(), seed, biome });
  object::delete(id);
}

// ╔════════════════ [ Zone coordinate math (overflow-proof, bounds-checked) ] ══ ]

/// Abort unless `(x,z)` is inside the world's barrier bounds — the precondition that makes every zone index
/// meaningful. Called before any `zone_of`.
public fun assert_in_bounds(w: &World, x: u32, z: u32) {
  assert!(x < y141(w).bounds_x && z < y141(w).bounds_z, EOutOfBounds);
}

/// The zone index owning `(x,z)`: `(x / zone_size, z / zone_size)`. u32/u32 division — NO overflow is possible.
/// Bounds-checked first, so an out-of-world coordinate ABORTS rather than indexing a phantom zone.
public fun zone_of(w: &World, x: u32, z: u32): (u32, u32) {
  assert_in_bounds(w, x, z);
  (x / y141(w).zone_size, z / y141(w).zone_size)
}

/// The block origin (min corner) of zone `(zx, zy)`. `zx * zone_size` can overflow u32 only for a zx past the
/// world's own zone count — callers derive `zx` from an in-bounds `zone_of`, so this is safe there; a raw caller
/// gets Move's checked-arithmetic abort (never a silent wrap).
public fun zone_origin(w: &World, zx: u32, zy: u32): (u32, u32) {
  (zx * y141(w).zone_size, zy * y141(w).zone_size)
}

// ╔════════════════ [ Package seam (zones attaches zone DFs) ] ═══════════════ ]
// (`reserve_spawn_ids` retired with the search-cost rework — spawn ids now DERIVE from the zone seed; the
// `spawn_nonce` World field stays as an inert struct slot so the World BCS layout is untouched mid-train.)

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Read the version-wrapped payload, asserting this package speaks its version (DeepBookV3 shape).
fun y141(w: &World): &WorldInner {
  assert!(w.inner.version() == WORLD_VERSION, EWrongInnerVersion);
  w.inner.load_value()
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y142(w: &mut World): &mut WorldInner {
  assert!(w.inner.version() == WORLD_VERSION, EWrongInnerVersion);
  w.inner.load_value_mut()
}

public(package) fun uid(self: &World): &UID { &self.id }

public(package) fun uid_mut(self: &mut World): &mut UID { &mut self.id }

// ╔════════════════ [ Getters (hot paths + RPC read these) ] ══════════════════ ]

public fun seed(w: &World): u64 { y141(w).seed }
public fun biome(w: &World): String { y141(w).biome }
public fun required_level(w: &World): u16 { y141(w).required_level }
public fun bounds_x(w: &World): u32 { y141(w).bounds_x }
public fun bounds_z(w: &World): u32 { y141(w).bounds_z }
public fun zone_size(w: &World): u32 { y141(w).zone_size }
public fun zone_ttl_ms(w: &World): u64 { y141(w).zone_ttl_ms }
public fun speed_budget(w: &World): u64 { y141(w).speed_budget }
public fun spawn_zone_x(w: &World): u32 { y141(w).spawn_zone_x }
public fun spawn_zone_z(w: &World): u32 { y141(w).spawn_zone_z }
public fun protector_bp(w: &World): u64 { y141(w).protector_bp }
public fun min_groups(w: &World): u16 { y141(w).min_groups }
public fun max_groups(w: &World): u16 { y141(w).max_groups }
public fun min_nodes(w: &World): u16 { y141(w).min_nodes }
public fun max_nodes(w: &World): u16 { y141(w).max_nodes }
public fun dungeon_key_template(w: &World): Option<ID> { y141(w).dungeon_key_template }

/// The RARE variant linked to base resource `template`, or `none` (no golden-gather jackpot for it). FREE read —
/// the gather roll and the RPC both consume it; the inline `rare_links` map's `contains` guards `get`.
public fun rare_link(w: &World, template: ID): Option<ID> {
  if (y141(w).rare_links.contains(&template)) option::some(*y141(w).rare_links.get(&template)) else option::none()
}
#[test_only]
public fun resource_count(w: &World): u64 { y141(w).resources.length() }

/// The pinned gather-ambush defender for resource `template`. `none` = never
/// ambushes (also the answer for an unknown template — defensive read). FREE read — the gather ambush gate
/// consumes it; the inline `protectors` map's `contains` guards `get`, mirroring `rare_link`.
public fun resource_protector(w: &World, template: ID): Option<ID> {
  if (y141(w).protectors.contains(&template)) option::some(*y141(w).protectors.get(&template)) else option::none()
}
public fun mob_count(w: &World): u64 { y141(w).mobs.length() }

/// The distance-difficulty eligibility level for mob `template` (its authored `max_level` ceiling), or 0 when
/// unset (always eligible — feature dormant for that mob). FREE read of the `mob_levels` field parallel to `mobs`.
#[test_only]
public fun mob_level(w: &World, template: ID): u16 {
  let n = y141(w).mobs.length();
  let mut i = 0;
  while (i < n) { if (y141(w).mobs[i].template_id == template) return y141(w).mob_levels[i]; i = i + 1; };
  0
}


/// The eligibility level of EVERY mob-table row, in table order (PARALLEL to `mobs_snapshot`). `zones` snapshots
/// this to gate the distance roll without holding `&World` while it also holds the zone-DF `&mut UID`. Derived
/// from the same `mobs` vector order, so it can never desync from the roster it mirrors.
public fun mob_levels_snapshot(w: &World): vector<u16> {
  y141(w).mob_levels
}
public fun room_count(w: &World): u64 { y141(w).dungeon_rooms.length() }

/// Full-table copies (rows are `copy`) — `zones` snapshots these to roll spawns WITHOUT holding `&World` while it
/// also holds the zone-DF `&mut UID`; the RPC reads them for the encyclopedia.
public fun resources_snapshot(w: &World): vector<ResourceEntry> { y141(w).resources }
public fun mobs_snapshot(w: &World): vector<MobEntry> { y141(w).mobs }

/// Immutable borrow of a resource row (aborts `EBadEntryIndex` out of range). `zones` reads these to roll spawns.
#[test_only]
public fun resource_entry(w: &World, i: u64): &ResourceEntry {
  assert!(i < y141(w).resources.length(), EBadEntryIndex);
  &y141(w).resources[i]
}

#[test_only]
public fun mob_entry(w: &World, i: u64): &MobEntry {
  assert!(i < y141(w).mobs.length(), EBadEntryIndex);
  &y141(w).mobs[i]
}

public fun dungeon_room(w: &World, i: u64): &DungeonRoom {
  assert!(i < y141(w).dungeon_rooms.length(), EBadEntryIndex);
  &y141(w).dungeon_rooms[i]
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

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y144(w: &World) { event::emit(WorldUpdated { world: object::id(w) }); }

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y146(v: u32, lo: u32, hi: u32): u32 { if (v < lo) lo else if (v > hi) hi else v }
// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y147(v: u16, lo: u16, hi: u16): u16 { if (v < lo) lo else if (v > hi) hi else v }

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

// ╔════════════════ [ merged from `checkpoint` — republish restructure #1287 ] ══════ ]
// ╔════════════════ [ Errors (documented for the frontend in the module header) ] ═ ]

const ECheckpointFuture: u64 = 120; // from `checkpoint` — merged-in codes get their own block so module+code stays unambiguous
const ETravelTooFar: u64 = 121; // from `checkpoint` — merged-in codes get their own block so module+code stays unambiguous

// ╔════════════════ [ Type ] ═════════════════════════════════════════════════ ]

/// Proven position + proven time + the pet-equipped SNAPSHOT taken at the WRITE (the only verifiable form of the
/// "both ends" mount rule — §17.2). `copy + drop + store`: it rides as a DF value and passes by value freely.
public struct Checkpoint has copy, drop, store {
  x: u32,
  z: u32,
  time_ms: u64,
  pet_equipped: bool,
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
public(package) fun y70(x: u32, z: u32, time_ms: u64, pet_equipped: bool): Checkpoint {
  Checkpoint { x, z, time_ms, pet_equipped }
}

public fun x(cp: &Checkpoint): u32 { cp.x }
public fun z(cp: &Checkpoint): u32 { cp.z }
public fun time_ms(cp: &Checkpoint): u64 { cp.time_ms }
public fun pet_equipped(cp: &Checkpoint): bool { cp.pet_equipped }

// ╔════════════════ [ Verification (abort form — the value-path gate) ] ═══════ ]

/// Abort unless traveling from `cp` to `(to_x, to_z)` by `now_ms` is physically plausible at the world's speed
/// budget. `pet_both` MUST already fold "pet equipped at both ends" (`cp.pet_equipped && pet_now`); the caller
/// owns reading the live pet flag. Non-punitive by design: elapsed only grows, so a refused caller waits and
/// retries (§17.3) — see `wait_seconds`.
public fun verify_travel(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool) {
  assert!(now_ms >= cp.time_ms, ECheckpointFuture);
  assert!(travel_ok(w, cp, to_x, to_z, now_ms, pet_both), ETravelTooFar);
}

/// The boolean core (also the test oracle). `true` iff the move is coverable. Same math as `verify_travel`,
/// exposed for callers that want to branch rather than abort.
public fun travel_ok(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): bool {
  world_math::travel_ok(speed_budget(w), cp.x, cp.z, cp.time_ms, to_x, to_z, now_ms, pet_both)
}

// ╔════════════════ [ wait_seconds (public pure UI helper — teach, don't reject) ] ═ ]

/// How many MORE seconds until the move becomes legal (0 if already legal). The UI reads this to say "wait Ns".
/// Uses an integer sqrt for the linear distance (non-consensus — the abort path stays exact via squared compare),
/// so it may be off by <1 block; that is fine for a countdown. `pet_both` mirrors the check's mount rule.
public fun wait_seconds(w: &World, cp: &Checkpoint, to_x: u32, to_z: u32, now_ms: u64, pet_both: bool): u64 {
  world_math::wait_seconds(speed_budget(w), cp.x, cp.z, cp.time_ms, to_x, to_z, now_ms, pet_both)
}
