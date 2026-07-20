// FLAT cloud layer + top-down cloud SHADOW — the ground-MMO replacement for the old per-pixel
// volumetric march (ENG-15, 2026-07-04). CONSTRAINT: clouds are low priority — they should look good
// but never cost performance; the game will not fly through them.
// So the deck is a FLAT layer sampled with a single ray-plane intersection (zero loops, ~zero cost),
// not a raymarch. This KILLED the march's artifact classes at the root — concentric arc bands,
// vertical streak walls, edge-on smears, from-above banding, jumpy view-dependent light, and the
// ULTRA/5K perf tax (all were properties of the variable-span / fixed-step raymarch that no longer
// exists).
//
// KEPT SACRED from the volumetric era (the drifting ground shade reads as "magical"): the
// top-down cloud-SHADOW transmittance map + `shadow_at` (sampled by terrain + the froxel
// `cloud_shadow_at` coupling, froxels.js:288) + the drifted-rebake tick + the camera-tracked
// footprint. The shadow bake reads the SAME baked base+weather fields the deck reads, so the shade
// on the ground and the clouds overhead stay coherent. ENG-15 additions to the shadow: a lerp-blended
// refresh (kills the "big light update" pops) + a WIDE edge fade (kills the visible
// footprint "box").
//
// Portions of the baked-noise / weather-field lineage adapted from fable5-world-demo (src/sky/
// Clouds.ts), MIT, Copyright (c) 2026 Remi Sebastian Kits.

import { HalfFloatType, RedFormat, Vector2, Vector3 } from 'three'
import { Storage3DTexture, StorageTexture } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  Return,
  clamp,
  exp,
  float,
  fwidth,
  instanceIndex,
  max,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  smoothstep,
  texture,
  texture3D,
  textureStore,
  uniform,
  uvec2,
  uvec3,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { CLOUD_TIERS, DEFAULT_CLOUD_SEED, SHADOW_EXTINCTION, cloud_bake_offsets } from './cloud_noise.js'

/** default cloud-slab altitudes (world units) — tune per world scale at wiring (atmosphere.js retunes
 *  to our world: 460 / 700). The FLAT decks are placed WITHIN this slab (see MAIN_DECK_FRAC etc.) so a
 *  world tuned for the shadow band also positions the visible layer sensibly. */
export const CLOUD_BOTTOM = 1250
export const CLOUD_TOP = 1900
/** downwind translation speed of the field (units/s) — shared by the deck drift + the shadow drift so
 *  the overhead clouds and their ground shade move together. */
const DRIFT_V = 22
/** detail erodes 1.35× faster than the base drifts → masses churn, not slide (deck cauliflower shaping). */
const DETAIL_DRIFT_MUL = 1.35
/** weather field world span (units) — tiles far past the playable area. */
const WEATHER_WORLD = 26000

// ── FLAT DECK placement + look (ENG-15) ───────────────────────────────────────────────────────────
/** SINGLE deck altitude as a fraction UP the slab (bottom=0, top=1). ~40% keeps it comfortably above
 *  terrain/islands. ONE deck by design: two flat planes at different altitudes BEAT into concentric
 *  moiré rings (verified — a second cirrus plane produced exactly this arc-ring artifact), and
 *  one deck with the procedural cauliflower reads full and characterful anyway. YAGNI. */
const MAIN_DECK_FRAC = 0.4
/** the deck fades out by HIT DISTANCE (the flat far edge never shows against the
 *  dome) — clouds dissolve into the horizon haze like a real overcast. Ramps across [START,END] meters. */
const DECK_FADE_START = 1600
const DECK_FADE_END = 3200
/** extra sun gain into the lit deck (silver-lining punch) — bounded well under the old march's blowout. */
const DECK_SUN_GAIN = 1.35
/** seconds between drifted shadow-map re-bakes. */
const SHADOW_REBAKE_S = 2.5
/** ENG-15 shadow CROSSFADE seconds: on each re-bake the sampled shade lerps old→new over this window so
 *  a drift/recenter re-bake never POPS (no jumpy or sudden big light updates). */
const SHADOW_BLEND_S = 0.5
/** AMORTISATION: the drifted shadow re-bake (a full S×S × 20-step compute) is spread ONE texel-band per
 *  frame across this many frames, so the ~2.5 s spike (the pinned idle p95) never lands on a single
 *  frame. The fresh map is crossfaded IN only after the LAST band bakes — the frozen previous footprint
 *  shows throughout the pass, so the LOOK is unchanged (drift is 22 u/s: the field moves ~2 units over a
 *  pass, invisible against the 12 km footprint). This kills the spike, never the drift shade. Sized so
 *  ONE band of the HIGH-tier 1024² map (the heaviest) stays well under a 120fps frame's slack even when
 *  the scene is near budget — measured: 12 bands still bumped zero-headroom frames past vsync; 32 fits. */
