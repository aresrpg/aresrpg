// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Surface decoration (§4.6 decorators) — deterministic per-column scatter of the DIVERGENCE WAVE grass
// OCEAN (waist-high tall_grass across meadows, shore reeds, meadow flower patches, forest-floor fern
// undergrowth — surface_flora) PLUS the REAL legacy schematic vegetation (trees + rocks) over the
// already-filled terrain of ONE chunk record. Runs as a separable post-pass after column_gen's solid/
// water fill (world_gen.js layers it on) so the golden-hashed terrain core in column_gen stays
// byte-stable; decoration lives in the demo/gameplay path, NOT in the world-identity hash (GEN_VERSION
// records the decorated-world fork — v6 = this ocean; see world_config.js).
//
// VEG PHASE B (this file): the procedural "lollipop" stamp_tree is GONE. Trees and rocks are now the
// aresrpg-legacy Sponge schematics resolved by src/gen/schematics/{loader,stamper}.js, placed via the
// deterministic stamper whose cross-border clip proof (stamper.test.js) guarantees a schematic
// straddling chunks tiles seamlessly. FIVE-WORLDS P2: the bundle is now the FULL legacy library (114
// trees / 148 rocks). BIOME_SCHEMATICS below places a CLIMATE-CURATED SUBSET of families; the rest are
// library assets carried in the bundle + wired into biome_registry.structure_pools, awaiting the
// phase-3 pool-aware placement. See the stamper header for the exact swap plan this file executes.
//
// DETERMINISM LAW (§3.7): integer arithmetic ONLY — same splitmix-style hash lineage as the stamper
// (multiply/xor/shift on u32). No transcendentals, no Math.random. Every placement is a pure function
// of (world_x, world_z) + a per-decision salt folded with the world seed, so the SAME species/tuft is
// decided identically in every vertical chunk of a column AND from every chunk a wide canopy spills
// into. The world seed is threaded in (decorate_chunk's `seed` param) so different worlds decorate
// differently while staying deterministic per world.
//
// HALO (the one structural change beyond swapping): a wide canopy anchored in a NEIGHBOR chunk still
// owes this chunk its in-bounds voxels. So decorate_chunk scans anchor columns in a halo of
// max_horizontal_reach(set) beyond its own 32×32 footprint; each halo winner's surface_y/biome come
// from a DIRECT, on-the-fly column_gen probe (anchor_surface — the SAME source the in-chunk anchors
// use, so a straddling schematic derives one base-y from every chunk it touches). The stamper clips
// every placement to this chunk's 0..31 bounds; the union across chunks equals the whole tree.
//
// RENDER NOTE: the mesher is occupancy-driven and solid-class-only (mesher.js / binary_greedy.js).
// LOGS/LEAVES/ROCK are registry class 'solid' (opaque) → they MUST get occupancy bits (3 axes) or the
// greedy mesher never sees their faces (the historic "bald trunk / invisible canopy" defect). The
// stamper sets those bits for every solid voxel it writes (place_world_voxel). Only the true CROSS
// foliage this file still scatters (grass tufts, flowers — class 'foliage', shape 'cross') stays out
// of the occupancy masks: the mesher's cross pass emits those from `ids` directly.

import { CHUNK_SIZE, SEA_LEVEL } from '../config/world_config.js'
import { column_index, local_index } from '../chunks/format.js'
import { get_block_by_name } from '../config/block_registry.js'
import { get_biome_by_id, resolve_land_block_ids } from '../config/biome_registry.js'

import { anchor_surface } from './column_gen.js'
import { grass_covered } from './surface_density.js'
import { load_schematic_set, load_pool, for_each_voxel } from './schematics/loader.js'
import { max_horizontal_reach, select_schematic, stamp_into_chunk, place_world_voxel } from './schematics/stamper.js'
import {
  DECO_DEFAULTS,
  resolve_deco,
  sprite_on,
  hash_column,
  in_grove,
  tree_cleared_at,
  resolve_grammar,
  grammar_tree_at,
  grammar_rock_at,
  grammar_hero_species,
  grammar_biome_density,
} from './deco_shared.js'
import { surface_flora, flora_availability } from './surface_flora.js'
import { generate_tree } from './trees/tree_gen.js'
import { pick_baked_tree } from './trees/tree_bake.js'
import { SPECIES } from './trees/species.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('./column_gen.js').ColumnProfile} ColumnProfile */
/** @typedef {import('./column_gen.js').GenContext} GenContext */
/** @typedef {import('./schematics/loader.js').ResolvedSchematic} ResolvedSchematic */

// Cross-foliage clutter block ids (feature-detected — resolve by name at load, skip silently when
// absent, exactly as the first-cut decorator did). Trees/rocks no longer depend on log/leaves ids
// here — the schematic loader owns block resolution via registry_map.js.
// Schematic-path block ids (feature-detected). The cross-flora block ids + placement rule live in
// surface_flora.js now; the SAND id here is the submerged-coral seabed gate, WATER the coverage test.
const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const SAND = get_block_by_name('sand')?.id
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
// FIVE-WORLDS Paradise CORAL sprites (feature-detected; absent in a bundle ⇒ the submerged path no-ops).
const CORALS = ['coral_pink', 'coral_purple', 'coral_teal']
  .map((n) => get_block_by_name(n)?.id)
  .filter((id) => id !== undefined)

// ---- Loaded schematic sets (resolved once — resolution is pure, memoized in the loader) ----------
/** @type {ResolvedSchematic[]} */
const TREE_SET = load_schematic_set('tree')
/** @type {ResolvedSchematic[]} */
const ROCK_SET = load_schematic_set('rock')
/** Trees/rocks decorate only when their set is non-empty (bundle present). */
const TREES_ENABLED = TREE_SET.length > 0
const ROCKS_ENABLED = ROCK_SET.length > 0

