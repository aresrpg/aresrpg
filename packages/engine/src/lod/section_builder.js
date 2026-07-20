// Per-section downsample (§11 NG-LOD, survey S2) — the "fixed logical resolution" rule: every far
// section is ALWAYS 32×32 cells; only the world footprint grows per level (block size doubles
// L1=2m … L4=16m, so span = 32·2^L = 64/128/256/512 m, 2:1 between levels). This gives a hard,
// predictable per-section vertex/memory ceiling at every distance (survey S2).
//
// Two layers:
//   (1) build_section — a PURE, worker-friendly downsample of an injected column sampler into a
//       heightmap + dominant-block map (+ an optional sky-island shell layer). Deterministic: same
//       sampler ⇒ byte-identical section. Visual-only, so a bounded tap subsample per cell is a legal
//       approximation at coarse levels (SECTION_TAP_CAP); exact at L1/L2.
//   (2) create_world_column_sampler — the bridge to the READ-ONLY generator (column_gen.js): SPARSE
//       per-column taps of the real per-column gen body (ground_top / water_level / strata / sky-band
//       solidity) — only the tapped columns are ever computed (the far-fill lever).
//
// Downsample keeps the DH far-water rule (survey S14): where a column's water sits above its ground,
// the cell reads as opaque WATER at the water surface — far oceans/lakes render blue, not seabed.

import { CHUNK_SIZE, SEA_LEVEL } from '../config/world_config.js'
import { create_column_profile, fill_profile_column, prime_column_footprint } from '../gen/column_gen.js'
import { is_solid, DENSITY_CONFIG } from '../gen/density.js'
import { get_block_by_name } from '../config/block_registry.js'
import { get_biome_by_id } from '../config/biome_registry.js'
import { strata_band_block } from '../gen/stages/strata.js'
import { surface_by_slope_block } from '../gen/stages/surface_by_slope.js'

/** Cells per section edge — FIXED at every LOD level (survey S2); matches chunk width. */
export const CELLS_PER_SECTION = 32
/** Finest / coarsest far-LOD level (L1 = 2 m cells … L4 = 16 m cells). */
export const LOD_MIN_LEVEL = 1
export const LOD_MAX_LEVEL = 4
/** Max taps per cell edge — bounds downsample cost to ≤ CAP² samples/cell at any level. */
export const SECTION_TAP_CAP = 4

const WATER_ID = /** @type {number} */ (get_block_by_name('water')?.id)
/** Surface ids the CANOPY-AWARE far colour keys on (0 = block missing → the override no-ops). */
const GRASS_ID = get_block_by_name('grass')?.id ?? 0
const LEAVES_ID = get_block_by_name('leaves')?.id ?? 0
/** Biome tree-density (0..1) at/above which a grass column reads as FOREST in the far shell. Mirrors
 *  surface_decorator DECO_DEFAULTS.forest_tree_density (0.15) — the SAME gate the near ring uses to pick
 *  forest-floor over meadow — so near + far agree on "what is a forest" (kept as a mirrored constant to
 *  avoid importing the fenced decorator's private densities; this JSDoc is the linkage). */
const FAR_CANOPY_TREE_DENSITY = 0.15
/** Canopy height bump (m) added to a forest column's ground top so far forests carry a subtle raised
 *  silhouette (the schematics the ground heightmap can't see) instead of reading as bare floor. Small by
 *  design — the far shell is an approximation; the near ring's real tree tops meet it at the sunk seam. */
const FAR_CANOPY_BUMP_M = 4

/** Cell edge in meters (world blocks) at a level: 2^level. @param {number} level @returns {number} */
export function block_size_meters(level) {
  return 1 << level
}

/** Section world footprint edge in meters at a level (32·2^level). @param {number} level @returns {number} */
export function section_span_meters(level) {
  return CELLS_PER_SECTION * block_size_meters(level)
}

/**
 * @typedef {object} ColumnSample one world column's far-field summary.
 * @property {number} height top-of-column world-y (first air over ground OR the water surface)
 * @property {number} block_id dominant surface block id at that top (water where flooded)
 * @property {number} sky_top sky-island top world-y, 0 when the column has no sky island
 * @property {number} sky_block sky-island surface block id, 0 when none
 */