const SHADOW_REBAKE_TILES = 32

/**
 * @typedef {object} CloudsOptions
 * @property {(dir:*)=>*} [sample_sky] keystone sky node — vec3 ambient radiance for a direction node.
 * @property {*} [sun_direction] `uniform(vec3)` world sun direction (share sky_node's).
 * @property {*} [sun_radiance] vec3 node/uniform: sun color × intensity reaching the layer.
 * @property {*} [wind_direction] `uniform(vec2)` normalized downwind xz.
 * @property {CloudTier|keyof typeof CLOUD_TIERS} [tier] tier knobs (default HIGH).
 * @property {number} [seed] bake seed — forks the cloudscape deterministically.
 * @property {number} [world_size] world span for the shadow map footprint.
 * @property {number} [cloud_bottom] slab bottom altitude.
 * @property {number} [cloud_top] slab top altitude.
 */
/** @typedef {import('./cloud_noise.js').CloudTier} CloudTier */

/**
 * Build the clouds system: the baked weather/coverage + base noise fields, the flat-deck sample-node
 * builder (`cloud_layer`), and the top-down cloud-shadow map (+ `shadow_at`, drifted rebake, footprint
 * tracking). Nothing runs until `bake(renderer)` is awaited by the wiring wave.
 * @param {CloudsOptions} [opts]
 */
