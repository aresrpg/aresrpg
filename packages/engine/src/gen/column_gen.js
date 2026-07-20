// Column generation (§4) — orchestrates ONE 32×384×32 world column through the deterministic
// CPU pipeline: sample the 6-param climate fields → spline-shape the surface height → place biomes
// → fill block ids + occupancy + height + biome meta, then seed light. Produces the 12 stacked
// ChunkRecords (cy 0..11) that make up a full-height column, in the exact shape WS3 (mesh) and
// WS4 (render) already consume (matches the test_gen.js seam this replaces).
//
// SCOPE (M1 generation spine): terrain + water + biome strata. CARVERS (caves), DECORATORS (trees/
// ores/clutter), HYDROLOGY (river carving beyond PV valleys), and STRUCTURES are LATER workstreams
// — clean seams + TODOs are left where they hook in, no half-implementations.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor only. Same seed ⇒ bit-identical column on every
// machine (golden-hash contract, §3.7 — see column_gen.test.js).

import { CHUNK_SIZE, CHUNKS_PER_COLUMN, WORLD_HEIGHT, REGION_SIZE_CHUNKS } from '../config/world_config.js'
import { SUBSURFACE_DEPTH, resolve_land_block_ids } from '../config/biome_registry.js'
import { get_block_by_id, get_block_by_name } from '../config/block_registry.js'
import { column_index, create_chunk_record, local_index, meta_cell_index, set_occupancy_bit } from '../chunks/format.js'
import { fill_simple_light } from '../chunks/light_engine.js'

import { sample_climate } from './noise/fields.js'
import { place_biome_def } from './biome_placer.js'
import { build_density_column, is_solid as is_solid_density } from './density.js'
import { canyon_depth } from './carvers/canyon.js'
import { strata_band_block } from './stages/strata.js'
import { surface_by_slope_block, scree_apron_delta } from './stages/surface_by_slope.js'
import { iceberg_block } from './stages/icebergs.js'
import { region_profile } from './stages/regions.js'
import { glacier_surface_block } from './stages/glacier.js'
import {
  prime_region,
  evict_caves_if_full,
  cavern_room_at,
  cave_region_at,
  CAVERN_ROOM_META_FLAG,
} from './carvers/caves.js'
import {
  hydrology_column,
  river_strength,
  river_water_level,
  prime_lake_tile,
  evict_lake_tiles_if_full,
  lake_level_at,
} from './hydrology.js'
import { column_slope, column_sun_dot, raw_land, spawn_dry_floor } from './column_context.js'

export { anchor_surface, biome_at, create_gen_context } from './column_context.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('../config/biome_registry.js').BiomeDef} BiomeDef */
/** @typedef {import('./density.js').DensityContext} DensityContext */
/** @typedef {import('./density.js').DensityColumn} DensityColumn */
/** @typedef {import('./column_context.js').GenContext} GenContext */
/** @typedef {import('./column_context.js').AnchorSurface} AnchorSurface */

const AIR = /** @type {number} */ (get_block_by_name('air')?.id)
const WATER = /** @type {number} */ (get_block_by_name('water')?.id)
/** Stone id — the sky-island body/root material (see block_at). */
const STONE = /** @type {number} */ (get_block_by_name('stone')?.id)
/** Grass id — the sky-island top CRUST. Islands are a lush floating biome, grass-topped regardless of
 *  the terrain biome far below (Pandora green tops); vegetation-on-islands is a follow-up. */
const ISLAND_CRUST = /** @type {number} */ (get_block_by_name('grass')?.id)

