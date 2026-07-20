// Seeded world-generation context and pure per-column surface queries.

import { SEA_LEVEL, WORLD_HEIGHT, derive_world_seeds } from '../config/world_config.js'
import { DEFAULT_WORLD_GEN_CONFIG, resolve_world_config } from '../config/world_gen_config.js'
import { resolve_land_block_ids } from '../config/biome_registry.js'

import { create_field_set, sample_climate } from './noise/fields.js'
import { shape_column, compile_splines } from './terrain_shaper.js'
import { place_biome, place_biome_def, create_biome_context } from './biome_placer.js'
import { create_density_context } from './density.js'
import { create_erosion_carver, mountain_relief } from './carvers/erosion.js'
import { create_canyon_carver, canyon_depth, canyon_stage_depth } from './carvers/canyon.js'
import { create_strata_context } from './stages/strata.js'
import { create_surface_context } from './stages/surface_by_slope.js'
import { create_iceberg_context } from './stages/icebergs.js'
import { create_crag_context, crag_height_delta } from './stages/crag.js'
import { create_massif_context, massif_surface } from './stages/massif.js'
import { create_region_context, region_profile } from './stages/regions.js'
import { create_trough_context, trough_carve } from './stages/trough.js'
import { create_cirque_context, cirque_carve } from './stages/cirque.js'
import { create_glacier_context } from './stages/glacier.js'
import { create_hydrology_context, hydrology_column } from './hydrology.js'

/** @typedef {import('./noise/fields.js').FieldSet} FieldSet */
/** @typedef {import('./noise/fields.js').ClimateSample} ClimateSample */
/** @typedef {import('./density.js').DensityContext} DensityContext */

/**
 * @typedef {object} GenContext the per-world generation state, built once from a world recipe and
 *   reused for every column (holds the seeded field samplers so we don't rebuild noise per chunk).
 * @property {import('../config/world_gen_config.js').WorldGenConfig} config the world recipe this
 *   context was built from (the config-first single source of truth threaded into every gen module)
 * @property {import('./terrain_shaper.js').ShaperSplines} shaper the compiled Catmull-Rom spline
 *   tables for this world (from config.splines) — shape_column reads these, not a module constant
 * @property {import('./biome_placer.js').BiomeContext} placer config-first biome placement context
 *   (config.biomes + config.biome_selection) — a trimmed table pins the world to one biome family (§4.3)
 * @property {FieldSet} fields the six seeded climate/shape samplers (§4.1)
 * @property {DensityContext} density the seeded 3D density samplers (warp/ridged/caves/sky, §2.2)
 * @property {import('./carvers/erosion.js').ErosionCarver} erosion mountain erosion-look relief (NG1-B)
 * @property {import('./carvers/canyon.js').CanyonCarver} canyon inverted-ridge canyon carve (NG1-B)
 * @property {import('../config/world_gen_config.js').CanyonConfig} canyon_stage FIVE-WORLDS additive
 *   config-gated canyon stage params (deepens the baseline canyon when enabled; off ⇒ no extra carve)
 * @property {import('./stages/strata.js').StrataContext} strata FIVE-WORLDS strata banding (Riviera)
 * @property {import('./stages/surface_by_slope.js').SurfaceContext} surface FIVE-WORLDS slope/snow (Everest)
 * @property {import('./stages/icebergs.js').IcebergContext} icebergs FIVE-WORLDS ocean ice masses (Everest)
 * @property {import('./stages/crag.js').CragContext} crag GLACIAL §A crag/gully + micro spectrum repair
 * @property {import('./stages/massif.js').MassifContext} massif S-24 composite surface (Everest) — when
 *   enabled it OWNS raw_land (replaces the spline+erosion+canyon+trough composition); off ⇒ legacy path
 * @property {import('./stages/regions.js').RegionContext} regions S-25 sub-biome region layer (Everest) —
 *   a low-freq field partitioning a massif world into named terrain regions (taiga/glacier/peaks/…) that
 *   modulate the massif surface + pin the biome + shift the alpine ice-line; off ⇒ identity (parity)
 * @property {import('./stages/trough.js').TroughContext} trough GLACIAL §B.1 U-profile valley reshape
 * @property {import('./stages/cirque.js').CirqueContext} cirque GLACIAL §B.2 amphitheater scoops
 * @property {import('./stages/glacier.js').GlacierContext} glacier GLACIAL §B.3 glacier ribbon + moraines
 * @property {(x: number, z: number) => number} cirque_land_probe raw_land WITHOUT the cirque carve — the
 *   cirque stage's altitude gate at region-build time (no recursion). Built once per context.
 * @property {boolean} needs_slope any slope-driven stage on (strata / slope-snow / glacier) ⇒ profile computes slope
 * @property {import('./hydrology.js').HydrologyContext} hydro rivers/lakes/waterfalls (NG1-B §4.4)
 * @property {number} sea_level the world's waterline (config hydrology.sea_level, default SEA_LEVEL) — the
 *   SSOT for every "is this column underwater" test (block_at submerged, decorator land gate, heightmap)
 * @property {{ enabled: boolean, r2_core: number, r2_soft: number, floor_y: number, drop: number }} spawn_dry
 *   the spawn dry-floor guarantee: a radial land floor ≥ sea_level+margin around origin
 *   so the initial spawn region is never water-locked. Applied via spawn_dry_floor at every effective-surface
 *   home (raw_land + the post-carve eff in build_column_profile/anchor_surface). radius 0 ⇒ enabled:false.
 * @property {Record<string, number>} seeds the named sub-seeds (for carvers/structures later)
 */