/** @typedef {(world_x:number, world_z:number) => ColumnSample} ColumnSampler */

/**
 * @typedef {object} Section a downsampled far-LOD tile — 32×32 cells, row-major (cz·32 + cx).
 * @property {number} level LOD level (LOD_MIN_LEVEL … LOD_MAX_LEVEL)
 * @property {number} sx section grid x at this level (world origin = sx·span)
 * @property {number} sz section grid z at this level
 * @property {number} block_size cell edge in meters (2^level)
 * @property {number} origin_x world-x of the section's min corner (meters)
 * @property {number} origin_z world-z of the section's min corner (meters)
 * @property {Uint16Array} height per-cell top-of-column world-y, length 1024
 * @property {Uint16Array} block per-cell dominant surface block id, length 1024
 * @property {number} min_height lowest cell height (skirt-floor hint for far_mesher)
 * @property {number} sky_cells count of cells carrying a sky island (0 ⇒ no sky layer)
 * @property {Uint16Array|null} sky_height per-cell sky-island top world-y (0 = none), or null
 * @property {Uint16Array|null} sky_block per-cell sky-island block id, or null
 */

/** Even integer tap offsets across a cell edge of `block_size` world columns.
 * @param {number} block_size @returns {Int32Array} */
function tap_offsets(block_size) {
  const k = Math.min(block_size, SECTION_TAP_CAP)
  const offs = new Int32Array(k)
  for (let i = 0; i < k; i += 1) offs[i] = Math.floor(((i + 0.5) * block_size) / k)
  return offs
}

/**
 * Statistical mode of `arr[0..n)` — most frequent id, ties broken toward the LOWEST id (so the
 * downsample is deterministic regardless of tap order). O(n²), n ≤ SECTION_TAP_CAP² = 16.
 * @param {Int32Array} arr @param {number} n @returns {number}
 */
function mode_of(arr, n) {
  if (n === 0) return 0
  let [best] = arr
  let best_count = 0
  for (let i = 0; i < n; i += 1) {
    let c = 0
    for (let j = 0; j < n; j += 1) if (arr[j] === arr[i]) c += 1
    if (c > best_count || (c === best_count && arr[i] < best)) {
      best_count = c
      best = arr[i]
    }
  }
  return best
}

/**
 * Downsamples one section from an injected column sampler. Pure + deterministic (a function of the
 * sampler's outputs only) — safe to run in a worker. The sky layer is allocated lazily and stays
 * null when the section's footprint holds no sky islands (the common case), keeping memory tight.
 * @param {ColumnSampler} sampler
 * @param {number} level LOD_MIN_LEVEL … LOD_MAX_LEVEL
 * @param {number} sx section grid x
 * @param {number} sz section grid z
 * @returns {Section}
 */
export function build_section(sampler, level, sx, sz) {
  const block_size = block_size_meters(level)
  const span = CELLS_PER_SECTION * block_size
  const origin_x = sx * span
  const origin_z = sz * span
  const cell_count = CELLS_PER_SECTION * CELLS_PER_SECTION
  const height = new Uint16Array(cell_count)
  const block = new Uint16Array(cell_count)
  /** @type {Uint16Array|null} */
  let sky_height = null
  /** @type {Uint16Array|null} */
  let sky_block = null
  let sky_cells = 0
  let min_height = 0xffff

  const offs = tap_offsets(block_size)
  const k = offs.length
  const ground_ids = new Int32Array(SECTION_TAP_CAP * SECTION_TAP_CAP)
  const sky_ids = new Int32Array(SECTION_TAP_CAP * SECTION_TAP_CAP)

  for (let cz = 0; cz < CELLS_PER_SECTION; cz += 1) {
    const cell_z0 = origin_z + cz * block_size
    for (let cx = 0; cx < CELLS_PER_SECTION; cx += 1) {
      const cell_x0 = origin_x + cx * block_size
      const ci = cz * CELLS_PER_SECTION + cx
      let max_h = 0
      let max_sky = 0
      let n = 0
      let sn = 0
      for (let tz = 0; tz < k; tz += 1) {
        for (let tx = 0; tx < k; tx += 1) {
          const s = sampler(cell_x0 + offs[tx], cell_z0 + offs[tz])
          if (s.height > max_h) max_h = s.height
          ground_ids[n] = s.block_id
          n += 1
          if (s.sky_top > 0) {
            if (s.sky_top > max_sky) max_sky = s.sky_top
            sky_ids[sn] = s.sky_block
            sn += 1
          }
        }
      }
      height[ci] = max_h
      block[ci] = mode_of(ground_ids, n)
      if (max_h < min_height) min_height = max_h
      if (max_sky > 0) {
        if (!sky_height || !sky_block) {
          sky_height = new Uint16Array(cell_count)
          sky_block = new Uint16Array(cell_count)
        }
        sky_height[ci] = max_sky
        sky_block[ci] = mode_of(sky_ids, sn)
        sky_cells += 1
      }
    }
  }
  if (min_height === 0xffff) min_height = 0

  return {
    level,
    sx,
    sz,
    block_size,
    origin_x,
    origin_z,
    height,
    block,
    min_height,
    sky_cells,
    sky_height,
    sky_block,
  }
}

