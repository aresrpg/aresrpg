// World-gen config VALIDATION + IDENTITY HASH (lane NG1-E). Split from world_gen_config.js so the
// schema+defaults DATA and the validation+hash LOGIC each stay one concern (and well under the
// ≤600-LoC law). Pure, dependency-free, non-throwing.
//
//   validate_world_gen_config(config) → { ok, errors[] }  — structural + range checks (every problem
//     reported, not fail-fast, so an admin editor can surface them all at once).
//   config_hash(config) / config_hash_hex(config)          — stable u32 / 8-char-hex world-identity
//     fingerprint via canonical serialization (recursively sorted keys) so it is order-independent
//     and byte-identical across runs & machines. Integer-only FNV-1a (no transcendentals, no deps).
//     Any value change ⇒ a new hash ⇒ a world fork (§4).

/**
 * @typedef {import('./world_gen_config.js').WorldGenConfig} WorldGenConfig
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} ok true iff `errors` is empty
 * @property {string[]} errors human-readable problem descriptions (empty when ok)
 */

/**
 * Asserts `value` is a finite number in [min, max]; pushes to `errors` otherwise. Pure.
 * @param {string[]} errors accumulator
 * @param {string} path dotted config path for the message
 * @param {unknown} value
 * @param {number} min inclusive
 * @param {number} max inclusive
 * @returns {void}
 */