/**
 * Builds a reusable generation context from a world recipe. Call once per gen-worker; pass the
 * result to every `generate_column`/`generate_chunk` call. Config-first (§2.3): the seed + climate
 * fields + splines + density + sky recipes all come from the passed WorldGenConfig, so a per-world
 * recipe deterministically drives generation. Back-compat: a bare seed STRING (or omitted) resolves
 * to the DEFAULT recipe with that seed — the shape the far-section worker / webgl fallback / tools
 * still pass. (Carvers + hydrology keep their own seeded constants for now — see BIOMES plan; those
 * blocks are declared not-yet-adopted.)
 * @param {import('../config/world_gen_config.js').WorldGenConfig | string} [config] world recipe or seed
 * @returns {GenContext}
 */
export function create_gen_context(config = DEFAULT_WORLD_GEN_CONFIG) {
  const resolved = resolve_world_config(config)
  const seeds = derive_world_seeds(resolved.seed)
  const strata = create_strata_context(resolved.strata)
  const surface = create_surface_context(resolved.surface, resolved.geometry?.world_height, seeds)
  // The world's WATERLINE — per-world (Everest drops it below its valley floors so a landlocked massif
  // never floods). Defaults to the SEA_LEVEL const, so every world that keeps 128 is byte-identical. This
  // is the SINGLE waterline every gen consumer reads (block_at submerged test, decorator land gate,
  // heightmap fallback), replacing the bare module-constant reads that assumed a fixed 128 for all worlds.
  const sea_level = resolved.hydrology?.sea_level ?? SEA_LEVEL
  const glacier = create_glacier_context(resolved.glacier, sea_level)
  // SPAWN DRY-FLOOR (every world's spawn region floor stays ≥ sea level — the
  // water-locked-spawn guarantee, a MECHANISM not a per-world hand-tune; find_open_spawn's spiral is the
  // last-resort net, never the primary). A radial land FLOOR around the world spawn anchor (origin —
  // embed_voxel pins zone_origin [0,0] for every session): land within `radius` of origin is lifted to at
  // least sea_level + `margin` (a dry glade/cay), then the floor DESCENDS over `falloff` until it stops
  // binding (a natural skirt back into the world's own terrain/sea). Identity wherever land is already
  // higher (max()), so every already-dry world is byte-identical near spawn EXCEPT columns that were wet.
  // Config-tunable per world via hydrology.spawn_dry { radius, falloff, margin }; radius 0 ⇒ off.
  const sd_cfg = resolved.hydrology?.spawn_dry
  const sd_radius = sd_cfg?.radius ?? 24
  const sd_falloff = sd_cfg?.falloff ?? 24
  const spawn_dry = {
    enabled: sd_radius > 0,
    r2_core: sd_radius * sd_radius,
    r2_soft: (sd_radius + sd_falloff) * (sd_radius + sd_falloff),
    floor_y: sea_level + (sd_cfg?.margin ?? 2),
    drop: sd_cfg?.drop ?? 24, // how far the floor sinks below floor_y across the falloff (the skirt)
  }
  /** @type {GenContext} */
  const ctx = {
    config: resolved,
    placer: create_biome_context(resolved.biomes, resolved.biome_selection),
    shaper: compile_splines(resolved.splines),
    fields: create_field_set(seeds, resolved.noise),
    density: create_density_context(seeds, resolved.density, resolved.sky),
    erosion: create_erosion_carver(seeds),
    canyon: create_canyon_carver(seeds),
    // FIVE-WORLDS + GLACIAL shared gated stages (all off in DEFAULT ⇒ byte-identical world).
    canyon_stage: resolved.carvers?.canyon,
    strata,
    surface,
    icebergs: create_iceberg_context(seeds, resolved.icebergs, sea_level),
    sea_level,
    crag: create_crag_context(resolved.crag, seeds),
    massif: create_massif_context(resolved.massif, seeds, resolved.geometry?.world_height),
    // S-25 sub-biome region layer (Everest): a low-freq field carving the massif world into named terrain
    // regions. Disabled/absent (every other world) ⇒ region_profile returns identity ⇒ byte-identical.
    regions: create_region_context(resolved.regions, resolved.biomes, resolved.seed),
    trough: create_trough_context(resolved.trough),
    cirque: create_cirque_context(resolved.cirque, seeds),
    glacier,
    cirque_land_probe: /** @type {(x: number, z: number) => number} */ (() => 0), // reassigned below
    needs_slope: strata.enabled || surface.active || glacier.enabled,
    hydro: create_hydrology_context(seeds, resolved.hydrology),
    spawn_dry,
    seeds,
  }
  // The cirque altitude gate needs the land surface WITHOUT the cirque carve (raw_land minus the cirque
  // stage) — bind it here so the closure captures the fully-built context (no recursion, built once).
  ctx.cirque_land_probe = (x, z) => raw_land_no_cirque(ctx, x, z, sample_climate(ctx.fields, x, z))
  return ctx
}