/**
 * @typedef {object} ColumnProfile precomputed per-(x,z) surface data for one chunk-column footprint
 *   (32×32 columns). Shared across the 12 stacked chunk records so climate/shaping is sampled once.
 * @property {Int16Array} surface_y EFFECTIVE surface world-y per column (index = column_index) —
 *   spline + mountain erosion − canyon/river carve. The density field can lift solid above it
 *   (overhang lips) or carve below it (caves); it drives STRATA selection (depth-from-surface) and
 *   the density base gradient, but not occupancy directly.
 * @property {Uint8Array} biome_id dominant biome id per column (index = column_index)
 * @property {Int32Array} strata packed 4 block ids per column: surface/subsurface/underwater/filler
 *   flattened as 4 consecutive Int32 entries (index = column_index*4 + k)
 * @property {Int16Array} water_level per-column water surface world-y (index = column_index): sea
 *   level everywhere, raised over river channels, lakes, and waterfall faces (hydrology, §4.4)
 * @property {Uint8Array} waterfall 1 where the column spills water down a face (a fall/cascade), else 0
 * @property {DensityColumn[]} density per-column density inputs (gate + active band bounds), index =
 *   column_index — drives the 3D solid/air decision (§2.2)
 * @property {Int16Array} ground_top highest GROUND-solid world-y per column (surface_y or an
 *   overhang lip above it), EXCLUDING sky islands — the light height oracle (index = column_index)
 * @property {Float32Array | null} slope per-column land slope (rise/run), index = column_index — only
 *   computed when a slope-driven stage is on (strata / slope-snow / glacier); null otherwise (block_at skips it)
 * @property {Int16Array | null} glacier per-column GLACIAL §B.3 surface-block override (index =
 *   column_index): ice/firn/moraine/crevasse/rubble id, or -1 for "not a glacier floor". null when the
 *   glacier stage is off (block_at skips it) ⇒ byte-identical DEFAULT.
 * @property {Float32Array | null} region_ice per-column S-25 alpine ice-line delta (blocks), index =
 *   column_index — the region layer's palette lever into the alpine painter. null when the region layer is
 *   off (block_at passes 0) ⇒ byte-identical DEFAULT.
 */

/**
 * Allocates an EMPTY ColumnProfile shell for `cell_count` columns — the ONE home for which optional
 * layers exist (keyed to the ctx's stage flags, so `profile.slope !== null` etc. branch identically
 * for every consumer). The near ring fills a full 32×32 grid; the far sampler fills a 1-cell scratch.
 * @param {GenContext} ctx
 * @param {number} cell_count
 * @returns {ColumnProfile}
 */
export function create_column_profile(ctx, cell_count) {
  return {
    surface_y: new Int16Array(cell_count),
    biome_id: new Uint8Array(cell_count),
    strata: new Int32Array(cell_count * 4),
    water_level: new Int16Array(cell_count),
    waterfall: new Uint8Array(cell_count),
    /** @type {DensityColumn[]} */
    density: new Array(cell_count),
    ground_top: new Int16Array(cell_count),
    // FIVE-WORLDS slope-driven stages (strata / slope-snow / glacier) need per-column slope; skipped otherwise.
    slope: ctx.needs_slope ? new Float32Array(cell_count) : null,
    // GLACIAL §B.3 glacier ribbon surface-block override, per column (fully populated on fill); null when off.
    glacier: ctx.glacier.enabled ? new Int16Array(cell_count) : null,
    // S-25 sub-biome region layer: per-column alpine ice-line delta (palette lever); null when off ⇒ parity.
    region_ice: ctx.regions.enabled ? new Float32Array(cell_count) : null,
  }
}

/**
 * Primes the region-local gen caches every column inside chunk (cx,cz) reads: cave-worm regions
 * (3×3 neighborhood — worms walk ≤ ~187 blocks, so ±1 region covers every reachable mouth) and the
 * chunk's lake tile. Both caches are pure memos of deterministic builds (eviction never changes
 * output — proven by the eviction-neutrality golden), so priming ORDER is value-neutral; the evict
 * calls run only at this footprint boundary, never mid-priming.
 * @param {GenContext} ctx
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @returns {void}
 */