export function create_clouds(opts = {}) {
  const tier = typeof opts.tier === 'string' ? CLOUD_TIERS[opts.tier] : (opts.tier ?? CLOUD_TIERS.high)
  const seed = opts.seed ?? DEFAULT_CLOUD_SEED
  const cloud_bottom = opts.cloud_bottom ?? CLOUD_BOTTOM
  const cloud_top = opts.cloud_top ?? CLOUD_TOP
  const slab = cloud_top - cloud_bottom
  const main_deck_y = cloud_bottom + slab * MAIN_DECK_FRAC

  // CLOUD-SHADOW FOOTPRINT — nice cinematic blue shadows, but the box EDGE was
  // visible). A CAMERA-TRACKED footprint (re-baked when the camera leaves the centered cell) that always
  // surrounds the view, far past the ~2.6 km haze-full range so its own moving edge is buried in aerial
  // haze, plus a WIDE edge fade (SHADOW_EDGE_FADE) so the boundary is never a hard line.
  const shadow_world = 12000
  // Fraction of the footprint half-width over which the cloud-shadow contribution fades to zero at the
  // edge — fades smoothly at its edges, no hard boundary. 0.15 ⇒ the last 15% ramps out — deep
  // in the haze, invisible.
  const SHADOW_EDGE_FADE = 0.15
  // Re-bake the footprint when the camera has moved this far (m) from the last bake center.
  const SHADOW_RECENTER_M = 1024

  // injected hooks with self-contained defaults so the module stands alone.
  const sun_direction = opts.sun_direction ?? uniform(new Vector3(0.3, 0.6, 0.2).normalize())
  const sun_radiance = opts.sun_radiance ?? uniform(new Vector3(8.0, 7.7, 7.2))
  const wind_direction = opts.wind_direction ?? uniform(new Vector2(1, 0))
  const sample_sky = opts.sample_sky ?? /** @param {*} _d */ ((_d) => vec3(0.5, 0.6, 0.75))

  const coverage = uniform(0.62)
  const density = uniform(0.85)
  const u_time = uniform(0)
  const u_drift_base = uniform(new Vector2())
  // world-xz center of the camera-tracked cloud-shadow footprint (bake + sample share it).
  const u_shadow_center = uniform(new Vector2())
  // ENG-15 shadow crossfade: `u_shadow_blend` ramps 0→1 across SHADOW_BLEND_S after a re-bake; the
  // sample lerps the PREVIOUS-footprint transmittance (frozen into `shadow_prev`) toward the fresh
  // `shadow_map` by it, so a re-bake dissolves in smoothly instead of popping.
  const u_shadow_blend = uniform(1)
  // [amortised rebake] texel-index base for the tiled shadow bake — the kernel computes its texel as
  // instanceIndex + u_tile_base, so one S²/TILES band runs per dispatch. `tile_next` = the band the
  // per-frame pump bakes next while a drift re-bake is in flight (-1 = idle, no re-bake running).
  const u_tile_base = uniform(0)
  const state = { time_acc: 0, last_bake_t: -1e9, shadow_cx: 0, shadow_cz: 0, blend_t0: -1e9, tile_next: -1 }

  const BASE_RES = tier.base_res
  const SHADOW_RES = tier.shadow_res
  // Texel-band size for the amortised drift re-bake: SHADOW_REBAKE_TILES bands cover the whole S² map
  // (the last band's overrun past S² is guarded per-texel in the kernel).
  const SHADOW_BAND = Math.ceil((SHADOW_RES * SHADOW_RES) / SHADOW_REBAKE_TILES)
  const WEATHER_RES = tier.weather_res
  const off = cloud_bake_offsets(seed, 3)

  /** @param {[number,number,number]} v */
  const off3 = (v) => vec3(v[0], v[1], v[2])

  // Base perlin-worley volume — read by BOTH the shadow bake (via sample_density) and the flat deck
  // (its xz slice at the deck altitude carves the cauliflower shapes into the coverage field).
  const base_noise = new Storage3DTexture(BASE_RES, BASE_RES, BASE_RES)
  base_noise.type = HalfFloatType
  base_noise.format = RedFormat
  const shadow_map = new StorageTexture(SHADOW_RES, SHADOW_RES)
  shadow_map.type = HalfFloatType
  shadow_map.generateMipmaps = false
  // ENG-15 crossfade source — the transmittance of the PREVIOUS footprint, blitted before each re-bake.
  const shadow_prev = new StorageTexture(SHADOW_RES, SHADOW_RES)
  shadow_prev.type = HalfFloatType
  shadow_prev.generateMipmaps = false
  const weather_map = new StorageTexture(WEATHER_RES, WEATHER_RES)
  weather_map.type = HalfFloatType
  weather_map.generateMipmaps = false

  /** downwind translation of the field at time t (units). @param {*} t float node @returns {*} vec2 */
  const drift_at = (t) => wind_direction.mul(t.mul(DRIFT_V))

  /**
   * Cloud density at a world position — the SHADOW-map optical-depth sampler (frozen drift). Mirrors
   * the JS `coverage_remap`/perlin-worley path. (The view-march caller was deleted with the flat-deck
   * rework; this now serves only the top-down shadow integral, always `frozen`.)
   * @param {*} wp vec3 world position node
   * @param {boolean} [frozen] bake with drift pinned at `u_drift_base` (shadow map re-bake determinism)
   * @returns {*} float density node
   */
  const sample_density = (wp, frozen = false) => {
    const h_norm = wp.y.sub(cloud_bottom).div(slab)
    const in_layer = smoothstep(0, 0.12, h_norm).mul(smoothstep(1, 0.55, h_norm))
    const drift = frozen ? vec2(u_drift_base) : drift_at(u_time)
    const xz = wp.xz.sub(drift)
    const w_uv = xz.div(WEATHER_WORLD).add(0.5).fract()
    const weather = smoothstep(0.3, 0.78, texture(weather_map, w_uv, 0).x)
    const cov = clamp(weather.sub(float(1).sub(coverage)), 0, 1).mul(2.2)
    const base = texture3D(base_noise, vec3(xz.x, wp.y, xz.y).div(3600).fract(), 0).x
    const dens = clamp(base.mul(cov).sub(float(0.32).mul(h_norm.add(0.45))), 0, 1).mul(in_layer)
    return dens.mul(density)
  }

  /**
   * FLAT cloud coverage→alpha at a world xz (deck altitude `deck_y`), drift-advected. A baked low-freq
   * weather blob (where clouds gather) × a procedural high-freq mx_ fbm (cauliflower puffs), soft-edged,
   * smoothed toward the low-freq blob with hit distance (anti-moiré). The per-DECK 2D field the ray-plane
   * sample reads — no vertical march.
   * @param {*} xz vec2 world-xz node (this function drifts it)
   * @param {number} deck_y the deck's world-y (a constant domain offset on the noise)
   * @param {boolean} detail add the fast-drifting erosion octave (the visible deck: yes)
   * @returns {*} float alpha [0,1]
   */
  const deck_alpha = (xz, deck_y, detail) => {
    // SHAPE = a baked LOW-FREQ weather blob (where clouds gather) × PROCEDURAL HIGH-FREQ mx_ fbm (the
    // cauliflower puffs). The procedural fbm is CONTINUOUS over all of R² — no baked-texture .fract()
    // wrap, so NO vertical SEAMS (the 3600-unit tiling artifact the old baked slice produced), and it
    // carries true ~380 m puff detail the 512² weather field simply doesn't hold. A handful of ALU ops
    // per pixel — still ~zero cost.
    const drift = drift_at(u_time)
    const p = xz.sub(drift)
    // large-scale coverage: where clouds gather vs clear sky (baked weather, ±13 km tiling → seam past horizon).
    // The threshold maps [thresh, thresh+0.2] of the weather field to [clear, dense]; at coverage=0 the
    // lower edge is 1.0 so the whole (≤1) field reads CLEAR (a clean coverage kill — matches the deleted
    // march's clamp(weather-1) and lets the atmosphere on/off A/B blank the deck exactly).
    const weather = texture(weather_map, p.div(WEATHER_WORLD).add(0.5), 0).x
    const thresh = float(1).sub(coverage)
    const gather = smoothstep(thresh, thresh.add(0.2), weather)
    // procedural cauliflower puffs (~380 m base period), drifting.
    const q = p.div(380).add(vec2(float(deck_y).mul(0.013), float(deck_y).mul(0.017)))
    // ANALYTIC ANTI-ALIASING (kills the concentric moiré rings AT THE ROOT, any view angle): a flat plane
    // sampled toward near-vertical/grazing sweeps MANY noise periods per pixel → the 380 m fbm beats
    // against pixel spacing into concentric rings. `fwidth(q)` = the per-pixel FOOTPRINT in noise-domain
    // units; when it approaches/exceeds one period the sub-period detail is unresolvable and MUST be
    // suppressed (mip logic). `lod` = 0 where the footprint is small (near/overhead — full cauliflower),
    // →1 where it's large (far/grazing — smooth to the low-freq blob). This is the correct fix; the puff
    // frequency no longer aliases because it's faded out exactly where it can't be sampled.
    const foot = max(fwidth(q.x).abs(), fwidth(q.y).abs())
    const lod = smoothstep(0.25, 0.8, foot)
    let puff = mx_fractal_noise_float(vec3(q.x, q.y, float(deck_y).mul(0.05)), 4, 2.0, 0.55, 1)
      .mul(0.5)
      .add(0.5)
    if (detail) {
      // faster-drifting fine erosion so masses CHURN (not slide) — a second, higher-freq octave, its
      // amplitude killed by `lod` (it aliases first, being higher-freq).
      const q2 = xz.sub(drift_at(u_time.mul(DETAIL_DRIFT_MUL))).div(150)
      const det = mx_fractal_noise_float(vec3(q2.x, q2.y, float(deck_y).mul(0.09)), 3, 2.0, 0.5, 1)
        .mul(0.5)
        .add(0.5)
      puff = clamp(puff.sub(det.mul(float(0.28).mul(float(1).sub(lod)))), 0, 1)
    }
    // fade the puff STRUCTURE toward the smooth low-freq blob by `lod` — unresolvable far detail becomes
    // a hazy sheet (no rings), near detail keeps full shape. `mean_shape` is the DC level the puffs
    // average to, so the far deck holds the same coverage without the aliasing structure.
    const shaped = smoothstep(0.42, 0.72, puff)
    const mean_shape = smoothstep(0.42, 0.72, float(0.5))
    const cov = clamp(mix(shaped, mean_shape, lod).mul(gather), 0, 1)
    return cov.mul(density)
  }

  /**
   * Top-down cloud-shadow transmittance at a world xz (sampled by terrain + froxels — SACRED consumer
   * `cloud_shadow_at`, froxels.js:288). ENG-15: crossfades old→new footprint (`u_shadow_blend`) so a
   * re-bake dissolves smoothly, and WIDE-fades the contribution to 1 (no shade) at the footprint edge.
   * @param {*} wxz vec2 node @returns {*} float transmittance node
   */
  // [2026-07-05 — walls of a box followed the camera, gating the haze lights into a static low-res
  // circular halo] The mean transmittance the footprint edge fades to. The old edge faded to 1.0 (CLEAR SKY)
  // while the interior averaged ~(1−coverage·absorb) — so the froxel sun-scatter showed a ~900 m
  // dark→bright radial transition around the camera, quantized by the froxel grid into concentric
  // banded rings, sun-tinted, jumping on every drift rebake: THE omnipresent white-circle artifact
  // (it survived the cloud-march and godrays deletions because it was neither — it was this edge).
  // Fading to the MEAN cloudiness makes inside-vs-beyond statistically identical ⇒ ring amplitude ≈ 0.
  // Kept in sync with the live coverage knob every tick (cheap uniform write).
  const u_shadow_mean = uniform(0.7)
  /** @param {*} wxz vec2 node @returns {*} float transmittance node */
  const shadow_at = (wxz) => {
    const resid = drift_at(u_time).sub(vec2(u_drift_base))
    // Map world xz into the CAMERA-CENTERED footprint (u_shadow_center), drift-compensated.
    const uv = wxz.sub(vec2(u_shadow_center)).sub(resid).div(shadow_world).add(0.5)
    // WIDE edge fade (SHADOW_EDGE_FADE): interior transmittance ramps to the MEAN cloudiness (never
    // to clear-sky 1.0 — see u_shadow_mean above) over the outer `fade` on each side.
    const f = SHADOW_EDGE_FADE
    const inside = smoothstep(0.0, f, uv.x)
      .mul(smoothstep(1.0, 1.0 - f, uv.x))
      .mul(smoothstep(0.0, f, uv.y))
      .mul(smoothstep(1.0, 1.0 - f, uv.y))
    const uvc = clamp(uv, 0, 1)
    // ENG-15 crossfade: lerp the previous footprint's transmittance toward the fresh one by the blend
    // ramp — a re-bake (drift or recenter) fades in over SHADOW_BLEND_S rather than popping.
    const t_new = texture(shadow_map, uvc).x
    const t_old = texture(shadow_prev, uvc).x
    const t = mix(t_old, t_new, u_shadow_blend)
    return mix(u_shadow_mean, t, inside)
  }

  // ---- bake kernels (built once; run on bake()) --------------------------------------------------
  const build_base_kernel = () => {
    const N = BASE_RES
    const k = Fn(() => {
      const i = instanceIndex
      If(i.greaterThanEqual(N * N * N), () => {
        Return()
      })
      const x = i.mod(N)
      const y = i.div(N).mod(N)
      const z = i.div(N * N)
      const p = vec3(float(x), float(y), float(z)).add(0.5).div(N)
      const pw = p.mul(4)
      const perlin = mx_fractal_noise_float(pw.mul(2), 4, 2.0, 0.55, 1).mul(0.5).add(0.5)
      const w0 = float(1).sub(clamp(mx_worley_noise_float(pw.add(off3(off[0])), 1), 0, 1))
      const w1 = float(1).sub(clamp(mx_worley_noise_float(pw.mul(2.03).add(off3(off[1])), 1), 0, 1))
      const w2 = float(1).sub(clamp(mx_worley_noise_float(pw.mul(4.01).add(off3(off[2])), 1), 0, 1))
      const wfbm = w0.mul(0.625).add(w1.mul(0.25)).add(w2.mul(0.125))
      const pwv = clamp(perlin.sub(wfbm.oneMinus()).div(wfbm.max(1e-3)), 0, 1)
      textureStore(base_noise, uvec3(x.toUint(), y.toUint(), z.toUint()), vec4(pwv, 0, 0, 1)).toWriteOnly()
    })().compute(N * N * N)
    k.setName('cloudBaseNoise')
    return k
  }

  const build_weather_kernel = () => {
    const W = WEATHER_RES
    const k = Fn(() => {
      const i = instanceIndex
      If(i.greaterThanEqual(W * W), () => {
        Return()
      })
      const x = i.mod(W)
      const y = i.div(W)
      const uv01 = vec2(float(x).add(0.5), float(y).add(0.5)).div(W)
      const w_uv = uv01.sub(0.5).mul(WEATHER_WORLD / 5200)
      const v = mx_fractal_noise_float(w_uv, 3, 2.2, 0.5, 1).mul(0.5).add(0.5)
      textureStore(weather_map, uvec2(x.toUint(), y.toUint()), vec4(v, 0, 0, 1)).toWriteOnly()
    })().compute(W * W)
    k.setName('cloudWeather')
    return k
  }

  // The shadow integral kernel, dispatched ONE band (SHADOW_BAND texels) at a time: the texel index is
  // instanceIndex + u_tile_base, so the caller bakes the whole map either all-bands-at-once (bake() /
  // refresh_shadow(), awaited under the boot veil / on a rare ToD change) or one-band-per-frame (tick()'s
  // amortised drift re-bake). Same math ⇒ identical map; only WHEN each texel is written differs.
  const build_shadow_kernel = () => {
    const S = SHADOW_RES
    const k = Fn(() => {
      const i = instanceIndex.add(u_tile_base)
      If(i.greaterThanEqual(S * S), () => {
        Return()
      })
      const x = i.mod(S)
      const y = i.div(S)
      // World xz of this texel in the CAMERA-CENTERED footprint (u_shadow_center) — the bake tracks the
      // player so the shadowed region always surrounds the view (shadow_at maps back through the same center).
      const wpos = vec2(float(x).add(0.5), float(y).add(0.5))
        .div(S)
        .sub(0.5)
        .mul(shadow_world)
        .add(vec2(u_shadow_center))
      const STEPS = 20
      const dh = slab / STEPS
      const tau = float(0).toVar()
      Loop(STEPS, (/** @type {{i:*}} */ { i: si }) => {
        const h = float(si).add(0.5).mul(dh).add(cloud_bottom)
        const kk = h.sub(cloud_bottom).div(sun_direction.y.abs().max(0.15))
        const sp = wpos.add(vec2(sun_direction.x, sun_direction.z).mul(kk).negate())
        tau.addAssign(sample_density(vec3(sp.x, h, sp.y), true).mul(dh))
      })
      const trans = exp(tau.mul(-SHADOW_EXTINCTION))
      textureStore(shadow_map, uvec2(x.toUint(), y.toUint()), vec4(trans, 0, 0, 1)).toWriteOnly()
    })().compute(SHADOW_BAND)
    k.setName('cloudShadowMap')
    return k
  }

  /** Bake the ENTIRE shadow map now by dispatching every band back-to-back (awaited). Used at setup
   *  (the loading veil hides the one-time cost) and on a rare ToD refresh — NOT the per-2.5 s drift
   *  re-bake, which tick() amortises one band per frame. @param {*} renderer */
  const bake_all_bands = async (renderer) => {
    for (let t = 0; t < SHADOW_REBAKE_TILES; t += 1) {
      u_tile_base.value = t * SHADOW_BAND
      await renderer.computeAsync(shadow_kernel)
    }
  }

  // ENG-15 crossfade: copy the current shadow_map → shadow_prev before a re-bake overwrites it. A
  // tiny per-texel copy kernel (cheaper than a renderer.copyTextureToTexture dance across the two
  // StorageTextures, and stays inside the compute path the module already uses).
  const build_shadow_snapshot_kernel = () => {
    const S = SHADOW_RES
    const k = Fn(() => {
      const i = instanceIndex
      If(i.greaterThanEqual(S * S), () => {
        Return()
      })
      const x = i.mod(S)
      const y = i.div(S)
      const uv01 = vec2(float(x).add(0.5), float(y).add(0.5)).div(S)
      const t = texture(shadow_map, uv01).x
      textureStore(shadow_prev, uvec2(x.toUint(), y.toUint()), vec4(t, 0, 0, 1)).toWriteOnly()
    })().compute(S * S)
    k.setName('cloudShadowSnapshot')
    return k
  }

  /** @type {*} */
  let shadow_kernel = null
  /** @type {*} */
  let snapshot_kernel = null

  /**
   * Bake all fields + the initial shadow map. Await once during renderer setup.
   * @param {*} renderer WebGPURenderer
   */
  const bake = async (renderer) => {
    await renderer.computeAsync(build_base_kernel())
    await renderer.computeAsync(build_weather_kernel())
    shadow_kernel = build_shadow_kernel()
    snapshot_kernel = build_shadow_snapshot_kernel()
    await bake_all_bands(renderer)
    // seed the crossfade source = the initial bake (so the first sampled frame isn't a mix with garbage).
    await renderer.computeAsync(snapshot_kernel)
    u_shadow_blend.value = 1
  }

  /** re-bake the shadow map after a sun/ToD change (crossfaded). @param {*} renderer */
  const refresh_shadow = async (renderer) => {
    if (!shadow_kernel) return
    state.tile_next = -1 // a ToD refresh supersedes any in-flight tiled drift bake (they share u_tile_base)
    if (snapshot_kernel) await renderer.computeAsync(snapshot_kernel) // freeze the old footprint
    u_drift_base.value.copy(wind_direction.value).multiplyScalar(state.time_acc * DRIFT_V)
    state.last_bake_t = state.time_acc
    state.blend_t0 = state.time_acc
    u_shadow_blend.value = 0
    await bake_all_bands(renderer)
  }

  /**
   * per-frame: advance the weather clock; drive the shadow crossfade ramp; recenter the shadow
   * footprint on the camera when it roams; re-bake the drifted (and/or recentered) shadow map. Re-bakes
   * on EITHER the ~2.5 s drift cadence OR a camera move past SHADOW_RECENTER_M — each snapshots the old
   * map first and restarts the crossfade so nothing pops. @param {*} renderer @param {number} dt
   * @param {[number,number]} [cam_xz]
   */
  const tick = (renderer, dt, cam_xz) => {
    state.time_acc += dt
    u_time.value = state.time_acc
    // Keep the edge-fade target at the field's mean transmittance (see u_shadow_mean): a coverage-c
    // cloud field passes ~(1−c) clear + c·attenuated light — c·0.55 tracks the bake's typical optical
    // depth. Cheap uniform write; follows the live coverage knob.
    u_shadow_mean.value = Math.max(0.2, 1 - coverage.value * 0.55)
    // advance the crossfade ramp toward 1 (linear over SHADOW_BLEND_S) — but HOLD while a tiled re-bake
    // is still filling shadow_map (tile_next ≥ 0): we keep the frozen prev on screen at blend 0 until
    // the last band lands, so a half-written map is never blended in (that would be the visible change).
    if (state.tile_next < 0 && u_shadow_blend.value < 1) {
      u_shadow_blend.value = Math.min(1, (state.time_acc - state.blend_t0) / SHADOW_BLEND_S)
    }
    // Recenter the footprint if the camera left the current centered cell (SHADOW_RECENTER_M grid). NOT
    // while a tiled bake runs — moving u_shadow_center mid-pass would tear the map across bands (early
    // bands baked at the old centre, later at the new). A ≤12-frame deferral of the recenter is invisible.
    let recenter = false
    if (cam_xz && state.tile_next < 0) {
      const moved = Math.hypot(cam_xz[0] - state.shadow_cx, cam_xz[1] - state.shadow_cz)
      if (moved > SHADOW_RECENTER_M) {
        ;[state.shadow_cx, state.shadow_cz] = cam_xz
        u_shadow_center.value.set(cam_xz[0], cam_xz[1])
        recenter = true
      }
    }
    // START a tiled re-bake on the drift cadence OR a recenter — only when one isn't already in flight.
    // Snapshot the old footprint, advance the drift, and hold blend at 0; the ramp starts when the LAST
    // band bakes (below), so the drift shade never pops and the compute never spikes a single frame.
    const drifted = state.time_acc - state.last_bake_t > SHADOW_REBAKE_S
    if ((drifted || recenter) && shadow_kernel && state.tile_next < 0) {
      if (snapshot_kernel) renderer.compute(snapshot_kernel) // freeze old footprint for the crossfade
      u_drift_base.value.copy(wind_direction.value).multiplyScalar(state.time_acc * DRIFT_V)
      state.last_bake_t = state.time_acc
      u_shadow_blend.value = 0
      state.tile_next = 0
    }
    // TILE PUMP: bake ONE texel-band per frame while a re-bake is in flight — THIS is the amortisation.
    if (state.tile_next >= 0 && shadow_kernel) {
      u_tile_base.value = state.tile_next * SHADOW_BAND
      renderer.compute(shadow_kernel)
      state.tile_next += 1
      if (state.tile_next >= SHADOW_REBAKE_TILES) {
        state.tile_next = -1
        state.blend_t0 = state.time_acc // fresh map complete → crossfade it in over SHADOW_BLEND_S now
      }
    }
  }

  /**
   * Sample the FLAT cloud layer for a view ray → { color, alpha } (premultiplied). A single ray-plane
   * intersection (no march). The post-chain composites this by depth exactly as before (terrain occludes
   * via `max_dist_m`; clouds sit over the sky). Sun-tinted (dawn/dusk color preserved via `sun_radiance`),
   * distance-faded so the flat far edge dissolves into the horizon haze instead of showing against the dome.
   * @param {*} cam_pos vec3 node @param {*} dir vec3 node (normalized)
   * @param {*} max_dist_m float node (scene depth in meters — terrain occludes nearer clouds)
   * @returns {{ color: *, alpha: * }}
   */
  const cloud_layer = (cam_pos, dir, max_dist_m) => {
    const sun_dir = sun_direction.normalize()
    // ambient sky where the deck sits (blend up-ish + view-dir so tint reads from the sky palette).
    const ambient = sample_sky(vec3(dir.x, dir.y.abs().max(0.25), dir.z))
      .mul(0.5)
      .add(sample_sky(dir).mul(0.5))
    // SUN TINT (dawn/dusk hue) WITHOUT the raw HDR magnitude — normalize sun_radiance to a ~unit-luma
    // tint so the lit cloud is a BRIGHT SOFT WHITE (bounded), not a blown-out pure-white sheet (the old
    // march's blowout). The tint still reddens at dawn/dusk (the halo turning brown at midnight is
    // CORRECT — it's sun-tinted). `up` fades the sun contribution out below the horizon (night decks go dim/blue).
    const sun_luma = sun_radiance.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-3)
    const sun_tint = sun_radiance.div(sun_luma)
    const up = clamp(sun_dir.y.add(0.1).div(0.2), 0, 1)
    // silver-lining: forward-scatter toward the sun brightens the lit deck (cheap dot, no phase march).
    const nu = clamp(dir.dot(sun_dir), 0, 1)
    const silver = nu.mul(nu).mul(0.5).add(0.5)
    // cloud body radiance = a bounded bright white (DECK_SUN_GAIN·silver·up), sun-tinted, plus a soft
    // sky-ambient fill so shaded parts read cool, not black. Bounded well under the bloom threshold.
    const lit = sun_tint.mul(silver.mul(up).mul(DECK_SUN_GAIN)).add(ambient.mul(0.6))

    // FROM-BELOW form: looking UP at the deck (dir.y>0) shows its shaded underbelly slightly darker than
    // its sunlit top (dir.y<0, from above) — a cheap top/bottom shade so the deck has volume, not a flat sheet.
    const face = mix(float(0.72), float(1.0), smoothstep(-0.2, 0.2, dir.y.negate()))

    // SINGLE deck (see MAIN_DECK_FRAC — two planes moiré into rings). ray-plane hit: t where
    // cam_pos.y + dir.y·t = deck_y. Only when the deck is in FRONT of the ray AND nearer than the scene
    // hit (terrain occludes). Looking away from the deck ⇒ t<0 ⇒ no cloud.
    const t = float(main_deck_y).sub(cam_pos.y).div(dir.y)
    const hit = t.greaterThan(0).and(t.lessThan(max_dist_m)).and(dir.y.abs().greaterThan(1e-4))
    const xz = vec2(cam_pos.x.add(dir.x.mul(t)), cam_pos.z.add(dir.z.mul(t)))
    // DISTANCE FADE (the horizon dissolve): fade the deck alpha to 0 across [DECK_FADE_START,
    // DECK_FADE_END] of hit distance so the FLAT far edge never shows as a line against the dome —
    // clouds dissolve into the horizon haze like a real overcast.
    const dist_fade = smoothstep(DECK_FADE_END, DECK_FADE_START, t)
    const a_raw = deck_alpha(xz, main_deck_y, true).mul(dist_fade)
    const alpha = hit.select(a_raw, float(0))
    // POWDER: thin cloud edges scatter brighter, dense cores sit a touch darker — gives the deck internal
    // FORM (the cauliflower relief) instead of a uniform white. Then the top/bottom face shade. The color
    // is premultiplied by alpha so the post-chain composite is the standard over.
    const powder = float(0.78).add(alpha.mul(0.22))
    return { color: lit.mul(powder).mul(face).mul(alpha), alpha }
  }

  /**
   * Two-phase teardown (house law: STOP the ticker reaching the GPU first, RELEASE GPU second). Null the
   * bake kernels so `refresh_shadow` and `tick`'s drift re-bake go inert through their EXISTING
   * `shadow_kernel` guards — a late time-of-day poke on a torn-down world (engine.js set_time_of_day →
   * atmosphere on_time_of_day → here) can no longer `computeAsync` a disposed renderer, which is what
   * threw "THREE.WebGPUTextureUtils: Texture already initialized" uncaught, forever, after logout. THEN
   * free the four baked textures (otherwise every logout→login cycle leaks a full cloud bake on the GPU).
   */
  const dispose = () => {
    shadow_kernel = null // refresh_shadow: `if (!shadow_kernel) return`; tick: `&& shadow_kernel` — both inert
    snapshot_kernel = null
    base_noise.dispose()
    shadow_map.dispose()
    shadow_prev.dispose()
    weather_map.dispose()
  }

  return {
    base_noise,
    shadow_map,
    weather_map,
    coverage,
    density,
    sun_direction,
    sun_radiance,
    wind_direction,
    tier,
    bake,
    refresh_shadow,
    tick,
    shadow_at,
    cloud_layer,
    dispose,
  }
}