/**
 * The raw LAND surface world-y EXCLUDING the cirque scoop (before water): smooth spline + mountain
 * erosion-look ridgelines/gullies + GLACIAL §A crag/micro − canyon carve − GLACIAL §B.1 trough. This is
 * both the body of `raw_land` and the cirque stage's altitude gate (which cannot include its own carve).
 * Pure per-(x,z) (region-local). All GLACIAL terms are 0 when disabled ⇒ byte-identical DEFAULT.
 * @param {GenContext} ctx
 * @param {number} world_x
 * @param {number} world_z
 * @param {ClimateSample} climate the column's climate (avoids a re-sample when the caller has it)
 * @returns {number} raw land surface world-y (integer), cirque not yet applied
 */
function raw_land_no_cirque(ctx, world_x, world_z, climate) {
  // S-24 COMPOSITE SURFACE MODE (Everest): when the massif stage is on it OWNS the land surface — one
  // scale-coupled function (C trunk drainage + A ridge skeleton + B face erosion + micro anti-flat)
  // REPLACING the spline+mountain_relief+canyon+crag+trough composition, so no decorrelated ridge/carve
  // systems (mr, canyon) pollute it. Already integer + world-box-clamped. Off ⇒ enabled:false ⇒ the
  // legacy composition below runs unchanged (byte-identical DEFAULT + every non-massif world).
  if (ctx.massif.enabled) return massif_surface(ctx.massif, world_x, world_z, ctx.regions)
  const shaped = shape_column(climate, ctx.shaper)
  const mr = mountain_relief(ctx.erosion, world_x, world_z, climate.erosion, climate.pv)
  // GLACIAL §A crag/gully + micro spectrum repair (relief-damped; 0 when disabled ⇒ byte-identical).
  const cg = crag_height_delta(ctx.crag, world_x, world_z, shaped.relief)
  const cd = canyon_depth(ctx.canyon, world_x, world_z, climate.continentalness, climate.erosion, climate.pv)
  // FIVE-WORLDS additive canyon stage (0 when disabled ⇒ byte-identical DEFAULT).
  const cds = canyon_stage_depth(
    ctx.canyon,
    ctx.canyon_stage,
    world_x,
    world_z,
    climate.continentalness,
    climate.erosion,
    climate.pv
  )
  // GLACIAL §B.1 trough U-profile carve (0 when disabled).
  const tr = trough_carve(ctx.trough, climate.pv)
  // S-25+ SUB-BIOME REGION TERRAIN MODULATION on the CLASSIC spline path (all worlds use this
  // [realistic] technology, each to their own settings). The region field DRIVES terrain per world at the
  // world's OWN scale — no forced mountain primitive: `relief_scale` flattens (<1, toward the continental
  // base — lagoons/flats/marshes) or amplifies (>1 — headlands/dunes/karst) the RELIEF above base_y,
  // `roughness_scale` scales the erosion/crag jaggedness (smooth flats vs broken badlands), and
  // `height_bias` shifts a whole region (a sunken basin, a raised shelf). Gated on `drives_terrain` (a class
  // carries a terrain knob) so every biome-pin-only recipe + DEFAULT runs the EXACT legacy formula below ⇒
  // byte-identical (no unintended golden fork). base_y + (surface_y − base_y) is bit-exact surface_y at
  // relief_scale 1, so the modulated form degrades continuously to legacy.
  let land
  if (ctx.regions.drives_terrain) {
    const rp = region_profile(ctx.regions, world_x, world_z)
    land =
      shaped.base_y +
      (shaped.surface_y - shaped.base_y) * rp.relief_scale +
      (mr + cg) * rp.roughness_scale -
      cd -
      cds -
      tr +
      rp.height_bias
  } else {
    land = shaped.surface_y + mr + cg - cd - cds - tr
  }
  if (land < 2) land = 2
  if (land > WORLD_HEIGHT - 2) land = WORLD_HEIGHT - 2
  return Math.floor(land)
}