export function prime_column_footprint(ctx, cx, cz) {
  // Prime cave-region worms for the chunk's 3×3 REGION neighborhood (bounded + cached). Worm mouths
  // sit at the land surface, so the probe recomputes the raw land surface deterministically.
  const land_probe = (/** @type {number} */ wx, /** @type {number} */ wz) =>
    raw_land(ctx, wx, wz, sample_climate(ctx.fields, wx, wz))
  const rx = Math.floor(cx / REGION_SIZE_CHUNKS)
  const rz = Math.floor(cz / REGION_SIZE_CHUNKS)
  evict_caves_if_full(ctx.density.caves) // per-column boundary — never clears mid-priming (determinism)
  for (let drz = -1; drz <= 1; drz += 1)
    for (let drx = -1; drx <= 1; drx += 1) prime_region(ctx.density.caves, rx + drx, rz + drz, land_probe)

  // Prime the chunk's LAKE TILE (pour-point flood memo, hydrology.js) — same recompute-probe pattern
  // as the worm regions above; a 32-chunk lies inside exactly ONE 256-block tile (tile == region), and
  // lake water never reaches tile borders, so no neighbor tile is ever needed.
  const lake_probe = (/** @type {number} */ wx, /** @type {number} */ wz) => {
    const climate = sample_climate(ctx.fields, wx, wz)
    return {
      land: raw_land(ctx, wx, wz, climate),
      erosion: climate.erosion,
      pv: climate.pv,
      continentalness: climate.continentalness,
    }
  }
  evict_lake_tiles_if_full(ctx.hydro) // column boundary — never clears a tile mid-fill (determinism)
  prime_lake_tile(ctx.hydro, rx, rz, lake_probe)
}

/**
 * Computes ONE column's full profile record into `profile` at index `ci` — the per-column body of
 * build_column_profile, extracted verbatim so the far shell can tap SPARSE columns through the SAME
 * code (one home for gen truth; §3.7 byte-identity holds because near calls it for every grid column
 * in the same order with the same args). PRECONDITION: prime_column_footprint was called for the
 * chunk containing (world_x, world_z).
 * @param {GenContext} ctx
 * @param {ColumnProfile} profile
 * @param {number} ci destination column index in the profile's arrays
 * @param {number} world_x
 * @param {number} world_z
 * @returns {void}
 */
export function fill_profile_column(ctx, profile, ci, world_x, world_z) {
  const climate = sample_climate(ctx.fields, world_x, world_z)
  /** @type {BiomeDef} */
  let biome = place_biome_def(climate, ctx.placer)
  // S-25 SUB-BIOME REGION PIN: on a region world the dominant region class pins the biome (decoration +
  // strata follow the region), overriding the near-degenerate climate placement, and supplies the alpine
  // ice-line palette delta. Off ⇒ regions disabled ⇒ climate placement + no delta (byte-identical).
  if (profile.region_ice !== null) {
    const rp = region_profile(ctx.regions, world_x, world_z)
    profile.region_ice[ci] = rp.ice_line_delta
    if (rp.biome_id >= 0) {
      const pinned = ctx.placer.by_id.get(rp.biome_id)
      if (pinned) biome = pinned
    }
  }
  const land_ids = resolve_land_block_ids(biome)

  // Effective LAND surface — the SINGLE height home (raw_land): spline + mountain relief + GLACIAL §A
  // crag − canyon − FIVE-WORLDS canyon stage − GLACIAL §B.1 trough − GLACIAL §B.2 cirque. Every GLACIAL
  // term is 0 when disabled ⇒ byte-identical DEFAULT. No inline duplicate — raw_land is the source of truth.
  const land_y = raw_land(ctx, world_x, world_z, climate)
  if (profile.slope !== null) profile.slope[ci] = column_slope(ctx, world_x, world_z, ctx.surface.slope_window)
  // Baseline canyon depth — needed ONLY for the waterfall-neighbor gate below (canyon-carved columns
  // probe their 4 neighbors). raw_land already applied it to land_y; this re-read keeps the gate exact.
  const cd = canyon_depth(ctx.canyon, world_x, world_z, climate.continentalness, climate.erosion, climate.pv)

  // Hydrology: river channel carve + water level + lakes; waterfall spill needs the 4 neighbor
  // land/river probes, computed ONLY for river/canyon-carved columns (the rest skip the scan).
  let neighbors = null
  if (river_strength(ctx.hydro, world_x, world_z, climate.continentalness, climate.pv) > 0 || cd > 3) {
    neighbors = [
      neighbor_water(ctx, world_x + 1, world_z),
      neighbor_water(ctx, world_x - 1, world_z),
      neighbor_water(ctx, world_x, world_z + 1),
      neighbor_water(ctx, world_x, world_z - 1),
    ]
  }
  const hydro = hydrology_column(
    ctx.hydro,
    world_x,
    world_z,
    climate.continentalness,
    climate.pv,
    land_y,
    lake_level_at(ctx.hydro, world_x, world_z),
    neighbors
  )
  let eff = land_y - Math.floor(hydro.carve)
  if (eff < 2) eff = 2
  // SPAWN DRY-FLOOR re-applied POST-CARVE: a river crease crossing the spawn glade would carve the
  // lifted land back under the waterline — the guarantee holds on the FINAL effective surface (the
  // channel fords the glade). Same helper as raw_land; identity outside the skirt.
  {
    const sf = spawn_dry_floor(ctx.spawn_dry, world_x, world_z)
    if (eff < sf) eff = Math.floor(sf)
  }
  // GLACIAL §B.4 talus apron: raise the surface by a small slope-gated mound at the foot of steep faces
  // (scree deposits). 0 unless surface.scree_relief > 0 ⇒ byte-identical DEFAULT. Applied before the
  // density band + ground_top are keyed to `eff` so the mound is solid and lit consistently.
  if (ctx.surface.scree_relief > 0 && profile.slope !== null) {
    eff += Math.floor(scree_apron_delta(ctx.surface, profile.slope[ci]))
    if (eff > WORLD_HEIGHT - 2) eff = WORLD_HEIGHT - 2
  }

  profile.surface_y[ci] = eff
  profile.water_level[ci] = hydro.water_level
  profile.waterfall[ci] = hydro.is_waterfall ? 1 : 0
  profile.biome_id[ci] = biome.id
  profile.strata[ci * 4] = land_ids.surface
  profile.strata[ci * 4 + 1] = land_ids.subsurface
  profile.strata[ci * 4 + 2] = land_ids.underwater
  profile.strata[ci * 4 + 3] = land_ids.filler
  const dcol = build_density_column(ctx.density, eff, climate, world_x, world_z)
  profile.density[ci] = dcol
  profile.ground_top[ci] = resolve_ground_top(ctx.density, dcol, world_x, world_z)
  // GLACIAL §B.3 glacier ribbon surface material (per column — ice/moraine/crevasse/firn/rubble or -1).
  // Needs slope + pv, both available here; block_at applies it at the top voxel.
  if (profile.glacier !== null)
    profile.glacier[ci] = glacier_surface_block(
      ctx.glacier,
      eff,
      profile.slope !== null ? profile.slope[ci] : 0,
      climate.pv
    )
}