// ---- Grove clustering (preserved from the first cut — a uniform sprinkle read as a pole field) ----
// The world is tiled into coarse 16×16-block cells; a salted cell hash marks ~1/GROVE_ONE_IN of them
// as "groves", and only columns inside a grove roll for a tree. Trees thus arrive in clumps with open
// meadow between groves. Rocks use their OWN sparser grove field so boulders don't crowd the forests.
// ── DECORATOR DENSITIES — now CONFIG-DRIVEN (FIVE-WORLDS adoption, like P0 for splines/density/sky).
// DECO_DEFAULTS holds the LIVE values 1:1; resolve_deco(config.decoration) merges a world's overrides on
// top (default recipe == these values ⇒ byte-identical DEFAULT world). Grove clustering: the world is
// tiled into 1<<grove_cell_shift-block cells; ~1/tree_grove_one_in are tree groves (dense forests), rocks
// use a sparser field. Biome eligibility is the BIOME_SCHEMATICS/structure_pool mapping ALONE (per-biome
// tree_one_in is the sparsity lever); the DIVERGENCE WAVE cross-flora densities size the grass OCEAN:
// tall-grass accent clusters, forest fern carpet + bare paths, meadow flower patches, shore reeds.
// Independent decision salts (decorrelated u32 streams). SCHEMATIC salts only — the flora salts moved to
// surface_flora.js with the flora placer. Schematic PICK + ROTATION salts live in the stamper.
const SALT_TREE_GROVE = 0x7feb352d
const SALT_ROCK_GROVE = 0x2545f491
const SALT_TREE = 0x9e3779b1
const SALT_ROCK = 0x94d049bb
const SALT_CORAL = 0x3b1faa11 // Paradise submerged-coral density + species pick
const SALT_TREE_SPECIES = 0x1b56c4e9 // procedural species weighted pick (decorrelated from grove/select/rotate)
const SALT_TREE_ROT = 0x68e31da4 // baked-tree quarter-turn pick (GEN_VERSION 9 bake-then-stamp; live path stays rotation 0)
// SALT_SPAWN_CLEAR lives in deco_shared.js beside tree_cleared_at (the seam-shared clearing gate).
// GROUNDING: how many blocks above the base layer a column's lowest voxel may be and still count as the
// schematic's underside CONTACT (gets a pedestal). Above this = the schematic's overhang silhouette, kept airy.
const PEDESTAL_CONTACT = 5
// hash_column + in_grove moved to deco_shared.js (imported above); the cross-flora placer (surface_flora +
// pick_flower + the meadow herb-layer rule) moved to surface_flora.js. This file owns SCHEMATIC placement.

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BIOME → SPECIES MAPPING
// ──────────────────────────────────────────────────────────────────────────────────────────────
// Which schematic families each biome hosts, keyed by biome NAME (biome_registry ids are persisted
// but names are stable). Species are matched by NAME PREFIX against the loaded sets so a biome maps
// to ALL its size variants (e.g. GRASSLAND_TREE_G1 + GRASSLAND_TREE_G4). `tree_one_in` / `rock_one_in`
// are the per-column inverse densities INSIDE a grove — smaller = denser. Design rule: forests
// read DENSE in forest biomes, sparse in deserts. Bigger schematics are naturally rarer because the
// grove roll fires the same rate regardless of footprint, so a big-tree-only biome yields fewer,
// larger trees per area than a small-tree biome at the same denominator.
//
// Schematic name prefixes present in the bundle (verified against assets/schematics/schematics.json):
//   trees: GRASSLAND_TREE / GRASSLAND_ACACIA / GRASSLAND_BIRCH, TAIGA_CHENE_BIG / TAIGA_HUGE_SAPIN,
//          SWAMP_BIG_TREE, TROPICAL_NORMAL_TREE, DESERT_TREE, TEMPERATE_MUSHROND, ARCTIC_DEADTREE
//   rocks: GRASSLAND_ROCK_BIG, TAIGA_ROCK, TEMPERATE_ROCK, ARCTIC_BIG_ROCK, DESERT_BIG_ROCK,
//          SCORCHED_ROCK_LAVA, TROPICAL_BIG_ROCK
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} BiomeSchematicRule
 * @property {string[]} trees schematic-name prefixes eligible as trees in this biome (empty = none)
 * @property {string[]} rocks schematic-name prefixes eligible as rocks in this biome (empty = none)
 * @property {number} tree_one_in per-column inverse tree density inside a grove (smaller = denser)
 * @property {number} rock_one_in per-column inverse rock density inside a rock grove (larger = rarer)
 */

/**
 * Biome name → eligible schematic families + densities. Biomes absent from this table (ocean/beach/
 * river/alpine/esoterics) grow no schematics. The mapping honors climate: grass/oak/birch → temperate
 * grass biomes; acacia → dry savanna-ish grassland; taiga sapin + chêne giants → cold conifer belts;
 * swamp big tree → humid lowland swamp; tropical → hot-humid; desert tree → desert (very sparse);
 * mushroom → rare temperate special; arctic deadtree → snow/cold sparse.
 * @type {Record<string, BiomeSchematicRule>}
 */
