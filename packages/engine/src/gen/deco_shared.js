// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared decoration config + column-hash helpers used by BOTH the schematic placer (surface_decorator.js)
// AND the cross-flora placer (surface_flora.js). Extracted VERBATIM from surface_decorator.js to (a) break
// the import cycle — decorate_chunk imports surface_flora, and surface_flora needs these helpers — and (b)
// keep each file one-concern under the LoC law. Pure integer hashing (§3.7): the placement streams stay
// byte-identical across the split. `>>` in callers is arithmetic (floors negatives) so cells tile at the origin.

const U32_MASK = 0xffffffff

// ── DECORATOR DENSITIES — CONFIG-DRIVEN (FIVE-WORLDS adoption). DECO_DEFAULTS holds the LIVE values 1:1;
// resolve_deco(config.decoration) merges a world's overrides on top (default recipe == these ⇒ byte-identical
// DEFAULT world). Grove clustering tiles the world into 1<<grove_cell_shift cells; ~1/tree_grove_one_in are
// tree groves (dense forests), rocks use a sparser field. The cross-flora densities size the grass OCEAN.
export const DECO_DEFAULTS = {
  grove_cell_shift: 4, // grove cell side = 1 << 4 = 16 blocks
  tree_grove_one_in: 3, // ~1/3 cells are tree groves
  rock_grove_one_in: 6, // rocks sparser than trees
  forest_tree_density: 0.15, // biome tree_density at/above which a grass floor is FOREST (fern), not meadow
  tall_cluster_one_in: 5, // 1/5 grove cells are tall-grass accent patches
  tall_in_cluster_one_in: 1, // inside a tall cluster, every column → tall_grass
  fern_one_in: 1, // forest floor: dense fern carpet on every non-path column
  forest_tuft_one_in: 3, // forest floor: short carpet grass mixed into the fern
  path_one_in: 5, // forest: 1/5 grove cells are barer walking lanes
  flower_patch_one_in: 6, // 1/6 grove cells are meadow flower patches
  flower_in_patch_one_in: 3, // within a flower patch, ~1/3 of columns bloom
  reed_one_in: 2, // shore band: ~1/2 of water-margin columns grow a reed
  shore_band: 2, // SEA_LEVEL < surface_y ≤ SEA_LEVEL+shore_band ⇒ a water margin ("shore")
  reed_min_grass: 0.15, // biome grass_density floor for reeds (excludes desert/beach/arctic dune margins)
  // SPAWN CLEARING — every world's INITIAL spawn region must be walkable — never
  // water-locked, never tree density so high the shore reads as one solid block (the verdant_hollow repro).
  // A UNIVERSAL mechanism (in the defaults ⇒ every world) — trees are SUPPRESSED near the world spawn anchor
  // (origin, WORLD_SPAWN≈[0,0]): a hard-clear core of `spawn_clear_radius` blocks + a `spawn_clear_falloff`
  // ramp back to full forest, so a player can always walk out of spawn in every direction. Deterministic
  // (radial d² ramp + one hash, §3.7). Rocks/flora untouched (trees are the wall). 0 ⇒ off (opt-out).
  spawn_clear_radius: 18, // blocks: within this of origin, ZERO trees — a guaranteed walkable glade
  spawn_clear_falloff: 16, // blocks: trees ramp from 0 (core edge) back to full density over this band
  // VIVID-WORLD sprite densities (sprite-vivid roster). These fire ONLY when the world opts a kind in via
  // decoration.sprites.<kind>:true (absent ⇒ OFF ⇒ byte-identical DEFAULT), so tuning them is inert until then.
  dune_grass_one_in: 4,
  seashell_one_in: 40,
  starfish_one_in: 70,
  driftwood_one_in: 55, // beach sand
  jungle_plant_one_in: 8,
  orchid_one_in: 24,
  young_shoot_one_in: 10, // tropical
  swamp_weed_one_in: 6,
  moss_tuft_one_in: 4,
  cattail_one_in: 6, // swamp
  frozen_shrub_one_in: 18,
  alpine_flower_one_in: 20,
  lichen_one_in: 6, // cold
  bush_one_in: 14,
  dead_branch_one_in: 30,
  pebbles_one_in: 40,
  toadstool_one_in: 18, // temperate/universal
  thistle_one_in: 12,
  lavender_one_in: 10,
  garrigue_one_in: 14, // mediterranean
}