/**
 * Precomputes the surface height, biome, and strata block ids for every column in a chunk-column
 * footprint (the 32×32 XZ area at chunk coords cx,cz). Done once, reused by all 12 chunk records.
 * @param {GenContext} ctx
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @returns {ColumnProfile}
 */
export function build_column_profile(ctx, cx, cz) {
  const profile = create_column_profile(ctx, CHUNK_SIZE * CHUNK_SIZE)
  prime_column_footprint(ctx, cx, cz)

  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    const world_z = cz * CHUNK_SIZE + z
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const world_x = cx * CHUNK_SIZE + x
      fill_profile_column(ctx, profile, column_index(x, z), world_x, world_z)
    }
  }

  return profile
}

/**
 * A cardinal neighbor's land + river surface, for waterfall detection. Recomputes deterministically
 * from climate (region-local — never reads a stored neighbor chunk).
 * @param {GenContext} ctx
 * @param {number} world_x
 * @param {number} world_z
 * @returns {import('./hydrology.js').NeighborWater}
 */
function neighbor_water(ctx, world_x, world_z) {
  const climate = sample_climate(ctx.fields, world_x, world_z)
  const nland = raw_land(ctx, world_x, world_z, climate)
  return {
    land: nland,
    river_level: river_water_level(ctx.hydro, world_x, world_z, climate.continentalness, climate.pv, nland),
  }
}

/**
 * Highest GROUND-solid world-y for a column (first-air+1 from the top of the terrain, EXCLUDING sky
 * islands) — the light height oracle. For ungated columns the heightfield is monotonic so this is
 * just `surface_y`. For gated (overhang) columns an overhang lip can sit above `surface_y`, so we
 * scan the thin `[surface_y, band_high]` shell top-down for the highest solid. Cheap: only gated
 * columns pay the scan, and only ~band_blocks voxels. Sky islands (a separate altitude band) are
 * deliberately not scanned so they shade the render but never dark-out the ground below (§2.2).
 * @param {DensityContext} dctx
 * @param {DensityColumn} dcol
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number} highest solid ground world-y + 1 (first air), min = surface_y
 */