export const BIOME_SCHEMATICS = {
  // ⚠ SCHEMATIC TREE STAMPS RETIRED (GEN_VERSION 8, ENGINE_AAA_PLAN C4): every `trees` list below is now
  // EMPTY — trees are grown PROCEDURALLY (config.trees.procedural default true; the per-biome tree_species
  // roster in world_gen_config.js). What STAYS: `rocks`/`rock_one_in` (rocks remain schematic) AND
  // `tree_one_in`, which the procedural pick reads as its per-biome DENSITY gate (resolve_placement_at →
  // base.tree_one_in) — so tree_one_in is LIVE data, not dead schematic tuning. `?proctrees=0` (procedural
  // OFF) grows NO trees here (the stamps are gone) — a rock-only perf A/B, not a legacy-tree world.
  beach: {
    trees: [], // RETIRED → procedural palms (tree_species.beach); tree_one_in = proc density gate
    rocks: [],
    tree_one_in: 26,
    // rock_one_in > 0 so a config `structure_pool_overrides:{beach:['pool_coral']}` (Paradise) grows the
    // submerged coral reef on the lagoon shelf. Parity-safe: DEFAULT beach.rocks is EMPTY ⇒ no placement.
    rock_one_in: 18,
  },
  // Temperate grass — oak + birch, moderate density; grassland is drier so it also gets acacia.
  grassland: {
    trees: [], // RETIRED → procedural (tree_species.grassland)
    rocks: ['GRASSLAND_ROCK_BIG', 'TEMPERATE_ROCK'],
    tree_one_in: 22,
    rock_one_in: 14,
  },
  temperate_forest: {
    trees: [], // RETIRED → procedural (tree_species.temperate_forest)
    rocks: ['TEMPERATE_ROCK'],
    tree_one_in: 7, // dense — this is a forest
    rock_one_in: 20,
  },
  dense_forest: {
    trees: [], // RETIRED → procedural (tree_species.dense_forest)
    rocks: ['TEMPERATE_ROCK'],
    tree_one_in: 4, // densest temperate forest (DENSE vegetation)
    rock_one_in: 26,
  },
  // Cold conifer belts — taiga giants (chêne + sapin), sparse boulders.
  taiga: {
    trees: [], // RETIRED → procedural (tree_species.taiga: pine_cathedral)
    rocks: ['TAIGA_ROCK', 'TEMPERATE_ROCK'],
    tree_one_in: 9, // giants are huge — a smaller denominator would wall the map with megatrees
    rock_one_in: 16,
  },
  // Humid lowland swamp — the big swamp tree, no rocks (boggy).
  swamp: {
    trees: [], // RETIRED → procedural (tree_species.swamp: swamp_buttress)
    rocks: [],
    tree_one_in: 16, // 37-42 wide canopies — sparse or they overlap into a solid roof
    rock_one_in: 0,
  },
  // Hot-humid tropical — dense tropical canopy + occasional tropical boulder.
  tropical: {
    trees: [], // RETIRED → procedural (tree_species.tropical: jungle_giant)
    rocks: ['TROPICAL_BIG_ROCK'],
    tree_one_in: 6, // lush
    rock_one_in: 22,
  },
  // Desert — a single sparse desert tree, occasional big desert rock.
  desert: {
    trees: [], // RETIRED → procedural (tree_species.desert: acacia_umbrella)
    rocks: ['DESERT_BIG_ROCK'],
    tree_one_in: 90, // very sparse (deserts stay sparse)
    rock_one_in: 20,
  },
  scorched_badlands: {
    trees: [],
    rocks: ['SCORCHED_ROCK_LAVA', 'DESERT_BIG_ROCK'],
    tree_one_in: 0,
    rock_one_in: 16,
  },
  // Snow/cold — dead trees, arctic boulders (rock, not tree).
  arctic: {
    trees: [], // RETIRED → procedural (tree_species.arctic: dead_snag)
    rocks: ['ARCTIC_BIG_ROCK'],
    tree_one_in: 40, // sparse snow scrub
    rock_one_in: 18,
  },
  glacier: {
    trees: [],
    rocks: ['ARCTIC_BIG_ROCK'],
    tree_one_in: 0,
    rock_one_in: 22,
  },
}

/**
 * Filters a loaded schematic set to the members whose name starts with ANY of the given prefixes,
 * preserving set order (determinism: the stamper indexes by position, so a stable order matters).
 * @param {ResolvedSchematic[]} set
 * @param {string[]} prefixes
 * @returns {ResolvedSchematic[]}
 */
export function filter_by_prefix(set, prefixes) {
  if (prefixes.length === 0) return []
  return set.filter((s) => prefixes.some((p) => s.name.startsWith(p)))
}

// Per-biome resolved candidate arrays, precomputed once (the prefix filter is pure). Keyed by biome
// name; each biome maps to a { trees, rocks, tree_one_in, rock_one_in } with the sets already sliced
// from TREE_SET / ROCK_SET. Missing prefixes just yield empty arrays (skipped at placement).
/** @type {Map<string, { trees: ResolvedSchematic[], rocks: ResolvedSchematic[], tree_one_in: number, rock_one_in: number }>} */
const BIOME_RESOLVED = new Map()
for (const [name, rule] of Object.entries(BIOME_SCHEMATICS)) {
  BIOME_RESOLVED.set(name, {
    trees: filter_by_prefix(TREE_SET, rule.trees),
    rocks: filter_by_prefix(ROCK_SET, rule.rocks),
    tree_one_in: rule.tree_one_in,
    rock_one_in: rule.rock_one_in,
  })
}

// ── CONFIG-DRIVEN STRUCTURE-POOL OVERRIDES (FIVE-WORLDS §P3 decorator hook) ────────────────────────
// world_gen_config.structure_pool_overrides = { biome_name: pool_id[] } lets a biome LANE add bundle
// pools to a biome's schematic sets CONFIG-ONLY (e.g. everglades swamp→pool_mangrove, paradise→pool_palms)
// without editing BIOME_SCHEMATICS. Pool members are split by category (tree pools → trees, rock pools →
// rocks) and MERGED onto the biome's base sets. Default {} ⇒ no override ⇒ byte-identical DEFAULT world.
// Density for an override-ONLY biome (no BIOME_SCHEMATICS row) falls back to these sane defaults.
const OVERRIDE_TREE_ONE_IN = 12
const OVERRIDE_ROCK_ONE_IN = 16
/** Memo of resolved override sets per config `structure_pool_overrides` object (a pure function of it). */
const _override_cache = new WeakMap()

/**
 * Resolves a config `structure_pool_overrides` map into per-biome {trees, rocks} schematic sets (pool
 * members split by category). Memoized on the overrides object so it resolves once per world. Empty/absent
 * ⇒ empty map (the byte-identical DEFAULT path). Pure.
 * @param {Record<string, string[]> | undefined} overrides
 * @returns {Map<string, { trees: ResolvedSchematic[], rocks: ResolvedSchematic[] }>}
 */
function resolve_overrides(overrides) {
  if (!overrides) return new Map()
  const cached = _override_cache.get(overrides)
  if (cached) return cached
  /** @type {Map<string, { trees: ResolvedSchematic[], rocks: ResolvedSchematic[] }>} */
  const out = new Map()
  for (const [biome_name, pool_ids] of Object.entries(overrides)) {
    /** @type {ResolvedSchematic[]} */
    const trees = []
    /** @type {ResolvedSchematic[]} */
    const rocks = []
    for (const pool_id of pool_ids ?? []) {
      for (const s of load_pool(pool_id)) (s.category === 'rock' ? rocks : trees).push(s)
    }
    out.set(biome_name, { trees, rocks })
  }
  _override_cache.set(overrides, out)
  return out
}

