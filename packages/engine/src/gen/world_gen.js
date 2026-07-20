// World-chunk entry point (§4) — the decorated generation path the streaming loader consumes.
// THIN ORCHESTRATOR: the heavy lifting (6-param climate fields, Catmull-Rom height splines,
// weighted biome placement, solid/water fill + occupancy + light) already lives in column_gen.js
// and its deps and is covered by the golden-hash world-identity gate (column_gen.test.js). This
// module only (a) owns the deterministic default gen-context so callers get the brief's context-
// free `generate_world_chunk(cx,cy,cz)` signature, (b) flattens beach waterlines (surface polish
// kept OUTSIDE the golden-hashed core), and (c) layers surface_decorator on top.
//
// Decoration + beach flattening are deliberately applied HERE, not inside column_gen's
// generate_column/generate_chunk, so the golden-hashed terrain core stays byte-stable while
// in-flight decoration blocks and surface polish evolve.
//
// DETERMINISM LAW (§3.7): the default context is derived once from the hardcoded MASTER_SEED and
// memoized; every op downstream is arithmetic + Math.floor/sqrt/abs only (verified by the gen/
// transcendental-ban guard in column_gen.test.js + world_gen.test.js).

import { SEA_LEVEL } from '../config/world_config.js'
import { get_biome_by_name } from '../config/biome_registry.js'
import { get_block_by_name } from '../config/block_registry.js'
import { get_map_color } from '../lod/colors.js'
import { fill_simple_light } from '../chunks/light_engine.js'

import { biome_at, build_column_profile, create_gen_context, fill_chunk_from_profile } from './column_gen.js'
import { region_profile } from './stages/regions.js'
import { sample_climate } from './noise/fields.js'
import { shape_column } from './terrain_shaper.js'
import { place_biome, place_biome_def } from './biome_placer.js'
import { decorate_chunk } from './surface_decorator.js'
import { rekey_density_column } from './density.js'
import { build_fall_registry, column_window_from_profile } from './waterfall_registry.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('./column_gen.js').GenContext} GenContext */
/** @typedef {import('./column_gen.js').ColumnProfile} ColumnProfile */

/**
 * The ACTIVE world recipe this module generates from. `undefined` ⇒ the DEFAULT recipe (today's
 * hardcoded-seed world). Set once per world by `set_gen_config` — the gen worker calls it on its
 * MSG_GEN_CONFIG init and engine.js calls it on the main thread, so both sides of the worker
 * boundary derive the SAME world (§3.7 determinism). Config-first world selection (§2.3).
 * @type {import('../config/world_gen_config.js').WorldGenConfig | undefined}
 */
let active_config

/**
 * Lazily-built, memoized generation context for the ACTIVE recipe. Not mutable world state — a pure,
 * deterministic derivation cached so we don't rebuild the fbm samplers on every chunk. Same recipe on
 * every machine ⇒ world-identity holds (§3.7).
 * @type {GenContext | null}
 */
let default_ctx = null

/** @returns {GenContext} the shared context for the active recipe, built on first use. */
function get_default_context() {
  if (default_ctx === null) default_ctx = create_gen_context(active_config)
  return default_ctx
}

/**
 * Sets the world recipe this module generates from (config-first world selection). Resets the memoized
 * context + column-profile cache so the next chunk rebuilds against the new recipe. Called by the gen
 * worker on its MSG_GEN_CONFIG init and by engine.js on the main thread (world_surface_y) with the SAME
 * config, so worker and main-thread gen agree. Idempotent for the same config; safe before any gen call.
 * @param {import('../config/world_gen_config.js').WorldGenConfig} config
 * @returns {void}
 */
export function set_gen_config(config) {
  active_config = config
  default_ctx = null
  memo_key = ''
  memo_profile = null
}