function resolve_ground_top(dctx, dcol, world_x, world_z) {
  if (dcol.gate <= 0) return dcol.surface_y // monotonic heightfield: top solid at surface_y-1
  for (let y = dcol.band_high; y >= dcol.surface_y; y -= 1) {
    if (is_solid_density(dctx, dcol, world_x, y, world_z)) return y + 1
  }
  return dcol.surface_y
}

/**
 * Picks the block id at a world voxel, from the unified 3D density field (§2.2). The field decides
 * SOLID vs air/void; the block PALETTE is chosen by depth below the column's nominal spline surface
 * (so overhang lips read as surface/subsurface, deep interior as filler, caves as air). Non-solid
 * voxels below sea level are water, else air.
 *
 * With overhangs a column is no longer monotonic (solid can sit above carved air) — so `is_solid`
 * is queried per voxel; `depth_from_surface` can be negative for an overhang lip (clamped to the
 * surface block) and huge-negative for a sky island (also surface block; strata refinement is
 * NG1-C). Below-surface non-solid voxels are caves.
 *
 * Water fills any non-solid voxel below the column's WATER LEVEL (hydrology, §4.4): sea level in the
 * ocean, a raised level over river channels/lakes, and the spill level down a waterfall face — so a
 * river threads the valley floor, a lake sits in its basin, and a fall stacks vertically down a lip.
 * TODO(WS-decorators, §4.6): trees/ores/clutter overwrite after solid fill.
 * @param {GenContext} ctx
 * @param {ColumnProfile} profile
 * @param {number} ci column_index
 * @param {number} world_x
 * @param {number} world_y
 * @param {number} world_z
 * @returns {number} block id
 */