/** The largest halo radius any biome's tree or rock set can reach — the decorate_chunk scan margin. */
const TREE_HALO = max_horizontal_reach(TREE_SET)
const ROCK_HALO = max_horizontal_reach(ROCK_SET)
// Procedural trees (behind ?proctrees) contribute their max crown reach so a synthesized GIANT anchored in a
// neighbor chunk still stamps its in-bounds spill (§3.5.4). reach_cap is the per-species ceiling the A2 budget
// test enforces; giants stay ≤15 < the swamp schematics' ~21, so MAX_HALO (and the scan cost) is UNCHANGED for
// the default bundle — a byte-identical scan margin, yet correct for any config that trims the schematic bundle.
const PROC_TREE_HALO = Math.max(0, ...Object.values(SPECIES).map((s) => s.reach_cap))
const MAX_HALO = Math.max(TREE_HALO, ROCK_HALO, PROC_TREE_HALO)

/**
 * @typedef {object} SchematicPlacement a resolved schematic anchored at a world column
 * @property {number} world_x anchor column x
 * @property {number} world_z anchor column z
 * @property {number} surface_y anchor base world-y
 * @property {ResolvedSchematic} schematic the picked schematic
 * @property {0|1|2|3} rotation quarter-turns
 * @property {import('./schematics/stamper.js').WorldVoxel[]} pedestal GROUNDING talus voxels (world coords)
 * @property {number} pedestal_min_y lowest pedestal y (vertical early-out bound)
 */

/**
 * GROUNDING LAW (schematics always have their lower part buried; rule: MEDIAN + sink + talus).
 * Sits the schematic ONE block below the MEDIAN terrain surface across its base-layer footprint, then
 * PEDESTAL-FILLS the talus under EVERY CONTACT column's lowest voxel that would otherwise float — a rounded
 * rock bottom (only a few columns touch the very lowest layer; the rest curve up within a few blocks) is
 * grounded column-by-column, so a huge rock on a slope sits PROUD with a talus skirt instead of drowning to
 * its lowest point (the min-anchor over-burial). CONTACT window = columns whose lowest voxel is within
 * PEDESTAL_CONTACT of the base layer (the rounded underside); voxels far above that are the schematic's own
 * OVERHANG silhouette, not a base, and keep their air. No size thresholds; flat footprints converge to a
 * 1-block sink with ~no pedestal. Deterministic (median = lower-middle sort).
 * @param {GenContext} ctx @param {number} wx @param {number} wz
 * @param {import('./schematics/loader.js').ResolvedSchematic} schematic @param {0|1|2|3} rotation
 * @param {import('../config/biome_registry.js').BiomeDef} biome anchor biome (pedestal material)
 * @param {number} fallback anchor-column surface when the footprint is empty
 * @param {boolean} use_talus ROCKS: MEDIAN anchor + talus pedestal (sits proud, no drowning). TREES/reef:
 *   MIN anchor, NO pedestal — the base BURIES into the ground (a tree emerging from soil, not perched on a
 *   dirt mound that would smother the meadow flora), and small edge gaps hide under trunk/foliage.
 * @returns {{ surface_y: number, pedestal: import('./schematics/stamper.js').WorldVoxel[], pedestal_min_y: number }}
 */
function grounded_placement(ctx, wx, wz, schematic, rotation, biome, fallback, use_talus) {
  // Per-column lowest voxel dy (the schematic's underside contact profile) + its terrain surface.
  /** @type {Map<number, { rdx: number, rdz: number, bottom_dy: number, surf: number }>} */
  const cols = new Map()
  let base_dy = Infinity
  const rot = rotation & 3
  // for_each_voxel: carrier-agnostic (bundle object voxels OR a synthesized tree's compact arrays).
  for_each_voxel(schematic, (dx, dy, dz) => {
    const rdx = rot === 0 ? dx : rot === 1 ? -dz : rot === 2 ? -dx : dz
    const rdz = rot === 0 ? dz : rot === 1 ? dx : rot === 2 ? -dz : -dx
    const key = (rdx + 512) * 1024 + (rdz + 512)
    const c = cols.get(key)
    if (c === undefined) cols.set(key, { rdx, rdz, bottom_dy: dy, surf: 0 })
    else if (dy < c.bottom_dy) c.bottom_dy = dy
    if (dy < base_dy) base_dy = dy
  })
  if (cols.size === 0) return { surface_y: fallback, pedestal: [], pedestal_min_y: fallback }
  const base_surfs = []
  for (const c of cols.values()) {
    c.surf = anchor_surface(ctx, wx + c.rdx, wz + c.rdz).surface_y
    if (c.bottom_dy === base_dy) base_surfs.push(c.surf)
  }
  base_surfs.sort((a, b) => a - b)
  // ROCKS: MEDIAN − 1 (proud, talus fills the low side). TREES: MIN (base buries, no mound).
  const base_plane = (use_talus ? base_surfs[(base_surfs.length - 1) >> 1] : base_surfs[0]) - 1
  const surface_y = base_plane - base_dy // base-layer voxels (dy = base_dy) land at base_plane
  const ped_block = resolve_land_block_ids(biome).subsurface
  /** @type {import('./schematics/stamper.js').WorldVoxel[]} */
  const pedestal = []
  let pedestal_min_y = base_plane
  // TALUS pedestal (rocks only): fill each CONTACT column from its terrain up to under its lowest voxel.
  if (use_talus && ped_block !== undefined) {
    for (const c of cols.values()) {
      if (c.bottom_dy > base_dy + PEDESTAL_CONTACT) continue // OVERHANG silhouette, not a base — keep its air
      const bottom_y = surface_y + c.bottom_dy
      for (let y = c.surf; y < bottom_y; y += 1) {
        pedestal.push({ wx: wx + c.rdx, wy: y, wz: wz + c.rdz, block_id: ped_block, solid: true, mode: 'air_only' })
        if (y < pedestal_min_y) pedestal_min_y = y
      }
    }
  }
  return { surface_y, pedestal, pedestal_min_y }
}

// ── PROCEDURAL TREES (ENGINE_AAA_PLAN §3.5) — flag-gated species pick + synthesis memo ─────────────
// Behind config.trees.procedural (the ?proctrees=1 demo A/B) the tree PICK becomes a synthesized species
// skeleton instead of a legacy schematic; everything downstream (grounding, halo, stamp, occupancy, union)
// is REUSED unchanged (§3.1). Off ⇒ these are never called ⇒ byte-identical DEFAULT world.
// 512 kept after the P0 balloon fix (2026-07-11): entries are now the COMPACT typed-array form (~19 KB
// vs ~192 KB object-voxel trees), so a full memo retains ~10 MB/realm instead of ~100 MB — shrinking the
// cap would only re-buy the halo re-synthesis churn the memo exists to kill (a 64-entry A/B thrashed:
// +28% column time from cross-column re-synthesis).
const TREE_MEMO_CAP = 512
/** LRU memo of synthesized trees (§3.5.3): the per-column placement cache already reuses across the 12 cy
 *  chunks; this kills re-synthesis when a NEIGHBOR chunk's halo re-resolves the same anchor. Pure — eviction
 *  never changes output (generate_tree is a pure fn of the key). Key "wx,wz,seed,species". @type {Map<string, ResolvedSchematic>} */