// ---- Beach waterline flattening (defect: coastal flats generated at y 127-128, i.e.
// submerged under the sea surface with bumps poking through — read as floating cubes over blue).
// Beach-biome columns whose RAW surface falls in the narrow waterline band are flattened to one
// dry level, SEA_LEVEL+1: the lower bound lifts submerged flats out of the water, the single flat
// level suppresses the ±bump variation (flat beaches read right). The band is deliberately
// narrow, based on the measured beach height distribution (raw y 122..150 for the fixed seed):
//   raw < 126  → kept — coherent underwater shallows on the ocean side (raising them would build
//                sand walls out of the sea);
//   raw > 131  → kept — the beach→inland rising slope (flattening would dig craters into it).
// Applied to BOTH the chunk profile and world_surface_y so loader/tests stay consistent, and only
// in this world_gen layer — the golden-hashed column_gen/shaper core is untouched.
const BEACH_ID = get_biome_by_name('beach')?.id
/** Water block id — the minimap paints submerged columns this block's map colour (deep-body blue). */
const WATER_ID = /** @type {number} */ (get_block_by_name('water')?.id ?? 0)
const BEACH_BAND_LOW = SEA_LEVEL - 2 // 126
const BEACH_BAND_HIGH = SEA_LEVEL + 3 // 131
const BEACH_FLAT_Y = SEA_LEVEL + 1 // 129

/**
 * The beach-flattened surface height for one column. Identity for non-beach biomes, for beach
 * columns outside the waterline band, and when the beach biome is absent from the registry.
 * @param {number} biome_id dominant biome id at the column
 * @param {number} raw_surface_y spline surface height from the golden core
 * @returns {number} adjusted first-air surface world-y
 */
function flatten_beach_surface(biome_id, raw_surface_y) {
  if (biome_id !== BEACH_ID) return raw_surface_y
  if (raw_surface_y < BEACH_BAND_LOW || raw_surface_y > BEACH_BAND_HIGH) return raw_surface_y
  return BEACH_FLAT_Y
}

/**
 * Applies the beach flattening to every column of a freshly built profile (in place, once, at
 * construction — profiles stay read-only afterwards). Beaches are high-erosion so their density band
 * is ungated (pure heightfield); when a beach column's surface is lifted, its DensityColumn's
 * `surface_y` (which the density solid test keys on) and its `ground_top` (light height oracle) must
 * be moved in lockstep, else the flatten is silently ignored by the 3D solid decision.
 * @param {ColumnProfile} profile
 * @returns {void}
 */
function apply_beach_flattening(profile) {
  for (let i = 0; i < profile.surface_y.length; i += 1) {
    const flat = flatten_beach_surface(profile.biome_id[i], profile.surface_y[i])
    if (flat === profile.surface_y[i]) continue
    profile.surface_y[i] = flat
    // Re-key the (ungated) density band + light height to the flattened surface.
    rekey_density_column(profile.density[i], flat)
    profile.ground_top[i] = flat
  }
}

// Size-1 column-profile memo. The loader iterates (cx,cz) OUTER and cy INNER, so the six stacked
// chunks of a column reuse one profile instead of rebuilding it 6×. Pure memo of a deterministic
// function — a different (cx,cz) simply rebuilds; profiles are read-only after construction, so
// sharing across the cy fills is safe. Kept trivial and easy to delete.
let memo_key = ''
/** @type {ColumnProfile | null} */
let memo_profile = null

/**
 * @param {GenContext} ctx
 * @param {number} cx
 * @param {number} cz
 * @returns {ColumnProfile}
 */
function get_column_profile(ctx, cx, cz) {
  const key = `${cx},${cz}`
  if (key !== memo_key || memo_profile === null) {
    memo_profile = build_column_profile(ctx, cx, cz)
    apply_beach_flattening(memo_profile)
    memo_key = key
  }
  return memo_profile
}

/**
 * Generates ONE fully-decorated world chunk at (cx, cy, cz): real Minecraft-1.18-style terrain
 * (from column_gen) + surface decoration (tufts/flowers/trees, feature-detected). Deterministic
 * for the hardcoded world seed; correct for any cy (all-air chunks above/below terrain come back
 * cheaply as empty records from the underlying fill). This is the entry the island loader calls.
 * @param {number} cx chunk x
 * @param {number} cy chunk y (0 .. CHUNKS_PER_COLUMN-1)
 * @param {number} cz chunk z
 * @returns {ChunkRecord}
 */
export function generate_world_chunk(cx, cy, cz) {
  const ctx = get_default_context()
  const profile = get_column_profile(ctx, cx, cz)
  const chunk = fill_chunk_from_profile(ctx, profile, cx, cy, cz, false)
  decorate_chunk(chunk, profile, cx, cy, cz, ctx.seeds.decorators, ctx)
  // Decoration never reads light; flood once after its final occupancy writes.
  fill_simple_light(chunk)
  return chunk
}

/**
 * Integer surface world-y at a world column (x,z) for the default world — the cheap height probe
 * the loader's spawn scan and tools use without filling a whole column. Composes the same climate
 * → spline shaping column_gen uses PLUS the beach waterline flattening, so it matches the
 * generated chunks exactly (tests rely on this equivalence).
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} first-air surface world-y (topmost solid block sits at this - 1)
 */
