// SUB-BIOME REGION LAYER (S-25 "world-as-planet") — a low-frequency field that partitions a massif
// world into named terrain REGIONS (taiga / glacier / peaks / ice_wasteland / ice_forest — "each
// world should have a lot of terrain variety, no locations look the same"). Each region carries a
// TERRAIN PROFILE (a modulation of the massif surface output), a PALETTE lever (an ice-line delta into
// the alpine painter), and a BIOME PIN (so decoration + strata follow the region). This is the
// PATTERN-SETTER: the per-world fan-out copies the vocabulary and re-tunes the class values.
//
// CONFIG-FIRST (§2.3): everything is a value under `config.regions`. Absent / `enabled:false` ⇒
// region_profile returns the IDENTITY profile ⇒ the massif is byte-identical and no biome/palette is
// overridden ⇒ every non-region world (incl. the current DEFAULT + the other four recipes) is unchanged.
//
// HOW IT PARTITIONS: one warped low-frequency fbm field `r ∈ [0,1]`; each class owns a contiguous
// [lo, hi) band of r; adjacent classes CROSS-FADE over `blend` (smoothstep) so the terrain params are
// CONTINUOUS across a border (no cliffs — the flanks ramp, valleys stay seamless). The band ladder makes
// the zonation coherent (ice basins → wastelands → forests → peaks), while the domain WARP bends the
// boundaries organic and a second low-frequency VARIANCE channel jitters the blended profile so two
// patches of the SAME region differ ("no locations look the same"). The DOMINANT class'
// biome pin sets the column biome (a hard pick — a forest/region edge reads naturally), while the terrain
// params blend smoothly.
//
// DETERMINISM LAW (§3.7): seeded fbm (alea) + arithmetic + a polynomial smoothstep only — no
// sin/cos/pow/random at sample time. Region-local: r(x,z) depends only on (x,z)+seed. Samplers allocate
// once per world (create_region_context), decorrelated from every other stage by distinct XOR salts.

import { create_fbm_sampler } from '../noise/sampler.js'
import { create_warp_sampler } from '../noise/warp.js'
import { derive_sub_seed } from '../../config/world_config.js'

/** @typedef {import('../../config/world_gen_config.js').RegionsConfig} RegionsConfig */
/** @typedef {import('../../config/world_gen_config.js').RegionClassConfig} RegionClassConfig */
/** @typedef {import('../../config/world_gen_config.js').BiomeConfig} BiomeConfig */

/**
 * @typedef {object} RegionProfile the blended terrain + palette modulation at one column.
 * @property {number} relief_scale multiply on the massif body (`shaped`): <1 flattens a region toward its
 *   valley floor, 1 keeps the natural massif (peaks), >1 amplifies (clamped by the massif to the world box)
 * @property {number} height_bias additive world-y shift for the whole region, blocks (blended → gentle ramps)
 * @property {number} roughness_scale multiply on the massif face detail (ero + micro): <1 smooths, >1 jags
 * @property {number} ice_line_delta additive shift to the alpine painter's ice_line, blocks (−lowers ⇒ ice
 *   reaches down into a low glacier basin; + raises ⇒ ice only on the very summit caps)
 * @property {number} biome_id the DOMINANT class' pinned biome id (−1 = no pin ⇒ keep climate placement)
 * @property {string | null} region the DOMINANT class' NAME (null when the layer is off) — the region
 *   IDENTITY consumers key on (per-region zone music `${world}:${region}`, debug overlays). The terrain
 *   params blend smoothly; the identity is a hard pick, same convention as the biome pin.
 */

/** The no-op profile: massif byte-identical, no biome/palette override (disabled/absent regions). */
export const IDENTITY_PROFILE = /** @type {RegionProfile} */ ({
  relief_scale: 1,
  height_bias: 0,
  roughness_scale: 1,
  ice_line_delta: 0,
  biome_id: -1,
  region: null,
})