const _tree_memo = new Map()

/** Synthesized tree for an anchor column + species. baked_variants>0 ⇒ an O(1) pick from the bake module's
 *  N-per-species set (tree_bake.js); else the LRU-memoized (≤TREE_MEMO_CAP) live per-column generate_tree.
 *  @param {number} seed @param {number} world_x @param {number} world_z @param {string} species
 *  @param {number} baked_variants trees.baked_variants (0 ⇒ live per-column gen) @returns {ResolvedSchematic} */
function get_tree(seed, world_x, world_z, species, baked_variants) {
  // BAKE-THEN-STAMP (trees.baked_variants>0): an O(1) hash-pick from N pre-baked variants — no per-column
  // branch/canopy math (the measured load cost). The bake module owns its own N-per-species cache,
  // so the per-column LRU memo below is bypassed (it would only cache an already-O(1) pick). baked_variants
  // <=0 ⇒ the live per-column generate_tree path below, byte-identical to the pre-bake world.
  if (baked_variants > 0) return pick_baked_tree(seed, world_x, world_z, species, baked_variants)
  const key = `${world_x},${world_z},${seed},${species}`
  const hit = _tree_memo.get(key)
  if (hit !== undefined) {
    _tree_memo.delete(key)
    _tree_memo.set(key, hit) // LRU bump: re-insert as most-recent
    return hit
  }
  const schematic = generate_tree(seed, world_x, world_z, species)
  _tree_memo.set(key, schematic)
  if (_tree_memo.size > TREE_MEMO_CAP) _tree_memo.delete(/** @type {string} */ (_tree_memo.keys().next().value))
  return schematic
}

/** Weighted procedural-species pick for a biome from the world's `tree_species` roster — a pure per-column
 *  hash over the cumulative-weight ladder. null when the biome has no roster (fall through to schematics).
 *  @param {GenContext} ctx @param {string} biome_name @param {number} world_x @param {number} world_z
 *  @param {number} seed @returns {string | null} */
function select_tree_species(ctx, biome_name, world_x, world_z, seed) {
  const roster = ctx.config?.tree_species?.[biome_name]
  if (!roster || roster.length === 0) return null
  let total = 0
  for (const e of roster) total += e.weight
  if (total <= 0) return null
  let r = hash_column(world_x, world_z, (seed ^ SALT_TREE_SPECIES) >>> 0) % total
  for (const e of roster) {
    if (r < e.weight) return e.species
    r -= e.weight
  }
  return roster[roster.length - 1].species
}

/**
 * Resolves the schematic (tree, then rock) an anchor column grows, if any — a PURE decision from
 * (seed, world_x, world_z) with NO chunk dependency, so it's identical for every cy chunk of the
 * column (that's what makes caching it safe). Cheap gates (grove hashes) run first; only a grove
 * winner pays the anchor_surface probe (biome + surface, the single source of truth shared by every
 * chunk the schematic touches). Anchors are gated by the biome MAPPING, not the surface block, so a
 * canopy spilling over a beach/river still originates from its forest anchor. Returns null for a
 * column that grows nothing.
 * @param {GenContext} ctx generation context (for the on-the-fly anchor surface/biome probe)
 * @param {number} world_x anchor column x
 * @param {number} world_z anchor column z
 * @param {number} seed world seed
 * @returns {SchematicPlacement | null}
 */
// [B3] EXPORTED (additive — B1's logic UNCHANGED) so the far-tree impostor derivation (render/
// far_trees_gen.js) and the seam-agreement test can call the SAME pure placement fn the near ring uses,
// which is the §3.6 contract ("resolve_placement_at is a PURE function of (seed, wx, wz) — the far shell
// re-derives every tree without chunks"). No caller relies on it staying private.
// tree_cleared_at + SALT_SPAWN_CLEAR MOVED to deco_shared.js (SEAM LAW, 2026-07-13 far_trees_gen
// regression): the far impostor mirror must consume the SAME clearing gate — a private copy here is
// exactly how the ring seam broke (far rendered glade trees the near ring refused to grow).