function block_at(ctx, profile, ci, world_x, world_y, world_z) {
  const dctx = ctx.density
  const dcol = profile.density[ci]
  if (!is_solid_density(dctx, dcol, world_x, world_y, world_z)) {
    // FIVE-WORLDS ICEBERGS (Everest): buoyant ice masses override the empty ocean column near the
    // waterline (below-sea columns only, thin y band). Off in DEFAULT ⇒ enabled:false skips it.
    if (
      ctx.icebergs.enabled &&
      profile.surface_y[ci] <= ctx.sea_level &&
      world_y >= ctx.icebergs.y_low &&
      world_y <= ctx.icebergs.y_high
    ) {
      const ice = iceberg_block(ctx.icebergs, world_x, world_y, world_z)
      if (ice >= 0) return ice
    }
    // Air or void below the column's water level floods (ocean, river, lake, waterfall face); above
    // it is air. (Water is non-solid so it never enters the mesher's face masks.)
    return world_y < profile.water_level[ci] ? WATER : AIR
  }

  const s = ci * 4
  // Sky islands (Pandora, §2.2): a solid voxel ABOVE the terrain top (ground_top excludes sky islands
  // by design) on a sky-region column is FLOATING island rock — never continuous with the terrain
  // below. Its palette is depth-from-the-island's-own-top: a lush grass CRUST on the living top face,
  // STONE body + roots beneath. Crust iff open air lies within crust_depth blocks above (i.e. we're
  // near the island's top surface); else stone. Cheap: only the rare island voxels pay the short
  // upward scan, and only on has_sky columns.
  if (dcol.has_sky && world_y >= profile.ground_top[ci]) {
    const crust = dctx.sky.cfg.crust_depth
    for (let dy = 1; dy <= crust; dy += 1) {
      if (!is_solid_density(dctx, dcol, world_x, world_y + dy, world_z)) return ISLAND_CRUST
    }
    return STONE
  }

  const surface = profile.surface_y[ci]
  const depth_from_surface = surface - 1 - world_y // 0 = topmost solid at the nominal surface
  const submerged = surface <= ctx.sea_level // per-world waterline (Everest: 6 ⇒ y≈10 floors are DRY land)

  // GLACIAL §B.3 glacier ribbon (Everest): the flat trough floor's TOP block is ice/firn/moraine/crevasse/
  // rubble (per-column precomputed classifier). Wins over strata/snow on the valley floor. Off ⇒ glacier null.
  if (!submerged && depth_from_surface <= 0 && profile.glacier !== null) {
    const g = profile.glacier[ci]
    if (g >= 0) return g
  }

  // FIVE-WORLDS slope-driven surface stages (above the waterline, on steep/high exposed rock). Off in
  // DEFAULT (needs_slope false ⇒ profile.slope null) ⇒ these branches never run.
  if (!submerged && profile.slope !== null) {
    const slope = profile.slope[ci]
    // STRATA BANDING (Riviera): the whole exposed rock of a steep column reads as horizontal sedimentary
    // bands (a per-voxel band block by world-y). Overrides every depth so a cliff face shows strata.
    if (ctx.strata.enabled) {
      const banded = strata_band_block(ctx.strata, world_x, world_y, world_z, slope)
      if (banded >= 0) return banded
    }
    // SLOPE/SNOW SURFACE (Everest): the TOP block is snow / rock / ice / scree by the surface stage.
    // S-24 ALPINE PAINTER: snow-default, rock on steep faces (low-freq geology mask), ice above ice_line
    // (low-freq snow↔ice mask). GLACIAL §C snow_score (legacy) instead drives a speckle in sample0.
    if (ctx.surface.active && depth_from_surface <= 0) {
      const al = ctx.surface.alpine
      let sample0 = 0
      let sample1 = 0
      let sample2 = 0
      if (al.enabled) {
        sample0 = /** @type {import('../noise/sampler.js').FbmSampler} */ (al.rock_mask).sample(world_x, world_z)
        sample1 = /** @type {import('../noise/sampler.js').FbmSampler} */ (al.ice_mask).sample(world_x, world_z)
        if (al.sun_aspect > 0)
          sample2 = column_sun_dot(ctx, world_x, world_z, ctx.surface.slope_window, al.sun_dx, al.sun_dz)
      } else if (ctx.surface.snow_score.speckle !== null) {
        sample0 = ctx.surface.snow_score.speckle.sample(world_x, world_z)
      }
      const ice_delta = profile.region_ice !== null ? profile.region_ice[ci] : 0
      const surf = surface_by_slope_block(ctx.surface, world_y, slope, sample0, sample1, sample2, ice_delta)
      if (surf >= 0) return surf
    }
  }

  if (depth_from_surface <= 0) return submerged ? profile.strata[s + 2] : profile.strata[s]
  if (depth_from_surface <= SUBSURFACE_DEPTH) return profile.strata[s + 1]
  return profile.strata[s + 3]
}

/**
 * Fills one chunk record from a precomputed column profile; optionally defers lighting to a decorator.
 * @param {GenContext} ctx
 * @param {ColumnProfile} profile
 * @param {number} cx
 * @param {number} cy 0..CHUNKS_PER_COLUMN-1
 * @param {number} cz
 * @param {boolean} [should_light] false only when a caller will decorate then light the final voxels
 * @returns {ChunkRecord}
 */
export function fill_chunk_from_profile(ctx, profile, cx, cy, cz, should_light = true) {
  const chunk = create_chunk_record(cx, cy, cz)
  const base_world_y = cy * CHUNK_SIZE

  const base_world_x = cx * CHUNK_SIZE
  const base_world_z = cz * CHUNK_SIZE
  for (let z = 0; z < CHUNK_SIZE; z += 1) {
    const world_z = base_world_z + z
    for (let x = 0; x < CHUNK_SIZE; x += 1) {
      const world_x = base_world_x + x
      const ci = column_index(x, z)
      // Column height = topmost GROUND-solid world-y + 1 (first air above the terrain, overhang lips
      // included, sky islands excluded), floored at the water level so ocean/river/lake surfaces read
      // as lit sky in fill_simple_light (water_level ≥ SEA_LEVEL always). See resolve_ground_top.
      const column_top = Math.max(profile.ground_top[ci], profile.water_level[ci])
      chunk.height[column_index(x, z)] = column_top

      for (let y = 0; y < CHUNK_SIZE; y += 1) {
        const world_y = base_world_y + y
        const block_id = block_at(ctx, profile, ci, world_x, world_y, world_z)
        const li = local_index(x, y, z)
        chunk.ids[li] = block_id

        if (block_id !== AIR && is_solid(block_id)) {
          set_occupancy_bit(chunk, 0, y * CHUNK_SIZE + z, x, true)
          set_occupancy_bit(chunk, 1, x * CHUNK_SIZE + z, y, true)
          set_occupancy_bit(chunk, 2, x * CHUNK_SIZE + y, z, true)
        }
      }
    }
  }

  fill_biome_meta(ctx, chunk, profile, cx, cy, cz)
  if (should_light) fill_simple_light(chunk)
  chunk.stage = 'lit'
  chunk.dirty = true
  return chunk
}