/** Estimated resident bytes of a built section (typed arrays only) — for the perf report.
 * @param {Section} section @returns {number} */
export function section_bytes(section) {
  let bytes = section.height.byteLength + section.block.byteLength
  if (section.sky_height) bytes += section.sky_height.byteLength
  if (section.sky_block) bytes += section.sky_block.byteLength
  return bytes
}

// ---- World generator adapter (READ-ONLY bridge to column_gen.js) ---------------------------------

const SKY = DENSITY_CONFIG.sky
const SKY_TOP_Y = SKY.high_y + SKY.thickness
const SKY_BOTTOM_Y = SKY.low_y - SKY.thickness
/** Minimum AIR GAP (blocks) between a column's ground top and the bottom of a solid for it to count as
 *  a FLOATING sky island (not a ground overhang lip). The density config's sky band (with the sibling's
 *  large `thickness`) can dip its scan floor down INTO mountain-overhang territory (SKY_BOTTOM ≈ 184 vs
 *  peaks ~268), so a naive "highest solid in the band" mislabels a tall mountain's overhang as a sky
 *  island — and the far sky-slab skirt then drops from that bogus height to a low min, rendering a tall
 *  gray "monolith" hanging under nothing (reported). Requiring a real air gap above the ground
 *  keeps the sky layer to genuine floating islands. */
const SKY_ISLAND_MIN_GAP = 12

/**
 * Builds a deterministic ColumnSampler over the real generator for one gen context, computing ONLY
 * the tapped column — SPARSE per-column sampling (the far-fill lever): far sections read 64/chunk at
 * L4 and 256/chunk at L3 of a chunk's 1024 columns, so building whole chunk profiles per tap wasted
 * 94%/75% of the gen cost (L3+L4 ≈ 98% of the cold horizon fill). Each tap runs the SAME per-column
 * body the near ring runs (fill_profile_column — one home for gen truth, identical values by §3.7)
 * into a reused 1-cell profile scratch (the sample copies out plain numbers, so overwriting is safe);
 * region/lake caches are primed on chunk switch (no-op lookups when already primed — both caches are
 * pure, eviction-neutral memos, proven by the eviction golden in column_gen.test.js).
 *
 * Ground height + block come from the column's `ground_top` (sky islands excluded by design) and
 * strata, with the DH far-water swap (survey S14). The sky-island shell — which the ground heightmap
 * structurally cannot carry — is recovered by scanning the density field's sky band top-down via
 * `is_solid` (the ONLY channel that exposes it; see the sky-island note in the report).
 * @param {import('../gen/column_gen.js').GenContext} ctx
 * @returns {ColumnSampler}
 */