export function resolve_placement_at(ctx, world_x, world_z, seed) {
  const deco = resolve_deco(ctx.config?.decoration)
  // SPAWN CLEARING: suppress trees near the world spawn anchor so the initial spawn region is always walkable
  // (universal via DECO_DEFAULTS; the verdant_hollow tree-wall repro). Computed once, ANDed into both tree
  // branches below. Rocks/flora unaffected. spawn_clear_radius 0 ⇒ false always ⇒ byte-identical opt-out.
  const trees_cleared = tree_cleared_at(deco, world_x, world_z, seed)
  // NATURE-PLACEMENT GRAMMAR (everest pattern-setter): when on, the CLUSTER field + slope + treeline
  // gates below REPLACE the coarse grove cells, so the grove pre-gate collapses to a schematics-loaded
  // check and every column proceeds to the ecological gates (`probe` = the surface-y source for slope).
  // Off (default + every non-everest world) ⇒ the legacy grove path runs verbatim ⇒ byte-identical parity.
  const grammar = resolve_grammar(ctx.config?.decoration)
  const probe = grammar
    ? (/** @type {number} */ px, /** @type {number} */ pz) => anchor_surface(ctx, px, pz).surface_y
    : null
  const tree_grove = grammar
    ? TREES_ENABLED
    : TREES_ENABLED &&
      in_grove(world_x, world_z, (seed ^ SALT_TREE_GROVE) >>> 0, deco.tree_grove_one_in, deco.grove_cell_shift)
  const rock_grove = grammar
    ? ROCKS_ENABLED
    : ROCKS_ENABLED &&
      in_grove(world_x, world_z, (seed ^ SALT_ROCK_GROVE) >>> 0, deco.rock_grove_one_in, deco.grove_cell_shift)
  if (!tree_grove && !rock_grove) return null

  const surf = anchor_surface(ctx, world_x, world_z)
  // WATER-ANCHOR (FIVE-WORLDS Everglades): land vegetation skips the waterline, but a WATER-ANCHOR
  // schematic (mangrove pool) may root in a flooded column — its base sits on the seabed, roots go
  // underwater, canopy rises above. The waterline gate therefore moves to the per-PICK check below
  // (byte-identical DEFAULT: no bundle schematic is water_anchor, so an underwater pick is still rejected).
  const underwater = surf.surface_y <= (ctx.config?.hydrology?.sea_level ?? SEA_LEVEL) // per-world waterline
  // WATER-ANCHOR needs water ACTUALLY present above the seabed (rejects coral/roots on drained shelf
  // sand that sits below sea level but unflooded). `underwater` (column-vs-sea) still gates LAND veg for
  // parity; water_anchor picks additionally require this. DEFAULT has no water_anchor schematics ⇒ no effect.
  const water_present = surf.water_level > surf.surface_y
  // FIVE-WORLDS TREELINE (Everest): no TREES above the config treeline — but COLD/MINERAL decor (rocks,
  // boulders, ice features via the ROCK branch) STILL lands, so open snowfields read with lonely alpine
  // accents instead of barren (fixes Everest v2's empty read). Default = world_height ⇒ never
  // fires (byte-identical DEFAULT: above_treeline is always false, so both branches are unchanged).
  const treeline = ctx.config?.surface?.treeline
  const above_treeline = treeline !== undefined && surf.surface_y > treeline
  const biome = get_biome_by_id(surf.biome_id)
  if (biome === undefined) return null
  const base = BIOME_RESOLVED.get(biome.name)
  // CONFIG-DRIVEN OVERRIDES: merge any structure_pool_overrides pools onto the biome's base sets. Default
  // {} ⇒ ov empty for every biome ⇒ effective sets == base ⇒ byte-identical DEFAULT (the memo returns an
  // empty Map, so this is one Map.get on the hot path).
  const overrides = ctx.config?.structure_pool_overrides
  const ov = overrides ? resolve_overrides(overrides).get(biome.name) : undefined
  if (base === undefined && ov === undefined) return null
  const trees = base
    ? ov
      ? base.trees.concat(ov.trees)
      : base.trees
    : /** @type {ResolvedSchematic[]} */ (ov?.trees ?? [])
  const rocks = base
    ? ov
      ? base.rocks.concat(ov.rocks)
      : base.rocks
    : /** @type {ResolvedSchematic[]} */ (ov?.rocks ?? [])
  const tree_one_in = base ? base.tree_one_in : OVERRIDE_TREE_ONE_IN
  const rock_one_in = base ? base.rock_one_in : OVERRIDE_ROCK_ONE_IN

  // PROCEDURAL TREES (§3.5) — config/flag-gated detour at the SAME grove + density gate as the schematic
  // branch below. Flag OFF ⇒ ctx.config.trees.procedural is falsy ⇒ this whole block is skipped and the code
  // below runs VERBATIM ⇒ byte-identical DEFAULT world (the decorated goldens are the law). Land-only
  // (!underwater): no procedural species is water-anchored. A biome without a roster falls through to schematics.
  if (
    !trees_cleared &&
    ctx.config?.trees?.procedural &&
    tree_grove &&
    !above_treeline &&
    !underwater &&
    tree_one_in > 0 &&
    (grammar
      ? grammar_tree_at(
          grammar,
          /** @type {any} */ (probe),
          world_x,
          world_z,
          seed,
          surf.surface_y,
          treeline,
          grammar_biome_density(grammar, biome.name)
        )
      : hash_column(world_x, world_z, (seed ^ SALT_TREE) >>> 0) % tree_one_in === 0)
  ) {
    let species = select_tree_species(ctx, biome.name, world_x, world_z, seed)
    // HERO channel: a rare column forces the landmark species over the weighted pick. The far impostor
    // mirror applies the SAME override, so species×age (⇒ atlas layer) still agrees at the ring seam.
    if (grammar && species !== null) {
      const hero = grammar_hero_species(grammar, world_x, world_z, seed)
      if (hero && hero in SPECIES) species = hero
    }
    if (species !== null) {
      const baked = ctx.config?.trees?.baked_variants ?? 0
      const schematic = get_tree(seed, world_x, world_z, species, baked) // synthesized (baked pick or live gen)
      // Baked trees get a hash-picked quarter-turn (the free 4× variety lever — 32 variants read as ~128);
      // the live per-column path stays rotation 0, byte-identical to the pre-bake world (`?baketrees=0` A/B).
      const rotation = /** @type {0|1|2|3} */ (
        baked > 0 ? hash_column(world_x, world_z, (seed ^ SALT_TREE_ROT) >>> 0) & 3 : 0
      )
      const g = grounded_placement(ctx, world_x, world_z, schematic, rotation, biome, surf.surface_y, false) // tree: min-anchor, no talus
      return {
        world_x,
        world_z,
        surface_y: g.surface_y,
        schematic,
        rotation,
        pedestal: g.pedestal,
        pedestal_min_y: g.pedestal_min_y,
      }
    }
  }

  // Tree first (priority), then rock — one structure per column. Eligibility = a non-empty trees list;
  // sparsity = per-biome tree_one_in (no separate density floor).
  if (
    !trees_cleared &&
    tree_grove &&
    !above_treeline && // trees stop at the treeline; the rock branch below still fires above it
    trees.length > 0 &&
    tree_one_in > 0 &&
    (grammar
      ? grammar_tree_at(
          grammar,
          /** @type {any} */ (probe),
          world_x,
          world_z,
          seed,
          surf.surface_y,
          treeline,
          grammar_biome_density(grammar, biome.name)
        )
      : hash_column(world_x, world_z, (seed ^ SALT_TREE) >>> 0) % tree_one_in === 0)
  ) {
    const pick = select_schematic(seed, world_x, world_z, trees)
    // Land trees skip the waterline; a WATER-ANCHOR tree (mangrove) roots only where water is truly present.
    if (pick && (!underwater || (pick.schematic.water_anchor && water_present))) {
      const g = grounded_placement(ctx, world_x, world_z, pick.schematic, pick.rotation, biome, surf.surface_y, false) // tree: min-anchor, no talus
      return {
        world_x,
        world_z,
        surface_y: g.surface_y,
        schematic: pick.schematic,
        rotation: pick.rotation,
        pedestal: g.pedestal,
        pedestal_min_y: g.pedestal_min_y,
      }
    }
  }
  if (
    rock_grove &&
    rocks.length > 0 &&
    rock_one_in > 0 &&
    (grammar
      ? grammar_rock_at(grammar, /** @type {any} */ (probe), world_x, world_z, seed, rock_one_in)
      : hash_column(world_x, world_z, (seed ^ SALT_ROCK) >>> 0) % rock_one_in === 0)
  ) {
    const pick = select_schematic(seed, world_x, world_z, rocks)
    // Land rocks (boulders) root on DRY ground; a WATER-ANCHOR rock (Paradise coral reef) roots ONLY where
    // real water is present above the column (water_present) — the honest test that kills dry-shelf cubes.
    // Byte-identical DEFAULT: no bundle rock is water_anchor + no DEFAULT biome maps coral, so this is `!underwater`.
    if (pick && (pick.schematic.water_anchor ? water_present : !underwater)) {
      // ROCKS get the median-anchor + talus pedestal — UNLESS water-anchored (coral reef), which grounds on
      // the seabed like a tree (min-anchor, no talus mound under water).
      const g = grounded_placement(
        ctx,
        world_x,
        world_z,
        pick.schematic,
        pick.rotation,
        biome,
        surf.surface_y,
        !pick.schematic.water_anchor
      )
      return {
        world_x,
        world_z,
        surface_y: g.surface_y,
        schematic: pick.schematic,
        rotation: pick.rotation,
        pedestal: g.pedestal,
        pedestal_min_y: g.pedestal_min_y,
      }
    }
  }
  return null
}