function check_range(errors, path, value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}: expected a finite number, got ${JSON.stringify(value)}`)
    return
  }
  if (value < min || value > max) {
    errors.push(`${path}: ${value} out of range [${min}, ${max}]`)
  }
}

/**
 * Asserts `value` is an integer in [min, max]; pushes otherwise. Pure.
 * @param {string[]} errors accumulator
 * @param {string} path dotted config path
 * @param {unknown} value
 * @param {number} min inclusive
 * @param {number} max inclusive
 * @returns {void}
 */
function check_int(errors, path, value, min, max) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`${path}: expected an integer, got ${JSON.stringify(value)}`)
    return
  }
  check_range(errors, path, value, min, max)
}

/**
 * Validates one noise field (period > 0, octaves int >= 1, optional spread/gain/amp/offset).
 * @param {string[]} errors accumulator
 * @param {string} path dotted path (e.g. "noise.temperature")
 * @param {unknown} field candidate NoiseFieldConfig
 * @returns {void}
 */
function validate_noise_field(errors, path, field) {
  if (field === null || typeof field !== 'object') {
    errors.push(`${path}: expected an object`)
    return
  }
  const f = /** @type {Record<string, unknown>} */ (field)
  check_range(errors, `${path}.period`, f.period, 1, 1_000_000)
  check_int(errors, `${path}.octaves`, f.octaves, 1, 16)
  if (f.spread !== undefined) check_range(errors, `${path}.spread`, f.spread, 1, 8)
  if (f.gain !== undefined) check_range(errors, `${path}.gain`, f.gain, 0, 1)
  if (f.amp !== undefined) check_range(errors, `${path}.amp`, f.amp, 0, 100_000)
}

/**
 * Validates a spline table: array of >= 2 [x, y] knots with x strictly ascending in [0,1].
 * @param {string[]} errors accumulator
 * @param {string} path dotted path (e.g. "splines.pv_to_relief")
 * @param {unknown} table candidate SplineKnot[]
 * @returns {void}
 */
function validate_spline(errors, path, table) {
  if (!Array.isArray(table) || table.length < 2) {
    errors.push(`${path}: expected an array of >= 2 [x, y] knots`)
    return
  }
  let prev_x = -Infinity
  for (let i = 0; i < table.length; i += 1) {
    const knot = table[i]
    if (!Array.isArray(knot) || knot.length !== 2) {
      errors.push(`${path}[${i}]: expected a [x, y] pair`)
      continue
    }
    const [x, y] = knot
    check_range(errors, `${path}[${i}].x`, x, 0, 1)
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      errors.push(`${path}[${i}].y: expected a finite number, got ${JSON.stringify(y)}`)
    }
    if (typeof x === 'number' && x <= prev_x) {
      errors.push(`${path}[${i}].x: ${x} not strictly ascending (prev ${prev_x})`)
    }
    if (typeof x === 'number') prev_x = x
  }
}

/**
 * Structurally + range-validates a world-gen config. Pure, non-throwing — returns every problem so
 * an editor can show them all. Load-bearing invariants: required top-level sections present; seed
 * non-empty; version a positive integer; every noise field well-formed; splines monotone; sea level
 * inside the world box; biome ids unique + in [0,255] (Uint8-persisted, §3.4); climate axes in [0,1];
 * ordered bands (beach/sky/slope); positive decoration denominators.
 * @param {unknown} config the candidate WorldGenConfig
 * @returns {ValidationResult}
 */
export function validate_world_gen_config(config) {
  /** @type {string[]} */
  const errors = []

  if (config === null || typeof config !== 'object') {
    return { ok: false, errors: ['config: expected an object'] }
  }
  const c = /** @type {Record<string, any>} */ (config)

  // ---- seed + version ----
  if (typeof c.seed !== 'string' || c.seed.length === 0) {
    errors.push('seed: expected a non-empty string')
  }
  check_int(errors, 'version', c.version, 1, 2_147_483_647)

  // ---- required top-level sections ----
  const required = [
    'geometry',
    'noise',
    'splines',
    'density',
    'carvers',
    'hydrology',
    'strata',
    'surface',
    'sky',
    'biome_selection',
    'biomes',
    'decoration',
  ]
  for (const key of required) {
    if (c[key] === null || c[key] === undefined) errors.push(`${key}: required section missing`)
  }

  // ---- geometry ----
  if (c.geometry) {
    check_int(errors, 'geometry.chunk_size', c.geometry.chunk_size, 1, 1024)
    check_int(errors, 'geometry.world_height', c.geometry.world_height, 1, 65_536)
  }
  const world_height = c.geometry && typeof c.geometry.world_height === 'number' ? c.geometry.world_height : 384

  // ---- noise fields (the 5 LIVE climate fields, all present + well-formed) ----
  if (c.noise) {
    const fields = ['temperature', 'humidity', 'continentalness', 'erosion', 'weirdness']
    for (const name of fields) {
      if (c.noise[name] === undefined) errors.push(`noise.${name}: required field missing`)
      else validate_noise_field(errors, `noise.${name}`, c.noise[name])
    }
  }

  // ---- splines ----
  if (c.splines) {
    validate_spline(errors, 'splines.continentalness_to_base', c.splines.continentalness_to_base)
    validate_spline(errors, 'splines.erosion_to_amplitude', c.splines.erosion_to_amplitude)
    validate_spline(errors, 'splines.pv_to_relief', c.splines.pv_to_relief)
  }

  // ---- density (band + hard floor + warp/detail noise bands + overhang gate) ----
  if (c.density) {
    check_range(errors, 'density.band_blocks', c.density.band_blocks, 0, 256)
    check_range(errors, 'density.hard_floor_y', c.density.hard_floor_y, 0, world_height)
    for (const band of ['warp', 'detail']) {
      const b = c.density[band]
      if (b) {
        check_range(errors, `density.${band}.period`, b.period, 1, 1_000_000)
        check_int(errors, `density.${band}.octaves`, b.octaves, 1, 16)
        check_range(errors, `density.${band}.amp`, b.amp, 0, 100_000)
      } else errors.push(`density.${band}: required`)
    }
    if (c.density.overhang) {
      check_range(errors, 'density.overhang.erosion_max', c.density.overhang.erosion_max, 0, 1)
      check_range(errors, 'density.overhang.pv_min', c.density.overhang.pv_min, 0, 1)
      check_range(errors, 'density.overhang.strength', c.density.overhang.strength, 0, 100)
    } else errors.push('density.overhang: required')
  }

  // ---- hydrology (sea level inside the world box; river/lake/waterfall recipe; beach band ordered) ----
  if (c.hydrology) {
    check_int(errors, 'hydrology.sea_level', c.hydrology.sea_level, 0, world_height)
    if (c.hydrology.river) {
      const rv = c.hydrology.river
      for (const band of ['crease', 'warp']) {
        const b = rv[band]
        if (b) {
          check_range(errors, `hydrology.river.${band}.period`, b.period, 1, 1_000_000)
          check_int(errors, `hydrology.river.${band}.octaves`, b.octaves, 1, 16)
        } else errors.push(`hydrology.river.${band}: required`)
      }
      check_range(errors, 'hydrology.river.width', rv.width, 0, 1)
      check_range(errors, 'hydrology.river.depth', rv.depth, 0, world_height)
      check_range(errors, 'hydrology.river.bank', rv.bank, 0, world_height)
      check_range(errors, 'hydrology.river.continentalness_min', rv.continentalness_min, 0, 1)
      check_range(errors, 'hydrology.river.pv_max', rv.pv_max, 0, 1)
    }
    if (c.hydrology.lake) {
      const lk = c.hydrology.lake
      check_range(errors, 'hydrology.lake.period', lk.period, 1, 1_000_000)
      check_int(errors, 'hydrology.lake.octaves', lk.octaves, 1, 16)
      check_range(errors, 'hydrology.lake.threshold', lk.threshold, 0, 1)
      check_range(errors, 'hydrology.lake.erosion_min', lk.erosion_min, 0, 1)
      check_range(errors, 'hydrology.lake.pv_max', lk.pv_max, 0, 1)
      check_int(errors, 'hydrology.lake.min_body_depth', lk.min_body_depth, 0, world_height)
    }
    if (c.hydrology.waterfall) {
      const wf = c.hydrology.waterfall
      check_int(errors, 'hydrology.waterfall.min_drop', wf.min_drop, 0, world_height)
      check_int(errors, 'hydrology.waterfall.fall_max', wf.fall_max, 0, world_height)
      check_int(errors, 'hydrology.waterfall.cascade_drop', wf.cascade_drop, 0, world_height)
    }
    // OPTIONAL spawn dry-floor override (water-locked-spawn guarantee). Absent ⇒ code
    // defaults apply (column_gen create_gen_context); present ⇒ each provided knob sane. radius 0 = opt-out.
    if (c.hydrology.spawn_dry) {
      const sdry = c.hydrology.spawn_dry
      if (sdry.radius !== undefined) check_int(errors, 'hydrology.spawn_dry.radius', sdry.radius, 0, 512)
      if (sdry.falloff !== undefined) check_int(errors, 'hydrology.spawn_dry.falloff', sdry.falloff, 0, 512)
      if (sdry.margin !== undefined) check_int(errors, 'hydrology.spawn_dry.margin', sdry.margin, 0, 64)
      if (sdry.drop !== undefined) check_int(errors, 'hydrology.spawn_dry.drop', sdry.drop, 0, 256)
    }
    if (c.hydrology.beach) {
      const b = c.hydrology.beach
      check_int(errors, 'hydrology.beach.band_low', b.band_low, 0, world_height)
      check_int(errors, 'hydrology.beach.band_high', b.band_high, 0, world_height)
      check_int(errors, 'hydrology.beach.flat_y', b.flat_y, 0, world_height)
      if (typeof b.band_low === 'number' && typeof b.band_high === 'number' && b.band_low > b.band_high) {
        errors.push(`hydrology.beach: band_low ${b.band_low} > band_high ${b.band_high}`)
      }
    }
  }

  // ---- surface (slope thresholds ordered; FIVE-WORLDS treeline within the world box) ----
  if (c.surface) {
    check_range(errors, 'surface.snow_line', c.surface.snow_line, 0, world_height)
    check_range(errors, 'surface.steep_slope', c.surface.steep_slope, 0, 100)
    check_range(errors, 'surface.grass_slope', c.surface.grass_slope, 0, 100)
    if (
      typeof c.surface.grass_slope === 'number' &&
      typeof c.surface.steep_slope === 'number' &&
      c.surface.grass_slope > c.surface.steep_slope
    ) {
      errors.push(`surface: grass_slope ${c.surface.grass_slope} > steep_slope ${c.surface.steep_slope}`)
    }
    if (c.surface.treeline !== undefined) check_int(errors, 'surface.treeline', c.surface.treeline, 0, world_height)
    if (c.surface.scree_relief !== undefined)
      check_range(errors, 'surface.scree_relief', c.surface.scree_relief, 0, world_height)
    // GLACIAL §C snow-score field (altitude band ordered; positive speckle; probability threshold).
    const ss = c.surface.snow_score
    if (ss) {
      check_int(errors, 'surface.snow_score.band_low', ss.band_low, 0, world_height)
      check_int(errors, 'surface.snow_score.band_high', ss.band_high, 0, world_height)
      if (typeof ss.band_low === 'number' && typeof ss.band_high === 'number' && ss.band_low > ss.band_high) {
        errors.push(`surface.snow_score: band_low ${ss.band_low} > band_high ${ss.band_high}`)
      }
      check_range(errors, 'surface.snow_score.slope_max', ss.slope_max, 0.0001, 100)
      check_range(errors, 'surface.snow_score.speckle_period', ss.speckle_period, 1, 1_000_000)
      check_int(errors, 'surface.snow_score.speckle_octaves', ss.speckle_octaves, 1, 16)
      check_range(errors, 'surface.snow_score.speckle_amp', ss.speckle_amp, 0, 100)
      check_range(errors, 'surface.snow_score.threshold', ss.threshold, -100, 100)
    }
    // S-24 alpine painter (snow_floor ≤ ice_line ordered; coherence in [0,1]; positive mask periods).
    const al = c.surface.alpine
    if (al) {
      check_int(errors, 'surface.alpine.snow_floor', al.snow_floor, 0, world_height)
      check_int(errors, 'surface.alpine.ice_line', al.ice_line, 0, world_height)
      if (typeof al.snow_floor === 'number' && typeof al.ice_line === 'number' && al.snow_floor > al.ice_line) {
        errors.push(`surface.alpine: snow_floor ${al.snow_floor} > ice_line ${al.ice_line}`)
      }
      check_range(errors, 'surface.alpine.rock_slope', al.rock_slope, 0.0001, 100)
      check_range(errors, 'surface.alpine.rock_coherence', al.rock_coherence, 0, 1)
      check_range(errors, 'surface.alpine.ice_blend', al.ice_blend, 0, world_height)
      if (al.rock_mask_period !== undefined)
        check_range(errors, 'surface.alpine.rock_mask_period', al.rock_mask_period, 1, 1_000_000)
      if (al.rock_mask_octaves !== undefined)
        check_int(errors, 'surface.alpine.rock_mask_octaves', al.rock_mask_octaves, 1, 16)
      if (al.ice_mask_period !== undefined)
        check_range(errors, 'surface.alpine.ice_mask_period', al.ice_mask_period, 1, 1_000_000)
      if (al.ice_mask_octaves !== undefined)
        check_int(errors, 'surface.alpine.ice_mask_octaves', al.ice_mask_octaves, 1, 16)
      if (al.slope_window !== undefined) check_int(errors, 'surface.alpine.slope_window', al.slope_window, 1, 64)
    }
  }

  // ---- strata (FIVE-WORLDS elevation banding; positive band height, non-empty palette) ----
  if (c.strata) {
    check_range(errors, 'strata.band_height', c.strata.band_height, 1, world_height)
    check_range(errors, 'strata.band_jitter', c.strata.band_jitter, 0, world_height)
    check_range(errors, 'strata.slope_gate', c.strata.slope_gate, 0, 100)
    check_int(errors, 'strata.subsurface_depth', c.strata.subsurface_depth, 0, world_height)
    if (!Array.isArray(c.strata.palette) || c.strata.palette.length === 0) {
      errors.push('strata.palette: expected a non-empty array of block names')
    }
  }

  // ---- icebergs (FIVE-WORLDS Everest ocean ice; region gate + blob/anchor params) ----
  if (c.icebergs) {
    check_range(errors, 'icebergs.region_size', c.icebergs.region_size, 1, 1_000_000)
    check_range(errors, 'icebergs.region_rate', c.icebergs.region_rate, 0, 1)
    check_int(errors, 'icebergs.blobs_min', c.icebergs.blobs_min, 0, 1024)
    check_int(errors, 'icebergs.blobs_max', c.icebergs.blobs_max, 0, 1024)
    if (
      typeof c.icebergs.blobs_min === 'number' &&
      typeof c.icebergs.blobs_max === 'number' &&
      c.icebergs.blobs_min > c.icebergs.blobs_max
    ) {
      errors.push(`icebergs: blobs_min ${c.icebergs.blobs_min} > blobs_max ${c.icebergs.blobs_max}`)
    }
    check_range(errors, 'icebergs.radius_min', c.icebergs.radius_min, 1, 100_000)
    check_range(errors, 'icebergs.radius_max', c.icebergs.radius_max, 1, 100_000)
    if (
      typeof c.icebergs.radius_min === 'number' &&
      typeof c.icebergs.radius_max === 'number' &&
      c.icebergs.radius_min > c.icebergs.radius_max
    ) {
      errors.push(`icebergs: radius_min ${c.icebergs.radius_min} > radius_max ${c.icebergs.radius_max}`)
    }
    check_range(errors, 'icebergs.freeboard', c.icebergs.freeboard, 0, 100)
    check_range(errors, 'icebergs.draft', c.icebergs.draft, 0, 100)
  }

  // ---- RELIEF LADDER (crag band + base ridge network + roll + micro; relief ramp params) ----
  // base_*/roll_* are OPTIONAL (pre-ladder blobs omit them; the stage defaults their amps to 0).
  if (c.crag) {
    check_range(errors, 'crag.band_period', c.crag.band_period, 1, 1_000_000)
    check_int(errors, 'crag.band_octaves', c.crag.band_octaves, 1, 16)
    check_range(errors, 'crag.band_amp', c.crag.band_amp, 0, world_height)
    if (c.crag.base_period !== undefined) check_range(errors, 'crag.base_period', c.crag.base_period, 1, 1_000_000)
    if (c.crag.base_octaves !== undefined) check_int(errors, 'crag.base_octaves', c.crag.base_octaves, 1, 16)
    if (c.crag.base_amp !== undefined) check_range(errors, 'crag.base_amp', c.crag.base_amp, 0, world_height)
    if (c.crag.roll_period !== undefined) check_range(errors, 'crag.roll_period', c.crag.roll_period, 1, 1_000_000)
    if (c.crag.roll_octaves !== undefined) check_int(errors, 'crag.roll_octaves', c.crag.roll_octaves, 1, 16)
    if (c.crag.roll_amp !== undefined) check_range(errors, 'crag.roll_amp', c.crag.roll_amp, 0, world_height)
    check_range(errors, 'crag.micro_period', c.crag.micro_period, 1, 1_000_000)
    check_int(errors, 'crag.micro_octaves', c.crag.micro_octaves, 1, 16)
    check_range(errors, 'crag.micro_amp', c.crag.micro_amp, 0, world_height)
    check_range(errors, 'crag.relief_floor', c.crag.relief_floor, 0, 1)
    check_range(errors, 'crag.relief_gain', c.crag.relief_gain, 0.0001, 4)
    // FLAT-SMOOTH thresholds (relief can be negative — the pv-relief floor — so the low bound is -1).
    if (c.crag.flat_lo !== undefined) check_range(errors, 'crag.flat_lo', c.crag.flat_lo, -1, 1)
    if (c.crag.flat_hi !== undefined) check_range(errors, 'crag.flat_hi', c.crag.flat_hi, -1, 1)
  }

  // ---- S-24 COMPOSITE SURFACE (massif) — floor below the summit; contrast windows + face mask ordered.
  // All knobs OPTIONAL (the stage defaults each); validated only when present (Everest).
  if (c.massif) {
    check_int(errors, 'massif.floor', c.massif.floor, 0, world_height)
    check_range(errors, 'massif.span', c.massif.span, 1, world_height)
    if (
      typeof c.massif.floor === 'number' &&
      typeof c.massif.span === 'number' &&
      c.massif.floor + c.massif.span > world_height
    ) {
      errors.push(
        `massif: floor ${c.massif.floor} + span ${c.massif.span} > world_height ${world_height} (summit clips the box)`
      )
    }
    for (const [key, lo, hi] of /** @type {[string, number, number][]} */ ([
      ['trunk_warp_period', 1, 1_000_000],
      ['trunk_warp_amp', 0, 100_000],
      ['trunk_period', 1, 1_000_000],
      ['env_lo', 0, 1],
      ['env_hi', 0, 1],
      ['skel_warp_period', 1, 1_000_000],
      ['skel_warp_amp', 0, 100_000],
      ['skel_period', 1, 1_000_000],
      ['skel_lo', 0, 1],
      ['skel_hi', 0, 1],
      ['shoulder', 0, 1],
      ['ero_period', 1, 1_000_000],
      ['ero_damp', 0, 100_000],
      ['ero_amp', 0, world_height],
      ['ero_face_lo', 0, 1],
      ['ero_face_hi', 0, 1],
      ['ero_crest_fade', 0, 1],
      ['micro_period', 1, 1_000_000],
      ['micro_amp', 0, world_height],
    ]))
      if (c.massif[key] !== undefined) check_range(errors, `massif.${key}`, c.massif[key], lo, hi)
    for (const key of ['trunk_octaves', 'skel_octaves', 'ero_octaves']) {
      if (c.massif[key] !== undefined) check_int(errors, `massif.${key}`, c.massif[key], 1, 16)
    }
    if (
      typeof c.massif.env_lo === 'number' &&
      typeof c.massif.env_hi === 'number' &&
      c.massif.env_lo >= c.massif.env_hi
    ) {
      errors.push(`massif: env_lo ${c.massif.env_lo} >= env_hi ${c.massif.env_hi}`)
    }
  }

  // ---- S-25 SUB-BIOME REGION LAYER (regions) — OPTIONAL (everest-only today). Field/warp/variance periods
  // positive; blend in [0,1]; a non-empty class list with strictly-ascending `upto` in [0,1.5]; per-class
  // scales non-negative. Biome-name resolution is checked at gen time (needs the world table); here it's a
  // non-empty string. When absent ⇒ identity ⇒ byte-identical world. ----
  if (c.regions !== undefined && c.regions !== null) {
    const rg = c.regions
    if (typeof rg !== 'object' || Array.isArray(rg)) {
      errors.push('regions: expected an object { enabled, classes, … }')
    } else {
      if (rg.enabled !== undefined && typeof rg.enabled !== 'boolean')
        errors.push('regions.enabled: expected a boolean')
      if (rg.field !== undefined) {
        check_range(errors, 'regions.field.period', rg.field?.period, 1, 1_000_000)
        if (rg.field?.octaves !== undefined) check_int(errors, 'regions.field.octaves', rg.field.octaves, 1, 16)
      }
      if (rg.warp !== undefined) {
        check_range(errors, 'regions.warp.period', rg.warp?.period, 1, 1_000_000)
        if (rg.warp?.octaves !== undefined) check_int(errors, 'regions.warp.octaves', rg.warp.octaves, 1, 16)
        check_range(errors, 'regions.warp.amp', rg.warp?.amp, 0, 100_000)
      }
      if (rg.blend !== undefined) check_range(errors, 'regions.blend', rg.blend, 0, 1)
      if (rg.variance !== undefined && rg.variance !== null) {
        const v = rg.variance
        if (v.period !== undefined) check_range(errors, 'regions.variance.period', v.period, 1, 1_000_000)
        if (v.octaves !== undefined) check_int(errors, 'regions.variance.octaves', v.octaves, 1, 16)
        for (const key of ['relief', 'rough', 'bias', 'ice'])
          if (v[key] !== undefined) check_range(errors, `regions.variance.${key}`, v[key], -1_000_000, 1_000_000)
      }
      // classes: required when the layer is enabled; strictly-ascending `upto` bands.
      if (rg.enabled === true && (!Array.isArray(rg.classes) || rg.classes.length === 0)) {
        errors.push('regions.classes: expected a non-empty array when regions.enabled')
      }
      if (Array.isArray(rg.classes)) {
        let prev_upto = -Infinity
        for (let i = 0; i < rg.classes.length; i += 1) {
          const cl = rg.classes[i]
          if (cl === null || typeof cl !== 'object') {
            errors.push(`regions.classes[${i}]: expected an object`)
            continue
          }
          if (typeof cl.name !== 'string' || cl.name.length === 0)
            errors.push(`regions.classes[${i}].name: expected a non-empty string`)
          check_range(errors, `regions.classes[${i}].upto`, cl.upto, 0, 1.5)
          if (typeof cl.upto === 'number' && cl.upto <= prev_upto)
            errors.push(`regions.classes[${i}].upto: ${cl.upto} not strictly ascending (prev ${prev_upto})`)
          if (typeof cl.upto === 'number') prev_upto = cl.upto
          if (cl.biome !== undefined && (typeof cl.biome !== 'string' || cl.biome.length === 0))
            errors.push(`regions.classes[${i}].biome: expected a non-empty biome name`)
          if (cl.relief_scale !== undefined)
            check_range(errors, `regions.classes[${i}].relief_scale`, cl.relief_scale, 0, 100)
          if (cl.height_bias !== undefined)
            check_range(errors, `regions.classes[${i}].height_bias`, cl.height_bias, -world_height, world_height)
          if (cl.roughness_scale !== undefined)
            check_range(errors, `regions.classes[${i}].roughness_scale`, cl.roughness_scale, 0, 100)
          if (cl.ice_line_delta !== undefined)
            check_range(errors, `regions.classes[${i}].ice_line_delta`, cl.ice_line_delta, -world_height, world_height)
        }
      }
    }
  }

  // ---- GLACIAL §B.1 trough (positive depth; flat-floor pv strictly below wall pv) ----
  if (c.trough) {
    check_range(errors, 'trough.depth', c.trough.depth, 0, world_height)
    check_range(errors, 'trough.floor_pv', c.trough.floor_pv, 0, 1)
    check_range(errors, 'trough.wall_pv', c.trough.wall_pv, 0, 1)
    if (
      typeof c.trough.floor_pv === 'number' &&
      typeof c.trough.wall_pv === 'number' &&
      c.trough.floor_pv >= c.trough.wall_pv
    ) {
      errors.push(`trough: floor_pv ${c.trough.floor_pv} >= wall_pv ${c.trough.wall_pv}`)
    }
  }

  // ---- GLACIAL §B.2 cirque (region gate; radius/floor ordering; altitude within the world box) ----
  if (c.cirque) {
    check_range(errors, 'cirque.region_size', c.cirque.region_size, 1, 1_000_000)
    check_range(errors, 'cirque.region_rate', c.cirque.region_rate, 0, 1)
    check_int(errors, 'cirque.per_region', c.cirque.per_region, 0, 1024)
    check_range(errors, 'cirque.radius_min', c.cirque.radius_min, 1, 100_000)
    check_range(errors, 'cirque.radius_max', c.cirque.radius_max, 1, 100_000)
    if (
      typeof c.cirque.radius_min === 'number' &&
      typeof c.cirque.radius_max === 'number' &&
      c.cirque.radius_min > c.cirque.radius_max
    ) {
      errors.push(`cirque: radius_min ${c.cirque.radius_min} > radius_max ${c.cirque.radius_max}`)
    }
    check_range(errors, 'cirque.depth', c.cirque.depth, 0, world_height)
    check_range(errors, 'cirque.floor_ratio', c.cirque.floor_ratio, 0, 1)
    check_range(errors, 'cirque.lip', c.cirque.lip, 0, world_height)
    check_range(errors, 'cirque.min_altitude', c.cirque.min_altitude, 0, world_height)
  }

  // ---- GLACIAL §B.3 glacier ribbon (ice band ordered; pv gates in [0,1]; positive periods) ----
  if (c.glacier) {
    check_int(errors, 'glacier.ice_low', c.glacier.ice_low, 0, world_height)
    check_int(errors, 'glacier.ice_high', c.glacier.ice_high, 0, world_height)
    if (
      typeof c.glacier.ice_low === 'number' &&
      typeof c.glacier.ice_high === 'number' &&
      c.glacier.ice_low > c.glacier.ice_high
    ) {
      errors.push(`glacier: ice_low ${c.glacier.ice_low} > ice_high ${c.glacier.ice_high}`)
    }
    check_range(errors, 'glacier.flat_gate', c.glacier.flat_gate, 0, 100)
    check_range(errors, 'glacier.valley_pv', c.glacier.valley_pv, 0, 1)
    check_range(errors, 'glacier.medial_pv', c.glacier.medial_pv, 0, 1)
    check_range(errors, 'glacier.lateral_band', c.glacier.lateral_band, 0, 1)
    check_int(errors, 'glacier.crevasse_period', c.glacier.crevasse_period, 1, world_height)
    check_int(errors, 'glacier.terminal_band', c.glacier.terminal_band, 0, world_height)
    check_int(errors, 'glacier.firn_band', c.glacier.firn_band, 0, world_height)
  }

  // ---- water optics (FIVE-WORLDS; RGB triples in [0,1..100], positive depth window) ----
  if (c.water) {
    for (const key of ['body_color', 'shallow_color', 'sigma']) {
      const v = c.water[key]
      if (!Array.isArray(v) || v.length !== 3) errors.push(`water.${key}: expected a [r, g, b] triple`)
      else for (let i = 0; i < 3; i += 1) check_range(errors, `water.${key}[${i}]`, v[i], 0, 100)
    }
    check_range(errors, 'water.fade_start', c.water.fade_start, 0, world_height)
    check_range(errors, 'water.tint_depth', c.water.tint_depth, 0, world_height)
    check_range(errors, 'water.deep_floor', c.water.deep_floor, 0, 1)
    // OPTIONAL (2026-07-07 shallow-presence fix): omitted ⇒ the universal WATER_SHALLOW_PRESENCE default.
    if (c.water.shallow_presence !== undefined)
      check_range(errors, 'water.shallow_presence', c.water.shallow_presence, 0, 1)
  }

  // ---- carvers (caves + FIVE-WORLDS canyon stage; depth ordering) ----
  if (c.carvers && c.carvers.canyon) {
    const cy = c.carvers.canyon
    check_range(errors, 'carvers.canyon.width', cy.width, 0, 1)
    check_range(errors, 'carvers.canyon.depth', cy.depth, 0, 100_000)
    check_range(errors, 'carvers.canyon.wall_steepness', cy.wall_steepness, 1, 16)
  }
  if (c.carvers && c.carvers.caves) {
    const cv = c.carvers.caves
    check_int(errors, 'carvers.caves.depth_min', cv.depth_min, 0, world_height)
    check_int(errors, 'carvers.caves.depth_max', cv.depth_max, 0, world_height)
    check_range(errors, 'carvers.caves.spaghetti_period', cv.spaghetti_period, 1, 1_000_000)
    check_range(errors, 'carvers.caves.spaghetti_threshold', cv.spaghetti_threshold, 0, 1)
    check_range(errors, 'carvers.caves.spaghetti_depth', cv.spaghetti_depth, 0, 100_000)
    if (typeof cv.depth_min === 'number' && typeof cv.depth_max === 'number' && cv.depth_min > cv.depth_max) {
      errors.push(`carvers.caves: depth_min ${cv.depth_min} > depth_max ${cv.depth_max}`)
    }
  }

  // ---- sky (Pandora floating islands: cap band ordered; region gate; island-shape grammar) ----
  if (c.sky) {
    check_int(errors, 'sky.low_y', c.sky.low_y, 0, world_height)
    check_int(errors, 'sky.high_y', c.sky.high_y, 0, world_height)
    check_range(errors, 'sky.thickness', c.sky.thickness, 0, world_height)
    if (typeof c.sky.low_y === 'number' && typeof c.sky.high_y === 'number' && c.sky.low_y > c.sky.high_y) {
      errors.push(`sky: low_y ${c.sky.low_y} > high_y ${c.sky.high_y}`)
    }
    // Region gating.
    check_range(errors, 'sky.region_size', c.sky.region_size, 1, 1_000_000)
    check_range(errors, 'sky.region_rate', c.sky.region_rate, 0, 1)
    // Archipelago counts (islands_min ≤ islands_max, non-negative satellites).
    check_int(errors, 'sky.islands_min', c.sky.islands_min, 0, 1024)
    check_int(errors, 'sky.islands_max', c.sky.islands_max, 0, 1024)
    if (
      typeof c.sky.islands_min === 'number' &&
      typeof c.sky.islands_max === 'number' &&
      c.sky.islands_min > c.sky.islands_max
    ) {
      errors.push(`sky: islands_min ${c.sky.islands_min} > islands_max ${c.sky.islands_max}`)
    }
    check_int(errors, 'sky.satellites_max', c.sky.satellites_max, 0, 64)
    // Island shape (cap_radius_min ≤ cap_radius_max; positive taper/wobble).
    check_range(errors, 'sky.cap_radius_min', c.sky.cap_radius_min, 1, 100_000)
    check_range(errors, 'sky.cap_radius_max', c.sky.cap_radius_max, 1, 100_000)
    if (
      typeof c.sky.cap_radius_min === 'number' &&
      typeof c.sky.cap_radius_max === 'number' &&
      c.sky.cap_radius_min > c.sky.cap_radius_max
    ) {
      errors.push(`sky: cap_radius_min ${c.sky.cap_radius_min} > cap_radius_max ${c.sky.cap_radius_max}`)
    }
    check_range(errors, 'sky.root_ratio_min', c.sky.root_ratio_min, 0, 100)
    check_range(errors, 'sky.root_ratio_max', c.sky.root_ratio_max, 0, 100)
    if (
      typeof c.sky.root_ratio_min === 'number' &&
      typeof c.sky.root_ratio_max === 'number' &&
      c.sky.root_ratio_min > c.sky.root_ratio_max
    ) {
      errors.push(`sky: root_ratio_min ${c.sky.root_ratio_min} > root_ratio_max ${c.sky.root_ratio_max}`)
    }
    // Band must contain the deepest root: thickness ≥ cap_radius_max·root_ratio_max (else roots clip).
    if (
      typeof c.sky.thickness === 'number' &&
      typeof c.sky.cap_radius_max === 'number' &&
      typeof c.sky.root_ratio_max === 'number' &&
      c.sky.thickness < c.sky.cap_radius_max * c.sky.root_ratio_max
    ) {
      errors.push(
        `sky: thickness ${c.sky.thickness} < cap_radius_max·root_ratio_max ${c.sky.cap_radius_max * c.sky.root_ratio_max} (roots would clip)`
      )
    }
    check_range(errors, 'sky.crown_ratio', c.sky.crown_ratio, 0, 10)
    check_range(errors, 'sky.wobble_amp', c.sky.wobble_amp, 0, 1)
    check_range(errors, 'sky.wobble_period', c.sky.wobble_period, 1, 1_000_000)
    check_range(errors, 'sky.satellite_radius_ratio', c.sky.satellite_radius_ratio, 0, 1)
    check_range(errors, 'sky.satellite_orbit', c.sky.satellite_orbit, 0, 100)
    check_int(errors, 'sky.crust_depth', c.sky.crust_depth, 0, world_height)
    // Region must be wide enough that an island's reach (satellite orbit + wobbled cap) stays within
    // the 3×3 neighborhood the field scans (region_size > 2·reach) — else distant islands are missed.
    if (
      typeof c.sky.region_size === 'number' &&
      typeof c.sky.cap_radius_max === 'number' &&
      typeof c.sky.satellite_orbit === 'number' &&
      typeof c.sky.satellite_radius_ratio === 'number' &&
      typeof c.sky.wobble_amp === 'number'
    ) {
      const reach =
        c.sky.cap_radius_max * c.sky.satellite_orbit +
        c.sky.cap_radius_max * c.sky.satellite_radius_ratio * (1 + c.sky.wobble_amp)
      if (c.sky.region_size <= 2 * reach) {
        errors.push(
          `sky: region_size ${c.sky.region_size} <= 2·island_reach ${(2 * reach).toFixed(1)} (neighbor islands would be missed)`
        )
      }
    }
  }

  // ---- biome selection ----
  if (c.biome_selection) {
    check_int(errors, 'biome_selection.blend_k', c.biome_selection.blend_k, 1, 32)
    check_range(errors, 'biome_selection.transition_softness', c.biome_selection.transition_softness, 0, 100)
    check_range(
      errors,
      'biome_selection.weirdness_esoteric_threshold',
      c.biome_selection.weirdness_esoteric_threshold,
      0,
      1
    )
    if (c.biome_selection.axis_weights) {
      for (const axis of ['temperature', 'humidity', 'continentalness', 'erosion', 'pv']) {
        check_range(errors, `biome_selection.axis_weights.${axis}`, c.biome_selection.axis_weights[axis], 0, 100)
      }
    } else errors.push('biome_selection.axis_weights: required')
    // climate_bias (FIVE-WORLDS Phase-0 §3 pin) — OPTIONAL per-axis additive offset in [-1,1].
    if (c.biome_selection.climate_bias !== undefined && c.biome_selection.climate_bias !== null) {
      const cb = c.biome_selection.climate_bias
      if (typeof cb !== 'object' || Array.isArray(cb)) {
        errors.push('biome_selection.climate_bias: expected an object of per-axis offsets')
      } else {
        for (const axis of Object.keys(cb)) {
          check_range(errors, `biome_selection.climate_bias.${axis}`, cb[axis], -1, 1)
        }
      }
    }
  }

  // ---- biomes: non-empty, unique ids in [0,255], climate axes in [0,1] ----
  if (c.biomes !== undefined) {
    if (!Array.isArray(c.biomes) || c.biomes.length === 0) {
      errors.push('biomes: expected a non-empty array')
    } else {
      /** @type {Set<number>} */
      const seen_ids = new Set()
      for (let i = 0; i < c.biomes.length; i += 1) {
        const b = c.biomes[i]
        if (b === null || typeof b !== 'object') {
          errors.push(`biomes[${i}]: expected an object`)
          continue
        }
        // id: Uint8-persisted (§3.4), unique.
        check_int(errors, `biomes[${i}].id`, b.id, 0, 255)
        if (typeof b.id === 'number') {
          if (seen_ids.has(b.id)) errors.push(`biomes[${i}].id: duplicate id ${b.id}`)
          seen_ids.add(b.id)
        }
        if (typeof b.name !== 'string' || b.name.length === 0) {
          errors.push(`biomes[${i}].name: expected a non-empty string`)
        }
        if (b.climate) {
          for (const axis of ['temperature', 'humidity', 'continentalness', 'erosion', 'pv']) {
            check_range(errors, `biomes[${i}].climate.${axis}`, b.climate[axis], 0, 1)
          }
        } else errors.push(`biomes[${i}].climate: required`)
        if (!b.land || typeof b.land !== 'object') errors.push(`biomes[${i}].land: required object`)
        check_range(errors, `biomes[${i}].tree_density`, b.tree_density, 0, 1)
        check_range(errors, `biomes[${i}].grass_density`, b.grass_density, 0, 1)
      }
    }
  }

  // ---- decoration (positive 1-in-N denominators, sane clumping) ----
  if (c.decoration) {
    const d = c.decoration
    check_int(errors, 'decoration.grove_cell_shift', d.grove_cell_shift, 0, 16)
    // 1-in-N density denominators (all must be ≥1 — a 0 is a divide-by-zero in the decorator hash gate).
    for (const key of [
      'tree_grove_one_in',
      'rock_grove_one_in',
      'tall_cluster_one_in',
      'tall_in_cluster_one_in',
      'fern_one_in',
      'forest_tuft_one_in',
      'path_one_in',
      'flower_patch_one_in',
      'flower_in_patch_one_in',
      'reed_one_in',
    ]) {
      if (d[key] !== undefined) check_int(errors, `decoration.${key}`, d[key], 1, 1_000_000)
    }
    check_int(errors, 'decoration.shore_band', d.shore_band, 0, 256)
    check_range(errors, 'decoration.forest_tree_density', d.forest_tree_density, 0, 1)
    check_range(errors, 'decoration.reed_min_grass', d.reed_min_grass, 0, 1)
    // sprites (FIVE-WORLDS sprite selection) — OPTIONAL { kind: boolean } map.
    if (d.sprites !== undefined && d.sprites !== null) {
      if (typeof d.sprites !== 'object' || Array.isArray(d.sprites)) {
        errors.push('decoration.sprites: expected an object of { kind: boolean }')
      } else {
        for (const [kind, on] of Object.entries(d.sprites)) {
          if (typeof on !== 'boolean') errors.push(`decoration.sprites.${kind}: expected a boolean`)
        }
      }
    }
    if (d.oak) {
      check_int(errors, 'decoration.oak.trunk_min', d.oak.trunk_min, 1, 256)
      check_int(errors, 'decoration.oak.trunk_max', d.oak.trunk_max, 1, 256)
      if (
        typeof d.oak.trunk_min === 'number' &&
        typeof d.oak.trunk_max === 'number' &&
        d.oak.trunk_min > d.oak.trunk_max
      ) {
        errors.push(`decoration.oak: trunk_min ${d.oak.trunk_min} > trunk_max ${d.oak.trunk_max}`)
      }
    }
    // NATURE-PLACEMENT GRAMMAR (deco_shared) — OPTIONAL; every field but `enabled` optional (defaulted).
    // Positive periods; density scales/boosts non-negative; thresholds in [0,1]; hero_species a non-empty
    // string; hero_one_in ≥1. Absent/disabled ⇒ the legacy scatter ⇒ byte-identical parity.
    if (d.grammar !== undefined && d.grammar !== null) {
      const g = d.grammar
      if (typeof g !== 'object' || Array.isArray(g)) {
        errors.push('decoration.grammar: expected an object { enabled, … }')
      } else {
        if (g.enabled !== undefined && typeof g.enabled !== 'boolean')
          errors.push('decoration.grammar.enabled: expected a boolean')
        if (g.cluster_period !== undefined)
          check_range(errors, 'decoration.grammar.cluster_period', g.cluster_period, 1, 1_000_000)
        if (g.cluster_octaves !== undefined)
          check_int(errors, 'decoration.grammar.cluster_octaves', g.cluster_octaves, 1, 8)
        if (g.cluster_warp !== undefined)
          check_range(errors, 'decoration.grammar.cluster_warp', g.cluster_warp, 0, 100_000)
        if (g.cluster_threshold !== undefined)
          check_range(errors, 'decoration.grammar.cluster_threshold', g.cluster_threshold, 0, 1)
        if (g.cluster_softness !== undefined)
          check_range(errors, 'decoration.grammar.cluster_softness', g.cluster_softness, 0, 1)
        // WALKABILITY: canopy_density is a stand-core anchor FRACTION [0,1] (keep ≤ ~0.1 for a walkable forest).
        if (g.canopy_density !== undefined)
          check_range(errors, 'decoration.grammar.canopy_density', g.canopy_density, 0, 1)
        if (g.biome_density !== undefined && g.biome_density !== null) {
          if (typeof g.biome_density !== 'object' || Array.isArray(g.biome_density)) {
            errors.push('decoration.grammar.biome_density: expected an object { biome_name: density }')
          } else {
            for (const [b, d] of Object.entries(g.biome_density))
              check_range(errors, `decoration.grammar.biome_density.${b}`, d, 0, 1)
          }
        }
        if (g.tree_slope_max !== undefined)
          check_range(errors, 'decoration.grammar.tree_slope_max', g.tree_slope_max, 0, 1000)
        if (g.slope_softness !== undefined)
          check_range(errors, 'decoration.grammar.slope_softness', g.slope_softness, 0, 1000)
        if (g.slope_step !== undefined) check_int(errors, 'decoration.grammar.slope_step', g.slope_step, 1, 256)
        if (g.treeline_band !== undefined)
          check_range(errors, 'decoration.grammar.treeline_band', g.treeline_band, 0, world_height)
        if (g.rock_slope_boost !== undefined)
          check_range(errors, 'decoration.grammar.rock_slope_boost', g.rock_slope_boost, 0, 1000)
        if (g.rock_density_scale !== undefined)
          check_range(errors, 'decoration.grammar.rock_density_scale', g.rock_density_scale, 0, 1000)
        if (
          g.hero_species !== undefined &&
          g.hero_species !== null &&
          (typeof g.hero_species !== 'string' || g.hero_species.length === 0)
        )
          errors.push('decoration.grammar.hero_species: expected a non-empty species key')
        if (g.hero_one_in !== undefined)
          check_int(errors, 'decoration.grammar.hero_one_in', g.hero_one_in, 1, 1_000_000)
      }
    }
  }

  // ---- lod (RENDER-ONLY falloff; OPTIONAL — pre-P1 blobs omit it, engine.js falls back to constants) ----
  if (c.lod !== null && c.lod !== undefined) {
    if (typeof c.lod !== 'object') {
      errors.push('lod: expected an object')
    } else {
      // Near full-voxel ring radius: ≥1 chunk (a world always resolves ≥1 chunk of near detail); a
      // generous 64-chunk ceiling (2 km near band) bounds the memory/mesh footprint. far reach: a
      // positive meters value up to a 64 km sanity ceiling (0 legally disables the far shell).
      check_int(errors, 'lod.full_voxel_radius_chunks', c.lod.full_voxel_radius_chunks, 1, 64)
      check_range(errors, 'lod.far_radius_m', c.lod.far_radius_m, 0, 64_000)
    }
  }

  // ---- textures (FIVE-WORLDS per-biome texture identity: size + per-family HSV transforms) ----
  if (c.textures !== undefined && c.textures !== null) {
    const tx = c.textures
    if (typeof tx !== 'object' || Array.isArray(tx)) {
      errors.push('textures: expected an object { size?, families? }')
    } else {
      if (tx.size !== undefined) check_int(errors, 'textures.size', tx.size, 8, 1024)
      if (tx.families !== undefined) {
        if (typeof tx.families !== 'object' || tx.families === null || Array.isArray(tx.families)) {
          errors.push('textures.families: expected an object of family → { hue?, sat?, val? }')
        } else {
          for (const [fam, t] of Object.entries(tx.families)) {
            if (t === null || typeof t !== 'object') {
              errors.push(`textures.families.${fam}: expected an object`)
              continue
            }
            const tt = /** @type {Record<string, unknown>} */ (t)
            if (tt.hue !== undefined) check_range(errors, `textures.families.${fam}.hue`, tt.hue, -360, 360)
            if (tt.sat !== undefined) check_range(errors, `textures.families.${fam}.sat`, tt.sat, 0, 10)
            if (tt.val !== undefined) check_range(errors, `textures.families.${fam}.val`, tt.val, 0, 10)
          }
        }
      }
    }
  }

  // ---- structure_pool_overrides (FIVE-WORLDS decorator hook: biome_name → pool id[]) ----
  if (c.structure_pool_overrides !== undefined && c.structure_pool_overrides !== null) {
    const spo = c.structure_pool_overrides
    if (typeof spo !== 'object' || Array.isArray(spo)) {
      errors.push('structure_pool_overrides: expected an object { biome_name: pool_id[] }')
    } else {
      for (const [biome_name, pools] of Object.entries(spo)) {
        if (!Array.isArray(pools) || pools.some((p) => typeof p !== 'string')) {
          errors.push(`structure_pool_overrides.${biome_name}: expected an array of pool-id strings`)
        }
      }
    }
  }

  // ---- trees (ENGINE_AAA_PLAN §3.5 procedural-tree gate — OPTIONAL; default off ⇒ schematics ⇒ parity) ----
  if (c.trees !== undefined && c.trees !== null) {
    if (typeof c.trees !== 'object' || Array.isArray(c.trees)) {
      errors.push('trees: expected an object { procedural: boolean }')
    } else {
      if (c.trees.procedural !== undefined && typeof c.trees.procedural !== 'boolean')
        errors.push('trees.procedural: expected a boolean')
      // bake-then-stamp variant count (tree_bake.js): 0/absent ⇒ live per-column gen; 1..64 ⇒ baked pick.
      if (c.trees.baked_variants !== undefined) check_int(errors, 'trees.baked_variants', c.trees.baked_variants, 0, 64)
    }
  }

  // ---- tree_species (§3.4 per-biome weighted procedural roster: biome_name → {species, weight}[]) ----
  if (c.tree_species !== undefined && c.tree_species !== null) {
    const ts = c.tree_species
    if (typeof ts !== 'object' || Array.isArray(ts)) {
      errors.push('tree_species: expected an object { biome_name: {species, weight}[] }')
    } else {
      for (const [biome_name, roster] of Object.entries(ts)) {
        if (!Array.isArray(roster)) {
          errors.push(`tree_species.${biome_name}: expected an array of {species, weight}`)
          continue
        }
        for (let i = 0; i < roster.length; i += 1) {
          const e = /** @type {any} */ (roster[i])
          if (e === null || typeof e !== 'object') {
            errors.push(`tree_species.${biome_name}[${i}]: expected an object`)
            continue
          }
          if (typeof e.species !== 'string' || e.species.length === 0) {
            errors.push(`tree_species.${biome_name}[${i}].species: expected a non-empty string`)
          }
          check_int(errors, `tree_species.${biome_name}[${i}].weight`, e.weight, 1, 1_000_000)
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

// =============================================================================================
// config_hash — stable u32 / hex world-identity fingerprint. Canonical serialization (recursively
// sorted keys) → order-independent + identical across runs & machines. Integer-only FNV-1a. Two
// configs differing in any value OR key produce different hashes; two differing only in key ORDER
// produce the SAME hash.
// =============================================================================================

/**
 * Serializes any JSON-compatible value into a CANONICAL string: object keys emitted in sorted order
 * (recursively), arrays in index order, primitives tagged so `1` (number) and `"1"` (string) never
 * collide. Pure, deterministic, order-independent for objects.
 * @param {unknown} value JSON-compatible (object/array/string/number/boolean/null)
 * @returns {string} canonical serialization
 */
export function canonical_serialize(value) {
  if (value === null) return 'n'
  const t = typeof value
  if (t === 'number') {
    // Distinguish -0 from 0; keep integers/floats exact via default number→string.
    return `d:${Object.is(value, -0) ? '0' : String(value)}`
  }
  if (t === 'boolean') return value ? 'b:1' : 'b:0'
  if (t === 'string') return `s:${/** @type {string} */ (value).length}:${value}`
  if (Array.isArray(value)) {
    let out = 'a['
    for (let i = 0; i < value.length; i += 1) out += canonical_serialize(value[i]) + ','
    return out + ']'
  }
  if (t === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value)
    const keys = Object.keys(obj).sort()
    let out = 'o{'
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i]
      out += `s:${k.length}:${k}=` + canonical_serialize(obj[k]) + ';'
    }
    return out + '}'
  }
  // undefined / function / symbol — not JSON-serializable; tag so they don't silently vanish.
  return `u:${t}`
}

/**
 * FNV-1a 32-bit hash over a string (integer arithmetic only, deterministic across engines). The
 * prime multiply uses Math.imul so the low 32 bits are correct regardless of intermediate magnitude.
 * @param {string} text
 * @returns {number} unsigned 32-bit hash
 */
function fnv1a_32(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Stable world-identity fingerprint of a config. Order-independent, stable across runs & machines.
 * Same recipe ⇒ same hash ⇒ same world; any value change ⇒ new hash ⇒ a world fork (§4).
 * @param {WorldGenConfig | Record<string, unknown>} config
 * @returns {number} unsigned 32-bit identity hash
 */
export function config_hash(config) {
  return fnv1a_32(canonical_serialize(config))
}

/**
 * Hex form of {@link config_hash} (zero-padded to 8 chars) — for display / persisted identity keys.
 * @param {WorldGenConfig | Record<string, unknown>} config
 * @returns {string} 8-char lowercase hex (e.g. "1a2b3c4d")
 */
export function config_hash_hex(config) {
  return config_hash(config).toString(16).padStart(8, '0')
}