export function create_world_column_sampler(ctx) {
  const cell = create_column_profile(ctx, 1)
  let primed_cx = NaN
  let primed_cz = NaN

  return (world_x, world_z) => {
    const cx = Math.floor(world_x / CHUNK_SIZE)
    const cz = Math.floor(world_z / CHUNK_SIZE)
    if (cx !== primed_cx || cz !== primed_cz) {
      prime_column_footprint(ctx, cx, cz)
      primed_cx = cx
      primed_cz = cz
    }
    fill_profile_column(ctx, cell, 0, world_x, world_z)
    const p = cell
    const ci = 0
    const ground = p.ground_top[ci]
    const water = p.water_level[ci]
    const s4 = ci * 4

    let height
    let block_id
    if (water > ground) {
      height = water
      block_id = WATER_ID
    } else if (ground <= SEA_LEVEL) {
      height = ground
      block_id = p.strata[s4 + 2] // exposed lakebed/dry shelf keeps its underwater strata
    } else {
      height = ground
      block_id = p.strata[s4] // biome BASE surface (grass/sand/…)
      // [SSOT — the far shell must never paint green in the everest biome] Mirror block_at's TOP-block surface classification so
      // the far shell's colour derives from the SAME surface the near ring paints: FIVE-WORLDS strata
      // banding (Riviera cliffs) then the slope/snow override (Everest snow-cap / bare rock / scree). Without
      // this the shell honestly paints the biome BASE (grass) while the near voxels show snow → a green-vs-
      // white seam break. Exposed land only (submerged/flooded columns keep their strata, as block_at does).
      if (p.slope !== null) {
        const slope = p.slope[ci]
        if (ctx.strata.enabled) {
          const banded = strata_band_block(ctx.strata, world_x, ground, world_z, slope)
          if (banded >= 0) block_id = banded
        }
        if (ctx.surface.active) {
          const surf = surface_by_slope_block(ctx.surface, ground, slope)
          if (surf >= 0) block_id = surf
        }
      }

      // [CANOPY-AWARE FAR COLOUR — GLACIAL §D / ENG-21 — the LOD showed the wrong colour since the
      // heightmap carries no schematics] The far heightmap samples GROUND only (trees excluded), so a dense forest paints its
      // bare grass FLOOR — losing the dark-green canopy the near ring shows. Recover it cheaply: where the
      // near field grows a forest (the SAME gate the decorator uses — biome.tree_density ≥ the forest-floor
      // threshold) AND the column is still plantable GRASS (trees root only on grass, never the snow/rock/
      // scree the slope override may have just written), read the cell as the FOLIAGE family + a small
      // canopy bump so far forests read GREEN like the near ring. Config-true: default-world forests go
      // green, snow/rock/desert stays. ECOLOGY SEAM: when GLACIAL §D's tree_density(column) field lands
      // (stand_mask × altitude_falloff × slope_gate × shelter_bias), sample THAT here per column instead of
      // this flat biome-level gate — the far shell then gets real stands + clearings, not a uniform fill.
      if (LEAVES_ID > 0 && block_id === GRASS_ID) {
        const biome = get_biome_by_id(p.biome_id[ci])
        if (biome && biome.tree_density >= FAR_CANOPY_TREE_DENSITY) {
          block_id = LEAVES_ID
          height = ground + FAR_CANOPY_BUMP_M
        }
      }
    }

    // Sky-island shell: scan the sky band top-down for a FLOATING island's top. The scan floor can dip
    // into ground-overhang territory (see SKY_ISLAND_MIN_GAP), so we only accept a solid that sits a
    // real air gap ABOVE this column's ground top — a genuine floating island, never a mountain
    // overhang lip (which would render as a tall gray monolith). The scan stops descending at
    // ground_top + gap: anything below that is ground, not sky.
    let sky_top = 0
    let sky_block = 0
    const dcol = p.density[ci]
    const gap_floor = Math.max(SKY_BOTTOM_Y, ground + SKY_ISLAND_MIN_GAP)
    for (let y = SKY_TOP_Y; y >= gap_floor; y -= 1) {
      if (is_solid(ctx.density, dcol, world_x, y, world_z)) {
        sky_top = y + 1
        sky_block = p.strata[s4] // island crust reads as the column's surface strata (visual-only)
        break
      }
    }

    return { height, block_id, sky_top, sky_block }
  }
}