/**
 * The raw LAND surface world-y at a column — `raw_land_no_cirque` MINUS the GLACIAL §B.2 cirque scoop. The
 * cirque is applied last (it reads the pre-cirque surface as its altitude gate via ctx.cirque_land_probe,
 * so it must not feed itself). All-disabled (DEFAULT) ⇒ cg/tr/cirque all 0 ⇒ byte-identical to the legacy
 * spline+erosion−canyon land. Single source of truth for the effective land surface (slope probe, hydrology
 * neighbor probes, decorator anchors all route through here).
 * @param {GenContext} ctx @param {number} world_x @param {number} world_z @param {ClimateSample} climate
 * @returns {number} raw land surface world-y (integer)
 */
export function raw_land(ctx, world_x, world_z, climate) {
  const base = raw_land_no_cirque(ctx, world_x, world_z, climate)
  const cq = cirque_carve(ctx.cirque, world_x, world_z, ctx.cirque_land_probe)
  // SPAWN DRY-FLOOR: lift the land near the world spawn anchor to ≥ sea_level+margin (the water-locked-spawn
  // guarantee). Applied at the raw_land SSOT so slope probes, hydrology neighbor/lake probes, and decorator
  // anchors ALL see the lifted land (a lake never primes over the spawn glade). Identity where land is
  // already higher, and for every column beyond the skirt (one d² test on the hot path).
  const sf = spawn_dry_floor(ctx.spawn_dry, world_x, world_z)
  if (cq === 0 && sf < 0) return base
  let land = base - cq
  if (land < sf) land = sf
  if (land < 2) land = 2
  if (land > WORLD_HEIGHT - 2) land = WORLD_HEIGHT - 2
  return Math.floor(land)
}

/**
 * The spawn dry-floor's minimum land world-y at a column, or -1 when it does not bind (outside the skirt /
 * disabled). Core (d² ≤ r2_core): the full floor (sea_level + margin). Skirt (r2_core..r2_soft): the floor
 * descends smoothly by `drop` blocks (a polynomial smoothstep on the d² ramp — monotonic, sqrt-free, §3.7)
 * so the glade edge grades into the world's own terrain/seabed instead of a cliff. Pure arithmetic.
 * @param {GenContext['spawn_dry']} sd
 * @param {number} world_x @param {number} world_z
 * @returns {number} the floor world-y, or -1 (no bind)
 */