/**
 * Writes the 8×8×8 biome meta grid for a chunk. Biome is a per-column (XZ) property, so every cell_y
 * in a column takes that column's dominant biome — sampled at the cell center (x,z = cell*4 + 2).
 * Additionally marks CAVERN ROOMS: a 4×4×4 cell whose center is inside a worley cavern gets the high
 * bit set (CAVERN_ROOM_META_FLAG) so the future cave decorator can find rooms (see caves.js meta
 * convention). Only cave-region columns pay the worley test (the cheap 2D gate guards it).
 * @param {GenContext} ctx
 * @param {ChunkRecord} chunk
 * @param {ColumnProfile} profile
 * @param {number} cx @param {number} cy @param {number} cz
 * @returns {void}
 */
function fill_biome_meta(ctx, chunk, profile, cx, cy, cz) {
  const { caves } = ctx.density
  for (let cell_z = 0; cell_z < 8; cell_z += 1) {
    for (let cell_x = 0; cell_x < 8; cell_x += 1) {
      const world_x = cx * CHUNK_SIZE + cell_x * 4 + 2
      const world_z = cz * CHUNK_SIZE + cell_z * 4 + 2
      const id = profile.biome_id[column_index(cell_x * 4 + 2, cell_z * 4 + 2)]
      const region = cave_region_at(caves, world_x, world_z)
      for (let cell_y = 0; cell_y < 8; cell_y += 1) {
        let meta = id
        if (region) {
          const world_y = cy * CHUNK_SIZE + cell_y * 4 + 2
          if (cavern_room_at(caves, world_x, world_y, world_z)) meta |= CAVERN_ROOM_META_FLAG
        }
        chunk.biome[meta_cell_index(cell_x, cell_y, cell_z)] = meta
      }
    }
  }
}

// Memoized solid-class check — drives occupancy (the mesher's face-cull input). Liquids (water)
// and foliage are deliberately NOT solid, so they never enter the binary-greedy masks.
/** @type {Map<number, boolean>} */
const SOLID_CACHE = new Map()
/**
 * @param {number} block_id
 * @returns {boolean}
 */
function is_solid(block_id) {
  const cached = SOLID_CACHE.get(block_id)
  if (cached !== undefined) return cached
  const solid = get_block_by_id(block_id)?.class === 'solid'
  SOLID_CACHE.set(block_id, solid)
  return solid
}

/**
 * Generates a FULL world column: all CHUNKS_PER_COLUMN stacked chunk records at (cx, *, cz),
 * sharing one column profile. This is the primary entry the streaming manager calls per XZ column.
 * @param {GenContext} ctx
 * @param {number} cx chunk x
 * @param {number} cz chunk z
 * @returns {ChunkRecord[]} length CHUNKS_PER_COLUMN, index = cy
 */
export function generate_column(ctx, cx, cz) {
  const profile = build_column_profile(ctx, cx, cz)
  /** @type {ChunkRecord[]} */
  const chunks = new Array(CHUNKS_PER_COLUMN)
  for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1) {
    chunks[cy] = fill_chunk_from_profile(ctx, profile, cx, cy, cz)
  }
  return chunks
}

/**
 * Generates ONE chunk at (cx, cy, cz). Convenience for callers that stream single chunks; builds
 * the column profile then fills just the requested cy. (Prefer `generate_column` when loading a
 * full vertical column — it shares the profile across all 12 chunks.)
 * @param {GenContext} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {ChunkRecord}
 */
export function generate_chunk(ctx, cx, cy, cz) {
  const profile = build_column_profile(ctx, cx, cz)
  return fill_chunk_from_profile(ctx, profile, cx, cy, cz)
}