/** Polynomial smoothstep on a normalized t (determinism-safe — no transcendentals). */
const smooth = (/** @type {number} */ t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** Smoothstep of x across [e0, e1] (0 below e0, 1 above e1). Guards e1 ≤ e0 as a hard step. */
function edge(/** @type {number} */ x, /** @type {number} */ e0, /** @type {number} */ e1) {
  if (e1 <= e0) return x >= e1 ? 1 : 0
  return smooth((x - e0) / (e1 - e0))
}

/**
 * The cross-fade weight of one class band [lo, hi) at region value r, with a smoothstep half-width `b`
 * at each interior edge. The first band (lo ≤ 0) has no rising edge; the last (hi ≥ 1) no falling edge, so
 * the ladder ends are saturated. Neighbouring bands share an edge and sum to ~1 across it (0.5 + 0.5 at the
 * exact boundary), so the normalized blend is a proper partition of unity. b ≤ 0 ⇒ hard bands (step).
 * @param {number} r region field value [0,1]
 * @param {number} lo band lower bound @param {number} hi band upper bound @param {number} b blend half-width
 * @returns {number} weight in [0,1]
 */
function band_weight(r, lo, hi, b) {
  if (b <= 0) return r >= lo && r < hi ? 1 : 0
  const rise = lo <= 0 ? 1 : edge(r, lo - b, lo + b)
  const fall = hi >= 1 ? 1 : 1 - edge(r, hi - b, hi + b)
  return rise * fall
}

/**
 * @typedef {object} RegionClassResolved one class' band + resolved profile knobs.
 * @property {string} name @property {number} lo @property {number} hi
 * @property {number} relief_scale @property {number} height_bias @property {number} roughness_scale
 * @property {number} ice_line_delta @property {number} biome_id
 */

/**
 * @typedef {object} RegionContext resolved region layer (samplers built once per world).
 * @property {boolean} enabled the layer is on (config enabled + a non-empty class list)
 * @property {import('../noise/sampler.js').FbmSampler|null} field the low-freq region field r
 * @property {import('../noise/warp.js').WarpSampler|null} warp domain warp for organic band boundaries
 * @property {number} warp_amp warp displacement amplitude, blocks
 * @property {import('../noise/sampler.js').FbmSampler|null} variance the 2nd low-freq jitter channel
 * @property {number} v_relief @property {number} v_rough @property {number} v_bias @property {number} v_ice
 *   intra-region variance amplitudes (relief/rough multiplicative fractions; bias/ice additive blocks)
 * @property {number} blend smoothstep half-width in r units at each class-band boundary
 * @property {RegionClassResolved[]} classes ordered class bands
 * @property {boolean} drives_terrain any class (or the variance channel) carries a TERRAIN knob
 *   (relief_scale≠1 / height_bias≠0 / roughness_scale≠1 / a non-zero variance relief|rough|bias) — the
 *   gate the CLASSIC spline path (column_gen.raw_land_no_cirque) reads to decide whether to apply region
 *   terrain modulation. False (biome-pin-only recipes, disabled, DEFAULT) ⇒ the spline path runs the EXACT
 *   legacy formula ⇒ byte-identical (no unintended golden fork). Massif worlds ignore it (massif always
 *   modulates); it exists so a spline world can OPT IN to region-driven terrain by adding class knobs.
 */

/** @type {RegionContext} */
const DISABLED_CONTEXT = {
  enabled: false,
  field: null,
  warp: null,
  warp_amp: 0,
  variance: null,
  v_relief: 0,
  v_rough: 0,
  v_bias: 0,
  v_ice: 0,
  blend: 0,
  classes: [],
  drives_terrain: false,
}

/**
 * Builds the region context from `config.regions` + the world's biome table (to resolve each class'
 * biome NAME pin to its persisted id). Disabled / absent / empty-classes ⇒ enabled:false ⇒ region_profile
 * returns IDENTITY ⇒ byte-identical world. Pure; samplers allocate once. The region seeds are derived from
 * a dedicated `'regions'` sub-seed (fully decorrelated from every climate/massif/carver sampler).
 * @param {RegionsConfig} [cfg]
 * @param {BiomeConfig[]} [biomes] the world biome table (name → id for the pins)
 * @param {string} [seed] the world master seed
 * @returns {RegionContext}
 */
export function create_region_context(cfg, biomes = [], seed = '') {
  const classes_in = cfg?.classes
  const enabled = cfg?.enabled === true && Array.isArray(classes_in) && classes_in.length > 0
  if (!enabled) return DISABLED_CONTEXT

  const s = derive_sub_seed(seed, 'regions')
  const by_name = new Map(biomes.map((b) => [b.name, b.id]))
  // Resolve ordered class bands: `upto` is each class' hi edge; lo = the previous class' hi (0 for the first).
  let lo = 0
  /** @type {RegionClassResolved[]} */
  const classes = classes_in.map((cl) => {
    const hi = cl.upto
    /** @type {RegionClassResolved} */
    const resolved = {
      name: cl.name,
      lo,
      hi,
      relief_scale: cl.relief_scale ?? 1,
      height_bias: cl.height_bias ?? 0,
      roughness_scale: cl.roughness_scale ?? 1,
      ice_line_delta: cl.ice_line_delta ?? 0,
      biome_id: cl.biome !== undefined ? (by_name.get(cl.biome) ?? -1) : -1,
    }
    lo = hi
    return resolved
  })

  const v = cfg.variance ?? {}
  // TERRAIN-DRIVEN gate: does the spline path (column_gen) need to apply region terrain modulation? True iff
  // any class carries a non-identity terrain knob OR the variance channel jitters terrain. Biome-pin-only
  // recipes (every knob at its identity default) ⇒ false ⇒ the spline path stays byte-identical to legacy.
  const drives_terrain =
    classes.some((c) => c.relief_scale !== 1 || c.height_bias !== 0 || c.roughness_scale !== 1) ||
    (v.relief ?? 0) !== 0 ||
    (v.rough ?? 0) !== 0 ||
    (v.bias ?? 0) !== 0
  return {
    enabled: true,
    field: create_fbm_sampler({
      seed: (s ^ 0x9e37_0001) >>> 0,
      base_period: cfg.field?.period ?? 2200,
      octaves: cfg.field?.octaves ?? 2,
    }),
    warp: cfg.warp
      ? create_warp_sampler({
          seed: (s ^ 0x9e37_0002) >>> 0,
          base_period: cfg.warp.period ?? 1100,
          octaves: cfg.warp.octaves ?? 2,
        })
      : null,
    warp_amp: cfg.warp?.amp ?? 0,
    variance: create_fbm_sampler({
      seed: (s ^ 0x9e37_0003) >>> 0,
      base_period: v.period ?? 240,
      octaves: v.octaves ?? 2,
    }),
    v_relief: v.relief ?? 0,
    v_rough: v.rough ?? 0,
    v_bias: v.bias ?? 0,
    v_ice: v.ice ?? 0,
    blend: cfg.blend ?? 0,
    classes,
    drives_terrain,
  }
}

/** Reused warp scratch (single-threaded per gen worker). */
const WS = [0, 0, 0]

/**
 * The blended region profile at a world column: the class bands cross-faded over `blend` into continuous
 * terrain/palette params, then jittered by the low-freq variance channel; the DOMINANT (highest-weight)
 * class sets the biome pin. Returns IDENTITY when the layer is off/absent (so the massif stays byte-exact).
 * Pure, region-local, deterministic (arithmetic + seeded fbm + smoothstep only).
 * @param {RegionContext} [rc]
 * @param {number} world_x @param {number} world_z
 * @returns {RegionProfile}
 */
export function region_profile(rc, world_x, world_z) {
  if (!rc || !rc.enabled || rc.field === null) return IDENTITY_PROFILE

  // Domain-warp the sample coords so class boundaries meander (organic pockets, not concentric rings).
  let sx = world_x
  let sz = world_z
  if (rc.warp !== null && rc.warp_amp !== 0) {
    rc.warp.offset(world_x, 0, world_z, WS)
    sx = world_x + WS[0] * rc.warp_amp
    sz = world_z + WS[2] * rc.warp_amp
  }
  const r = rc.field.sample(sx, sz) // [0,1]

  // Cross-fade the class bands into blended terrain params; track the dominant class for the biome pin.
  let relief = 0
  let bias = 0
  let rough = 0
  let ice = 0
  let wsum = 0
  let dom_w = -1
  let dom_biome = -1
  /** @type {string | null} */
  let dom_name = null
  for (let i = 0; i < rc.classes.length; i += 1) {
    const c = rc.classes[i]
    const w = band_weight(r, c.lo, c.hi, rc.blend)
    if (w <= 0) continue
    relief += w * c.relief_scale
    bias += w * c.height_bias
    rough += w * c.roughness_scale
    ice += w * c.ice_line_delta
    wsum += w
    if (w > dom_w) {
      dom_w = w
      dom_biome = c.biome_id
      dom_name = c.name
    }
  }
  if (wsum <= 0) return IDENTITY_PROFILE
  const inv = 1 / wsum
  relief *= inv
  bias *= inv
  rough *= inv
  ice *= inv

  // VARIANCE — one low-freq channel (signed [-1,1]) jitters the blended profile so two patches of the same
  // region read differently (one taiga stand more rugged/higher/icier than the next). Co-varying by design:
  // a "high-variance" patch is rougher + higher + icier together, which reads as a coherently rugged sub-zone.
  const vf = (rc.variance.sample(world_x, world_z) - 0.5) * 2
  relief *= 1 + rc.v_relief * vf
  rough *= 1 + rc.v_rough * vf
  bias += rc.v_bias * vf
  ice += rc.v_ice * vf

  return {
    relief_scale: relief,
    height_bias: bias,
    roughness_scale: rough,
    ice_line_delta: ice,
    biome_id: dom_biome,
    region: dom_name,
  }
}