export function world_surface_y(world_x, world_z) {
  const ctx = get_default_context()
  const climate = sample_climate(ctx.fields, world_x, world_z)
  return flatten_beach_surface(place_biome(climate, ctx.placer), shape_column(climate, ctx.shaper).surface_y)
}

/**
 * Dominant biome id at a world column — the main-thread twin of the gen worker's biome pin, using the
 * SAME pure probe as world_surface_y (sample_climate + place_biome). Feeds the B5 biome-mood driver
 * (engine.js) so the camera's atmosphere mood tracks the terrain it flies over. Pure + deterministic
 * (§3.7): no chunk residency, no side effects.
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} biome id (see config/biome_registry.js BIOME_REGISTRY)
 */
export function world_biome_at(world_x, world_z) {
  // ROUND-2 FIX (latent inconsistency): route through column_gen.biome_at, which applies the S-25 REGION
  // PIN — so the main-thread probe (mood driver, ambience, minimap consumers) reads the SAME biome as the
  // generated column. Non-region worlds (incl. DEFAULT): regions disabled ⇒ biome_at falls through to the
  // exact climate placement below ⇒ byte-identical.
  return biome_at(get_default_context(), world_x, world_z)
}

/**
 * Dominant sub-biome REGION NAME at a world column for the ACTIVE recipe (set_gen_config), or null when
 * the world has no region layer. The main-thread identity probe the per-region zone music keys on
 * (`${world}:${region}` — 2026-07-13: "5-6 biomes per world, a music for each"). Pure + deterministic
 * (§3.7): the same seeded region field the gen worker pins biomes with; no chunk residency.
 * @param {number} world_x
 * @param {number} world_z
 * @returns {string | null} dominant region class name, or null (no region layer / off)
 */
export function world_region_at(world_x, world_z) {
  const ctx = get_default_context()
  if (!ctx.regions.enabled) return null
  return region_profile(ctx.regions, world_x, world_z).region
}

/**
 * Per-column minimap probe — the HUD Cube-World minimap sampler (frontend). ONE climate sample yields both
 * the analytic surface height (relief shading) and the dominant surface COLOUR: a submerged column paints
 * the water block's map colour, else the biome's surface strata block. Colour comes from the SAME
 * `get_map_color` SSOT the far-LOD shell reads (lod/colors.js — the alpha-weighted near-atlas mean), so the
 * minimap can never drift from the terrain the player sees at distance. Pure + deterministic (§3.7): no chunk
 * residency, no side effects. Approximation: uses the biome's `land.surface` block, not the per-voxel
 * slope/glacier surface painter (peaks/glaciers already read snow/stone via their biome) — right for a map.
 * The returned `color` is the colour table's SHARED read-only [r,g,b] triple (no per-call allocation).
 * @param {number} world_x
 * @param {number} world_z
 * @returns {{ surface_y: number, color: [number, number, number] }}
 */
export function world_minimap_column(world_x, world_z) {
  const ctx = get_default_context()
  const climate = sample_climate(ctx.fields, world_x, world_z)
  const biome = place_biome_def(climate, ctx.placer)
  const surface_y = flatten_beach_surface(biome.id, shape_column(climate, ctx.shaper).surface_y)
  const block_id = surface_y <= ctx.sea_level ? WATER_ID : (get_block_by_name(biome.land.surface)?.id ?? 0)
  return { surface_y, color: get_map_color(block_id) }
}

/**
 * Face-resolved waterfall FALL SPANS for a chunk column (cx,cz) — the render-side handoff for the B4
 * waterfall overlay (render/waterfall_sheet.js, default ON, ?falls=0 escape). Main-thread twin of the gen worker's
 * hydrology pass: reuses the memoized column profile (beach-flattened, matching the streamed chunks) and
 * runs the pure lane-A5 registry on it. Per-chunk window ⇒ chunk-edge columns lose cross-chunk neighbor
 * faces (A5's documented single-chunk seam); interior cascades resolve. Pure + deterministic (§3.7).
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @returns {import('./waterfall_registry.js').FallSpan[]}
 */
export function world_fall_spans(cx, cz) {
  const ctx = get_default_context()
  const profile = get_column_profile(ctx, cx, cz)
  return build_fall_registry(column_window_from_profile(profile, cx, cz))
}