// Size-1 per-column placement cache. world_gen iterates (cx,cz) OUTER and cy INNER, so all 12 stacked
// chunks of a column decorate against the SAME haloed anchor set — resolve it ONCE per (cx,cz,seed)
// instead of re-scanning the (32+2R)² halo 12×. The scan is a pure, deterministic function of its key
// (region-local, no stored neighbor reads); the cached list is READ-ONLY and each cy stamps only the
// voxels that clip into its own y-slice. Trivial to delete; a different key simply rescans.
let _placements_key = ''
/** @type {SchematicPlacement[]} */
let _placements = []

/**
 * The schematic placements whose anchor lies in the haloed footprint of chunk column (cx,cz): every
 * column in [cx*32 − R .. cx*32+31 + R]² where R = max_horizontal_reach across the loaded sets, so a
 * schematic anchored in a NEIGHBOR chunk still contributes its in-bounds spill here. Memoized per
 * (cx,cz,seed) — the heavy step (grove scan + anchor probes) runs once per column, not once per cy.
 * @param {GenContext} ctx
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @param {number} seed world seed
 * @returns {SchematicPlacement[]}
 */
function column_placements(ctx, cx, cz, seed) {
  // Key includes the procedural-tree flag AND the baked-variant count: each toggles WHICH structures a
  // column grows, so proc-on/off and baked/live must never share a cache slot (a fixed world keeps one
  // value ⇒ same key ⇒ byte-identical hit; a config A/B in one realm — tests, ?baketrees — must rescan).
  const key = `${cx},${cz},${seed},${ctx.config?.trees?.procedural ? 1 : 0},${ctx.config?.trees?.baked_variants ?? 0}`
  if (key === _placements_key) return _placements
  /** @type {SchematicPlacement[]} */
  const out = []
  const x0 = cx * CHUNK_SIZE - MAX_HALO
  const x1 = cx * CHUNK_SIZE + CHUNK_SIZE - 1 + MAX_HALO
  const z0 = cz * CHUNK_SIZE - MAX_HALO
  const z1 = cz * CHUNK_SIZE + CHUNK_SIZE - 1 + MAX_HALO
  for (let wz = z0; wz <= z1; wz += 1) {
    for (let wx = x0; wx <= x1; wx += 1) {
      const p = resolve_placement_at(ctx, wx, wz, seed)
      if (p) out.push(p)
    }
  }
  _placements_key = key
  _placements = out
  return out
}

/**
 * Applies surface decoration to one filled chunk record: schematic trees + rocks (with cross-chunk
 * halo) plus cross-foliage flowers/tufts. Deterministic, feature-detected, chunk-bounds-clipped (the
 * stamper clips). Chunks entirely below sea level are skipped. Mutates `chunk` in place.
 *
 * HALO: the schematic anchors come from column_placements(cx,cz) — every anchor in the (32+2R)²
 * haloed footprint (R = max_horizontal_reach across the sets), resolved ONCE per column and cached
 * across the 12 cy chunks. Each cy stamps only the voxels the stamper clips into its own bounds, so a
 * schematic anchored in a neighbor chunk still materializes its in-bounds spill here. In-chunk clutter
 * (flowers/tufts) is scanned over the own 32×32 (it never spills).
 * @param {ChunkRecord} chunk
 * @param {ColumnProfile} profile the (cx,cz) column profile (in-chunk clutter surface + land-cover gate)
 * @param {number} cx chunk x
 * @param {number} cy chunk y
 * @param {number} cz chunk z
 * @param {number} [seed] world seed (folded into every placement hash; default 0)
 * @param {GenContext} [ctx] generation context — REQUIRED for schematic placement (halo anchor probe);
 *   when omitted, only cross-foliage clutter is placed (schematics need on-the-fly anchor surfaces)
 * @returns {void}
 */