/** @typedef {typeof DECO_DEFAULTS & {sprites?: Partial<Record<string, boolean>>}} ResolvedDecoration */
/** Memo of the resolved decoration densities per config object (pure fn of it). @type {WeakMap<object, ResolvedDecoration>} */
const _deco_cache = new WeakMap()
/**
 * Resolves a world's `decoration` config into the full density set (config values over DECO_DEFAULTS).
 * Absent/undefined ⇒ DECO_DEFAULTS (the byte-identical DEFAULT path). Memoized per config object.
 * @param {any} [cfg] the world's `decoration` config (DecorationConfig — read for its numeric density keys)
 * @returns {ResolvedDecoration}
 */
export function resolve_deco(cfg) {
  if (!cfg) return DECO_DEFAULTS
  const cached = _deco_cache.get(cfg)
  if (cached) return cached
  const r = /** @type {any} */ ({ ...DECO_DEFAULTS })
  for (const k of /** @type {(keyof typeof DECO_DEFAULTS)[]} */ (Object.keys(DECO_DEFAULTS)))
    if (typeof cfg[k] === 'number') r[k] = cfg[k]
  // FIVE-WORLDS SPRITE SELECTION: a per-world {kind: false} map disabling clutter sprite KINDS (tuft /
  // tall_grass / fern / flower / reed) so e.g. Paradise drops temperate tall grass, Everest sparse-tufts.
  // Absent ⇒ all kinds fire (byte-identical DEFAULT). Carried through to surface_flora's sprite_on gate.
  r.sprites = cfg.sprites
  _deco_cache.set(cfg, r)
  return r
}

/** Whether a clutter-sprite KIND is enabled for this world (absent sprites map ⇒ all on ⇒ parity).
 * @param {any} deco @param {string} kind @returns {boolean} */
export function sprite_on(deco, kind) {
  return !deco.sprites || deco.sprites[kind] !== false
}

/**
 * Deterministic integer hash of a world column + a decision salt → u32. Pure multiply/xor/shift on
 * 32-bit unsigned ints — SAME lineage as the stamper's hash_column and the first-cut decorator, so
 * placement streams stay byte-identical (§3.7). `>>` in callers is arithmetic.
 * @param {number} x world block x @param {number} z world block z
 * @param {number} salt per-decision constant (fold the world seed in here) @returns {number} unsigned 32-bit hash
 */
export function hash_column(x, z, salt) {
  let h = (x * 374761393 + z * 668265263 + salt * 2246822519) & U32_MASK
  h = (h ^ (h >>> 13)) & U32_MASK
  h = (h * 1274126177) & U32_MASK
  h = (h ^ (h >>> 16)) & U32_MASK
  return h >>> 0
}

/**
 * Whether a world column lies inside a grove of `one_in`-sparsity for a given salt — the coarse clumping
 * gate. Same cell ⇒ same verdict for every column and chunk touching it: deterministic clumps.
 * @param {number} world_x @param {number} world_z @param {number} salt grove-field salt (folded with seed)
 * @param {number} one_in inverse density (larger = sparser) @param {number} [cell_shift] log2 grove-cell side
 * @returns {boolean}
 */
export function in_grove(world_x, world_z, salt, one_in, cell_shift = DECO_DEFAULTS.grove_cell_shift) {
  return hash_column(world_x >> cell_shift, world_z >> cell_shift, salt) % one_in === 0
}

/** Spawn-clearing ramp roll salt (decorrelated from every other placement salt). Lives HERE because the
 *  clearing is a SEAM-SHARED decision (see tree_cleared_at) — both sides must fold the same salt. */
export const SALT_SPAWN_CLEAR = 0x5f1c2d3b

/**
 * SPAWN CLEARING gate (the initial spawn region must be walkable, never a tree wall —
 * the verdant_hollow repro). True when a tree at (wx,wz) is SUPPRESSED by the clearing around the world
 * spawn anchor (origin): a hard-clear core (`spawn_clear_radius`) plus a density ramp over
 * `spawn_clear_falloff` back to full forest. Deterministic — squared-distance + one per-column hash vs the
 * radial keep-probability (no sqrt/trig, §3.7). Rocks & flora are untouched (trees are the wall).
 * radius ≤ 0 ⇒ off (byte-identical opt-out).
 *
 * ONE HOME — SEAM LAW (§3.6, the far_trees_gen regression 2026-07-13): the near decorator
 * (surface_decorator.resolve_placement_at) AND the far impostor mirror (render/far_trees_gen
 * derive_section_trees) BOTH call THIS function, exactly like the grammar/grove helpers above — a private
 * copy on one side is how the ring seam breaks (far rendered glade trees the near ring refused to grow).
 * @param {typeof DECO_DEFAULTS} deco resolved decoration densities (resolve_deco)
 * @param {number} wx @param {number} wz @param {number} seed the world's decorators sub-seed
 * @returns {boolean} true ⇒ no tree here (cleared for the spawn glade)
 */