export function spawn_dry_floor(sd, world_x, world_z) {
  if (!sd.enabled) return -1
  const d2 = world_x * world_x + world_z * world_z
  if (d2 >= sd.r2_soft) return -1
  if (d2 <= sd.r2_core) return sd.floor_y
  const t = (d2 - sd.r2_core) / (sd.r2_soft - sd.r2_core)
  const s = t * t * (3 - 2 * t) // smoothstep, 0 at the core edge → 1 at the skirt edge
  return sd.floor_y - sd.drop * s
}

/**
 * Column slope (rise/run) at a world column — the max central-difference gradient over the two horizontal
 * axes of the RAW land surface, sampled at ±`window` blocks. Region-local + globally consistent (raw_land is
 * a pure function of world coords), so a column's slope is identical in every chunk that touches it. Only
 * computed when a slope-driven stage is on (strata / slope-snow) — the ColumnProfile leaves `slope` null
 * otherwise. `window` widens the finite difference so the S-24 alpine painter reads coherent FACE steepness
 * (couloirs/cliffs) instead of single-block micro spikes; default 1 ⇒ the legacy ±1 diff (byte-identical).
 * @param {GenContext} ctx @param {number} world_x @param {number} world_z @param {number} [window]
 * @returns {number} slope, blocks/block
 */
export function column_slope(ctx, world_x, world_z, window = 1) {
  const lxp = raw_land(ctx, world_x + window, world_z, sample_climate(ctx.fields, world_x + window, world_z))
  const lxm = raw_land(ctx, world_x - window, world_z, sample_climate(ctx.fields, world_x - window, world_z))
  const lzp = raw_land(ctx, world_x, world_z + window, sample_climate(ctx.fields, world_x, world_z + window))
  const lzm = raw_land(ctx, world_x, world_z - window, sample_climate(ctx.fields, world_x, world_z - window))
  const inv = 0.5 / window
  const gx = Math.abs(lxp - lxm) * inv
  const gz = Math.abs(lzp - lzm) * inv
  return gx > gz ? gx : gz
}

/**
 * S-24 SUN-ASPECT for the alpine painter — downhill·sun in [-1,1]. +1 ⇒ the column's face descends toward the
 * (fixed, horizontal) sun = the hot, sun-facing flank that wants LESS snow. Reuses the same ±window
 * RAW-land samples as column_slope; L1-normalized (abs + divide only — determinism-safe, NO sqrt/sin/cos at
 * sample time). Only called for the alpine world when sun_aspect > 0 ⇒ zero cost for every other world.
 * @param {GenContext} ctx @param {number} world_x @param {number} world_z @param {number} window
 * @param {number} sun_dx @param {number} sun_dz unit horizontal sun direction (world x/z)
 * @returns {number} downhill·sun in [-1,1]
 */
export function column_sun_dot(ctx, world_x, world_z, window, sun_dx, sun_dz) {
  const lxp = raw_land(ctx, world_x + window, world_z, sample_climate(ctx.fields, world_x + window, world_z))
  const lxm = raw_land(ctx, world_x - window, world_z, sample_climate(ctx.fields, world_x - window, world_z))
  const lzp = raw_land(ctx, world_x, world_z + window, sample_climate(ctx.fields, world_x, world_z + window))
  const lzm = raw_land(ctx, world_x, world_z - window, sample_climate(ctx.fields, world_x, world_z - window))
  const dh_x = lxm - lxp // downhill x (a slope faces the way it descends)
  const dh_z = lzm - lzp
  const l1 = Math.abs(dh_x) + Math.abs(dh_z)
  if (l1 < 1e-6) return 0
  const dot = (dh_x * sun_dx + dh_z * sun_dz) / l1
  return dot < -1 ? -1 : dot > 1 ? 1 : dot
}
/**
 * The dominant biome id at a world column — thin helper for spawn maps / far-field tinting that
 * don't need a full column fill.
 * @param {GenContext} ctx
 * @param {number} world_x
 * @param {number} world_z
 * @returns {number}
 */