export function decorate_chunk(chunk, profile, cx, cy, cz, seed = 0, ctx) {
  const base_world_y = cy * CHUNK_SIZE
  // Per-world waterline (Everest drops it below its y≈10 valley floors so the massif is DRY land, not a
  // no-clutter ocean). Defaults to the SEA_LEVEL const ⇒ byte-identical for every world that keeps 128.
  const sea_level = ctx?.config?.hydrology?.sea_level ?? SEA_LEVEL

  // ---- Schematic trees + rocks + WATER-ANCHOR structures with cross-chunk halo -----------------
  // Anchors resolved ONCE per column (cached across the 12 cy chunks); each cy stamps only the voxels
  // that clip into its own y-slice. A cheap per-placement vertical early-out skips a schematic whose
  // span [base, base + height] can't intersect this chunk's y-range. Runs even for fully-UNDERWATER
  // chunks so water-anchor structures (mangrove roots, coral reef) stamp their submerged voxels — land
  // placements (surface_y > sea) are early-outed there, so a DEFAULT underwater chunk still writes nothing.
  if ((TREES_ENABLED || ROCKS_ENABLED) && ctx !== undefined) {
    const placements = column_placements(/** @type {GenContext} */ (ctx), cx, cz, seed)
    for (const p of placements) {
      // Skip a placement whose FULL vertical span (pedestal talus foot .. schematic top) misses this chunk.
      const span_bottom = p.pedestal.length > 0 ? p.pedestal_min_y : p.surface_y
      if (p.surface_y + p.schematic.size[1] < base_world_y || span_bottom > base_world_y + CHUNK_SIZE - 1) continue
      stamp_into_chunk(chunk, cx, cy, cz, p.world_x, p.world_z, p.surface_y, p.schematic, p.rotation)
      // GROUNDING pedestal — fill the talus under below-base footprint columns (clipped per chunk, air-only).
      for (let i = 0; i < p.pedestal.length; i += 1) place_world_voxel(chunk, cx, cy, cz, p.pedestal[i])
    }
  }

  // ---- SUBMERGED CORAL (FIVE-WORLDS Paradise reef) — cross-flora fans on the lagoon SAND floor. Runs for
  // UNDERWATER chunks (placed before the land-clutter guard). OPT-IN: only when config.decoration.sprites
  // .coral === true (default/absent ⇒ no coral ⇒ byte-identical DEFAULT world). The oracle is the
  // AUTHORITATIVE per-column water_level — "is a water block actually present above the seabed cell" — NOT
  // the global sea level, so a drained shelf (sand below sea but unflooded) grows nothing (the drained-shelf fix).
  const cdeco = resolve_deco(ctx?.config?.decoration)
  if (CORALS.length > 0 && cdeco.sprites?.coral && ctx !== undefined) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const world_z = cz * CHUNK_SIZE + lz
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const ci = column_index(lx, lz)
        const surface_y = profile.surface_y[ci]
        // Water must actually COVER the reef cell (surface_y+1): a real submerged column, not a dry shelf.
        if (profile.water_level[ci] <= surface_y + 1) continue
        if (profile.strata[ci * 4] !== SAND) continue // reef roots on the sand seabed only
        const ly = surface_y + 1 - base_world_y // the fan sits one block above the seabed, in the water
        if (ly < 0 || ly >= CHUNK_SIZE) continue
        const world_x = cx * CHUNK_SIZE + lx
        // Clustered reef patches (grove) with a within-patch thinning — bare sand between reef clumps.
        if (!in_grove(world_x, world_z, (seed ^ SALT_CORAL) >>> 0, 3, cdeco.grove_cell_shift)) continue
        const h = hash_column(world_x, world_z, (seed ^ (SALT_CORAL + 1)) >>> 0)
        if (h % 2 !== 0) continue
        const li = local_index(lx, ly, lz)
        if (chunk.ids[li] !== WATER && chunk.ids[li] !== AIR) continue // don't overwrite solid
        chunk.ids[li] = CORALS[h % CORALS.length] // pink / purple / teal fan (foliage, no occupancy)
      }
    }
  }

  // Cross-foliage is LAND clutter — skip a chunk that sits entirely at/below sea level (parity: the old
  // top-of-function guard, moved down so the schematic loop above still runs for water-anchor structures).
  if (base_world_y + CHUNK_SIZE <= sea_level) return

  // ---- Cross-foliage OCEAN (tall grass / reeds / flowers / fern) over the own 32×32 only ---------
  // surface_flora picks ONE plant per column (region-local, deterministic). The grass gate moved INTO
  // the helper because reeds also grow on SAND/DIRT river-and-lake margins, so this loop can only skip
  // genuinely underwater columns and columns whose surface isn't in this chunk's y-slice.
  // Config-driven densities (default recipe == the live values ⇒ byte-identical DEFAULT world).
  const deco = resolve_deco(ctx?.config?.decoration)
  for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
    const world_z = cz * CHUNK_SIZE + lz
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      const ci = column_index(lx, lz)
      const surface_y = profile.surface_y[ci]
      if (surface_y <= sea_level) continue // underwater — no land clutter

      const ly = surface_y - base_world_y
      if (ly < 0 || ly >= CHUNK_SIZE) continue // the surface block itself is not in this chunk's y-slice

      const flora = surface_flora(
        profile.strata[ci * 4],
        get_biome_by_id(profile.biome_id[ci]),
        surface_y <= sea_level + deco.shore_band,
        cx * CHUNK_SIZE + lx,
        world_z,
        seed,
        surface_y,
        deco
      )
      if (flora !== 0) place_foliage(chunk, lx, ly, lz, flora)
    }
  }
}

/**
 * Writes one CROSS-foliage voxel (tuft/flower) into the chunk if in-bounds and the cell is air — no
 * occupancy (the mesher's cross pass reads these from `ids`). A leaf/rock never routes here; those
 * go through the stamper which sets occupancy.
 * @param {ChunkRecord} chunk
 * @param {number} lx @param {number} ly @param {number} lz
 * @param {number} block_id
 * @returns {void}
 */
function place_foliage(chunk, lx, ly, lz, block_id) {
  if (lx < 0 || ly < 0 || lz < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE || lz >= CHUNK_SIZE) return
  const li = local_index(lx, ly, lz)
  if (chunk.ids[li] !== AIR) return
  chunk.ids[li] = block_id
}

/**
 * Which decoration features resolved at load (for the world_gen boot log / brief report). `false`
 * entries are skipped silently. Schematic counts prove the bundle loaded; the cross-flora flags prove
 * the DIVERGENCE WAVE ocean blocks baked.
 * @returns {{ tuft: boolean, tall_grass: boolean, reed: boolean, fern: boolean, meadow_flowers: number,
 *   trees_enabled: boolean, rocks_enabled: boolean, flowers_enabled: boolean, tree_species: number,
 *   rock_species: number, tree_halo: number, rock_halo: number }}
 */
export function decoration_availability() {
  return {
    ...flora_availability(), // tuft / tall_grass / reed / fern / meadow_flowers / flowers_enabled
    trees_enabled: TREES_ENABLED,
    rocks_enabled: ROCKS_ENABLED,
    tree_species: TREE_SET.length,
    rock_species: ROCK_SET.length,
    tree_halo: TREE_HALO,
    rock_halo: ROCK_HALO,
  }
}