export function tree_cleared_at(deco, wx, wz, seed) {
  const r = deco.spawn_clear_radius
  if (!r || r <= 0) return false
  const d2 = wx * wx + wz * wz
  const r2_hard = r * r
  if (d2 <= r2_hard) return true // hard-clear core — a guaranteed open, walkable glade at spawn
  const r_soft = r + (deco.spawn_clear_falloff ?? 0)
  const r2_soft = r_soft * r_soft
  if (d2 >= r2_soft) return false // beyond the clearing — full forest
  const keep = (d2 - r2_hard) / (r2_soft - r2_hard) // 0 at the core edge → 1 at the soft edge
  const roll = (hash_column(wx, wz, (seed ^ SALT_SPAWN_CLEAR) >>> 0) % 1024) / 1024
  return roll >= keep // suppress when the roll beats the keep-prob ⇒ trees thin toward the core
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NATURE-PLACEMENT GRAMMAR (uniform sprinkle placement reads as random, not natural —
// see Conquest Reforged and Massive Mountains for the target). The uniform grove-cell + 1-in-N
// scatter is replaced by an ECOLOGICAL grammar: forest CLUSTERS with organic edges + clearings, a
// SLOPE gate (bare steep faces), a TREELINE THINNING band (krummholz), scree fields on steeps, and a
// rare hero-tree channel. ALL pure integer/IEEE arithmetic (§3.7 — same worker/main determinism as the
// hash lineage above; Math.sqrt is IEEE-correctly-rounded so slope agrees bit-for-bit across threads).
//
// ONE HOME (no copied drift): the near decorator (surface_decorator.resolve_placement_at) AND the far
// impostor mirror (render/far_trees_gen.derive_section_trees) BOTH call grammar_tree_at/_hero_species
// here, so the ring seam stays exact by construction. Config-gated: resolve_grammar returns null unless
// `decoration.grammar.enabled` — absent ⇒ the legacy grove/scatter path runs verbatim ⇒ byte-identical
// DEFAULT + every non-everest world. Everest opts in with tuned class values (the pattern-setter).

/** Grammar knobs with defaults — a world sets only `enabled` + the deltas it cares about. */
export const GRAMMAR_DEFAULTS = {
  // FOREST CLUSTER field — a warped low-freq value-noise density mask: stands where it's high, CLEARINGS
  // where it's below threshold, organic soft edges over `softness`.
  cluster_period: 96, // block period of a stand/clearing (you walk through one)
  cluster_octaves: 2,
  cluster_warp: 24, // domain-warp displacement (blocks) — bends stand boundaries organic
  cluster_threshold: 0.4, // field value below which density → 0 (clearings)
  cluster_softness: 0.22, // smoothstep width above threshold to a full-density stand core
  // WALKABILITY (forests must stay walkable — they can't be ultra dense either). canopy_density
  // IS the stand-CORE tree-anchor fraction — the direct, walkability-capped density knob (0.06 ⇒ ~4-block trunk
  // spacing; the canopies still overlap wide so the stand reads DENSE from outside but stays traversable inside).
  // It is the PEAK rate (cluster/slope/treeline only reduce it), so keeping it ≤ ~0.08 guarantees a path exists.
  canopy_density: 0.05, // default stand-core anchor fraction
  biome_density: /** @type {Record<string, number>} */ ({}), // PER-REGION knob: biome_name → canopy_density
  // (each region pins a distinct biome, so this tunes taiga vs ice_forest density from config, no code)
  // SLOPE gate — trees thin then stop as the neighbourhood slope rises (bare steep faces / ridgelines).
  tree_slope_max: 1.4, // slope (rise/run) at/above which NO tree
  slope_softness: 0.5, // slope band below max over which tree density ramps 1 → 0
  slope_step: 3, // central-difference probe step (blocks) for the slope
  // TREELINE THINNING — krummholz: density ramps 1 → 0 across the band below the hard treeline.
  treeline_band: 40, // blocks below `surface.treeline` over which trees thin out (0 ⇒ hard line)
  // SCREE — boulders densify on the steep faces trees vacate (talus fields), clustered so they read as
  // fields not confetti; sparse erratics on the flats.
  rock_slope_boost: 2.5, // rock density multiplier at full steepness (1 + boost)
  rock_density_scale: 1.0, // multiplier on the biome's 1/rock_one_in
  // HERO TREES — a rare channel forces a landmark species (e.g. towering pine) over the weighted pick.
  hero_species: null, // species key, or null ⇒ no hero channel
  hero_one_in: 40, // 1-in-N tree columns become a hero (only when hero_species set)
}

/** Decision salts (decorrelated u32 streams; folded with the world seed at the call site). */
const SALT_CLUSTER = 0x51ed270b // forest cluster field
const SALT_ROCK_FIELD = 0x2c1b3a91 // scree-field cluster (independent of the forest field)
const SALT_TREE_GRAMMAR = 0x9e3779b1 // per-column tree acceptance (== legacy SALT_TREE stream)
const SALT_ROCK_GRAMMAR = 0x94d049bb // per-column rock acceptance (== legacy SALT_ROCK stream)
const SALT_HERO = 0x6d2b79f5 // hero-tree channel

const smooth01 = (/** @type {number} */ t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
/** Smoothstep of v across [lo, hi] (0 below lo, 1 above hi); hi ≤ lo ⇒ a hard step at hi. */
const ramp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
  hi <= lo ? (v >= hi ? 1 : 0) : smooth01((v - lo) / (hi - lo))

/** Memo of resolved grammar per `decoration` config object (pure fn of it). @type {WeakMap<object, any>} */
const _grammar_cache = new WeakMap()
/**
 * Resolves `decoration.grammar` into the full knob set (config over GRAMMAR_DEFAULTS), or null when the
 * grammar is absent/disabled (⇒ the caller runs the legacy grove/scatter path ⇒ byte-identical parity).
 * @param {any} [decoration] a world's `decoration` config
 * @returns {(typeof GRAMMAR_DEFAULTS & { enabled: true }) | null}
 */
export function resolve_grammar(decoration) {
  const g = decoration?.grammar
  if (!g || g.enabled !== true) return null
  const cached = _grammar_cache.get(g)
  if (cached !== undefined) return cached
  const r = /** @type {any} */ ({ ...GRAMMAR_DEFAULTS, enabled: true })
  for (const k of /** @type {(keyof typeof GRAMMAR_DEFAULTS)[]} */ (Object.keys(GRAMMAR_DEFAULTS)))
    if (g[k] !== undefined && g[k] !== null) r[k] = g[k]
  _grammar_cache.set(g, r)
  return r
}

/** hash_column normalized to [0,1). */
const hash01 = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ salt) =>
  hash_column(x, z, salt) / 4294967296
/** One octave of bilinear value noise in [0,1] at `period`. Deterministic (floor + IEEE divide + smoothstep).
 *  @param {number} x @param {number} z @param {number} salt @param {number} period @returns {number} */
function vnoise(x, z, salt, period) {
  const fx = x / period
  const fz = z / period
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const tx = smooth01(fx - x0)
  const tz = smooth01(fz - z0)
  const s = salt >>> 0
  const a = hash01(x0, z0, s) + (hash01(x0 + 1, z0, s) - hash01(x0, z0, s)) * tx
  const b = hash01(x0, z0 + 1, s) + (hash01(x0 + 1, z0 + 1, s) - hash01(x0, z0 + 1, s)) * tx
  return a + (b - a) * tz
}
/** Value-noise fbm in [0,1] (period, period/2, …). @param {number} x @param {number} z @param {number} salt
 *  @param {number} period @param {number} octaves @returns {number} */
function vfbm(x, z, salt, period, octaves) {
  let sum = 0
  let amp = 1
  let ampsum = 0
  let p = period
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * vnoise(x, z, (salt + i * 0x9e3779b1) >>> 0, p)
    ampsum += amp
    amp *= 0.5
    p *= 0.5
  }
  return sum / ampsum
}

/** The stand/clearing density [0,1] for a column: a warped value-noise field thresholded into stands
 *  (1) and clearings (0) with organic soft edges. Pure. @param {number} x @param {number} z
 *  @param {number} stream u32 stream base (seed folded with a field salt) @param {any} g resolved grammar */
function cluster01(x, z, stream, g) {
  let sx = x
  let sz = z
  if (g.cluster_warp !== 0) {
    const wx = (vnoise(x, z, (stream ^ 0x1) >>> 0, g.cluster_period) - 0.5) * 2
    const wz = (vnoise(x + 131, z - 71, (stream ^ 0x2) >>> 0, g.cluster_period) - 0.5) * 2
    sx = x + wx * g.cluster_warp
    sz = z + wz * g.cluster_warp
  }
  const f = vfbm(sx, sz, stream, g.cluster_period, g.cluster_octaves)
  return ramp(f, g.cluster_threshold, g.cluster_threshold + g.cluster_softness)
}

/** Neighbourhood slope (rise/run) at a column from a surface-y probe callback (central difference over
 *  ±step). Deterministic (integer diffs → IEEE sqrt). @param {(x:number,z:number)=>number} probe
 *  @param {number} x @param {number} z @param {number} step @returns {number} */
export function grammar_slope(probe, x, z, step) {
  const ex = probe(x + step, z) - probe(x - step, z)
  const ez = probe(x, z + step) - probe(x, z - step)
  return Math.sqrt(ex * ex + ez * ez) / (2 * step)
}

/** Accept iff hash01(x,z,salt) < rate (rate clamped to [0,1]). @param {number} x @param {number} z
 *  @param {number} salt @param {number} rate @returns {boolean} */
function accept(x, z, salt, rate) {
  if (rate <= 0) return false
  if (rate >= 1) return true
  return hash_column(x, z, salt >>> 0) < rate * 4294967296
}

/** The stand-core tree-anchor density (walkability cap) for a biome: its per-region override, else the
 *  world default. @param {any} g resolved grammar @param {string} biome_name @returns {number} */
export function grammar_biome_density(g, biome_name) {
  const b = g.biome_density?.[biome_name]
  return typeof b === 'number' ? b : g.canopy_density
}

/**
 * Whether a PROCEDURAL tree lands at a column under the grammar — the SHARED decision both the near
 * decorator and the far impostor mirror call (so the ring seam is exact). Density = base_rate (the
 * biome's WALKABILITY-capped stand-core canopy_density) × cluster stand × slope gate × treeline
 * thinning. base_rate is the PEAK, so a walkable canopy_density ⇒ a walkable forest everywhere. Pure.
 * @param {any} g resolved grammar (non-null)
 * @param {(x:number,z:number)=>number} probe surface-y probe (anchor_surface)
 * @param {number} x @param {number} z @param {number} seed world (decorator) seed
 * @param {number} surface_y the column's surface world-y (treeline thinning input)
 * @param {number|undefined} treeline `surface.treeline` (undefined ⇒ no thinning band)
 * @param {number} base_rate the biome's stand-core canopy density (grammar_biome_density)
 * @returns {boolean}
 */
export function grammar_tree_at(g, probe, x, z, seed, surface_y, treeline, base_rate) {
  const cl = cluster01(x, z, (seed ^ SALT_CLUSTER) >>> 0, g)
  if (cl <= 0) return false // clearing — the cheap early-out before the slope probe
  const sf = 1 - ramp(grammar_slope(probe, x, z, g.slope_step), g.tree_slope_max - g.slope_softness, g.tree_slope_max)
  if (sf <= 0) return false // too steep
  let tf = 1
  if (treeline !== undefined && g.treeline_band > 0) tf = 1 - ramp(surface_y, treeline - g.treeline_band, treeline) // krummholz thinning
  const rate = base_rate * cl * sf * tf
  return accept(x, z, (seed ^ SALT_TREE_GRAMMAR) >>> 0, rate)
}

/** Whether a BOULDER/scree lands at a column under the grammar (near-only; no far impostor for rocks):
 *  a scree-field cluster × slope affinity (boulders densify on the steep faces trees vacate) × base
 *  rate. Pure. @param {any} g @param {(x:number,z:number)=>number} probe @param {number} x @param {number} z
 *  @param {number} seed @param {number} rock_one_in @returns {boolean} */
export function grammar_rock_at(g, probe, x, z, seed, rock_one_in) {
  const cl = cluster01(x, z, (seed ^ SALT_ROCK_FIELD) >>> 0, g)
  if (cl <= 0) return false
  const affinity =
    1 +
    g.rock_slope_boost *
      ramp(
        grammar_slope(probe, x, z, g.slope_step),
        g.tree_slope_max - g.slope_softness,
        g.tree_slope_max + g.slope_softness
      )
  const rate = (g.rock_density_scale / rock_one_in) * cl * affinity
  return accept(x, z, (seed ^ SALT_ROCK_GRAMMAR) >>> 0, rate)
}

/** The hero species forced at a column, or null. Rare channel (1-in hero_one_in) — a landmark giant
 *  towering out of the ordinary stand. Both near + far apply it so species×age (⇒ atlas layer) agrees.
 *  @param {any} g @param {number} x @param {number} z @param {number} seed @returns {string|null} */
export function grammar_hero_species(g, x, z, seed) {
  if (!g.hero_species || !(g.hero_one_in > 0)) return null
  return hash_column(x, z, (seed ^ SALT_HERO) >>> 0) % g.hero_one_in === 0 ? g.hero_species : null
}