export function biome_at(ctx, world_x, world_z) {
  const id = place_biome(sample_climate(ctx.fields, world_x, world_z), ctx.placer)
  // S-25: on a region world the dominant region class pins the biome, so far-field tint + spawn scans read
  // the SAME biome as the generated column. Off ⇒ regions disabled ⇒ climate placement (byte-identical).
  if (ctx.regions.enabled) {
    const rp = region_profile(ctx.regions, world_x, world_z)
    if (rp.biome_id >= 0) return rp.biome_id
  }
  return id
}

/**
 * @typedef {object} AnchorSurface the per-column data a decorator needs to anchor a schematic
 * @property {number} surface_y effective first-air surface world-y (schematic base sits here)
 * @property {number} biome_id dominant biome id at the column
 * @property {number} surface_block strata surface block id (grass/sand/snow/…) — the land-cover gate
 * @property {number} water_level sea/river water surface world-y (no lake priming) — water-anchor "is
 *   water present above this column" test (water_level > surface_y)
 */

/**
 * The effective decoration surface at ONE world column — the SINGLE SOURCE OF TRUTH the surface
 * decorator uses for EVERY schematic anchor, whether the anchor lands in the chunk being decorated
 * or in its cross-chunk halo. It reproduces `build_column_profile`'s per-column surface math exactly
 * (raw land = spline + mountain erosion − canyon, then − the river-channel carve) with `neighbors =
 * null` (waterfalls raise water level, never land, so they don't move where a tree's base sits), so a
 * schematic straddling a chunk border derives the identical base-y from every chunk it touches. Pure
 * per-(x,z), region-local, integer-floored — no stored neighbor reads. Cheap enough to call per halo
 * column on the fly (one climate sample + shape + two carver probes + one hydrology pass; no fill).
 * @param {GenContext} ctx
 * @param {number} world_x
 * @param {number} world_z
 * @returns {AnchorSurface}
 */
export function anchor_surface(ctx, world_x, world_z) {
  // MEMO: the GROUNDING probe (surface_decorator.grounded_placement) hits every column of a schematic's
  // base footprint, and neighbouring column halos re-probe the same columns — pure per (ctx, x, z), so
  // cache it. Bounded for streaming (cleared past a cap). Big win for wide rock footprints (100+ columns).
  const cache_owner = /** @type {{ _anchor_cache?: Map<number, AnchorSurface> }} */ (ctx)
  let cache = cache_owner._anchor_cache
  if (cache === undefined) {
    cache = new Map()
    cache_owner._anchor_cache = cache
  }
  const key = world_x * 4194304 + world_z // distinct for |x|,|z| < 2^21 (any realistic world)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const climate = sample_climate(ctx.fields, world_x, world_z)
  let biome = place_biome_def(climate, ctx.placer)
  // S-25 region pin (must MATCH build_column_profile so the decorator's biome — trees/rocks/species — follows
  // the region, not the near-degenerate climate placement). Off ⇒ regions disabled ⇒ climate biome (parity).
  if (ctx.regions.enabled) {
    const rp = region_profile(ctx.regions, world_x, world_z)
    if (rp.biome_id >= 0) {
      const pinned = ctx.placer.by_id.get(rp.biome_id)
      if (pinned) biome = pinned
    }
  }
  const land = raw_land(ctx, world_x, world_z, climate)
  // lake_level = -1: anchors consume only the river carve — lake water never moves land, so this
  // path needs no lake-tile priming (and stays callable for any halo column outside a primed tile).
  const hydro = hydrology_column(ctx.hydro, world_x, world_z, climate.continentalness, climate.pv, land, -1, null)
  let eff = land - Math.floor(hydro.carve)
  if (eff < 2) eff = 2
  // SPAWN DRY-FLOOR post-carve — MUST mirror build_column_profile exactly (the anchor contract above).
  {
    const sf = spawn_dry_floor(ctx.spawn_dry, world_x, world_z)
    if (eff < sf) eff = Math.floor(sf)
  }
  // water_level (sea/river, no lake priming here) so the decorator can test "is water ACTUALLY present above
  // this column" for water-anchor placement — a drained shelf below sea level has water_level <= surface_y.
  const result = {
    surface_y: eff,
    biome_id: biome.id,
    surface_block: resolve_land_block_ids(biome).surface,
    water_level: hydro.water_level,
  }
  if (cache.size > 262144) cache.clear() // bound memory during long streaming sessions
  cache.set(key, result)
  return result
}
