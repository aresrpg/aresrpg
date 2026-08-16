// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG2-F froxel volumetrics — TSL/GPU factory ported from fable5-world-demo's
// `src/gpu/passes/Froxels.ts`. Portions adapted from fable5-world-demo, MIT,
// Copyright (c) 2026 Remi Sebastian Kits.
//
// Faithful port of: a 160×90×64 camera-frustum froxel grid rebuilt per frame in two compute passes
// — SCATTER (per froxel: height-fog density + in-scatter source + sun visibility) and INTEGRATE
// (per screen column: front-to-back walk with the CLOSED-FORM per-slice integral S/σ·(1−e^(−σ·dz)),
// NO prefix-sum — playbook DO-NOT #13, and their own code confirms the serial march). Exponential
// depth slices (2 m → 480 m); the post stack samples `integTex` trilinearly and composites.
//
// STANDALONE-WAVE ADAPTATION (no live-renderer wiring): the demo's `Heightfield` / `Clouds` /
// `sunU` / canopy couplings become INJECTABLE hooks the wiring wave mounts — `sample_height(xz)`,
// `moisture_at(xz)`, `sample_sky(dir)`, `density_hook(p, rho)` (the biome-humidity / cave-enclosure
// DENSITY INPUT left open — swamp/cave fog coupling lands at wiring), `cloud_shadow_at(xz)` and
// `canopy_at(xz)` (light-shaft terms, hooks not wired), plus `sun_direction`/`sun_color` uniforms.
// The closed-form integration + slice mapping are exported as PURE functions, unit-tested against a
// brute-force RTE reference. GPU-pass correctness is a wiring-wave concern.

import { Matrix4, Vector3 } from 'three'
import { Storage3DTexture } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  Return,
  clamp,
  exp,
  float,
  hash,
  instanceIndex,
  interleavedGradientNoise,
  mat4,
  mix,
  mx_fractal_noise_float,
  screenCoordinate,
  smoothstep,
  texture3D,
  textureStore,
  time,
  uniform,
  uvec3,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

/** default froxel grid + depth range. [S-85] Synced to the HIGH ceiling (create_froxels defaults to
 *  FROXEL_TIERS.high) after the ultra→high collapse — the default grid IS the top rung. */
export const FX = 192
export const FY = 108
export const FZ = 96
export const NEAR = 2
export const FAR = 480
/** forward-leaning HG asymmetry — shafts bloom toward the sun. */
export const FROXEL_HG_G = 0.5
/** ENG-12 (2026-07-03) tone-cap on the density-keyed sun-scatter boost `1+min(rho·gain, CAP)`. Beams
 *  want 4-8×; the cap bounds the multiplier so a rho spike (dense enclosure + sunlit gap) can never
 *  accumulate into the blown radial white smear that was flagged. gain 60 × rho 0.037 ≈ 2.2 (< cap)
 *  under canopy; the cap only bites on pathological density, killing the whiteout while beams survive. */
export const BEAM_BOOST_CAP = 5
/** ENG-12 (2026-07-03) base sun in-scatter lift (target: "rays too rare, sun powerfully creating rays"):
 *  a flat multiplier on the SUN term so ANY sunlit gap paints a visible beam, not just dense-enclosure
 *  ones. The bloom pass (post_stack) then gives the bright core its cinematic halo. Only the sun term is
 *  lifted (amb untouched) so shadowed fog stays dark and the beam CONTRAST is preserved. */
export const BEAM_BASE = 1.8
/** ENG-14 (2026-07-03) enclosure-gated cap CEILING — the boost tone-cap raised specifically for DENSE
 *  fog columns (under canopy / in caves), where beams live and where the per-cell checker died. The
 *  per-PIXEL dither in `apply` makes a higher gain safe (no coherent cell-wall can form), so the cap
 *  lerps {@link BEAM_BOOST_CAP}→this with enclosure. Open air keeps the low cap (fog law). */
export const BEAM_BOOST_CAP_ENCL = 11
/** ENG-14 (2026-07-03) under-canopy beam GAIN — a multiplicative lift on the sun in-scatter gated by
 *  `encl` (dense fog only), so shafts read as UNMISSABLE warm beams where the sun pierces canopy gaps
 *  (target: "greatly improve … most of the time during the day") while open vistas stay byte-clean. */
export const ENCLOSURE_BEAM_GAIN = 2.2
/** ENG-19 (2026-07-04) BUG-2 SEALED-ENCLOSURE beam kill — keyed on SKY-OPENNESS (voxel_sun .g, the
 *  straight-up ray), the clean discriminator the angled sun-visibility (.r) is NOT. A fully-sealed cave
 *  roof reads openness≈0; forest canopy keeps openness>0 through its gaps; open air =1. The froxel
 *  sun-beam is scaled by `1 − smoothstep(SEAL_HI, SEAL_LO, openness)·KILL` (reversed edges: openness
 *  BELOW SEAL_LO ⇒ full kill). So a sealed room — where the sun-visibility reads a garbage uniform ~0.95
 *  and would wash the dense enclosure fog into the whiteout curtains — loses the froxel beam, while the
 *  FOREST froxel-shaft win (openness ≥ SEAL_HI through gaps) + open-air fog law stay byte-unchanged.
 *  Sealed-room shafts through real ceiling holes now come from surface bloom alone (the screen-space
 *  GodraysNode pass was deleted 2026-07-05); the dark cool `amb` fog carries the cave mood (the amb-only
 *  debug capture = the target dark-dungeon look). */
export const BEAM_SEAL_LO = 0.08
export const BEAM_SEAL_HI = 0.28
/** fraction of the froxel sun-beam removed at full seal (openness→0). 0.92 leaves a faint 8% so a genuine
 *  ceiling-hole column (where sun-vis really is 1) still hints a shaft, without the volume-filling milk. */
export const BEAM_SEAL_KILL = 0.92
/** ENG-14 (2026-07-03) isotropic-scatter blend under enclosure — the HG phase is forward-peaked, so
 *  beams VANISH when the view isn't sunward and the sun is high. Under canopy we lerp the phase toward
 *  isotropic (`1/4π`) by `encl·this`, so dense-fog shafts read from ANY view angle + at NOON (vertical
 *  cathedral beams), the classic forest light. Open air keeps pure HG (correct aerial forward-scatter). */
export const FROXEL_ISO_MIX = 0.75
/** ENG-19 (2026-07-04) BUG-2 whiteout fix — the per-channel SOFT-SHOULDER ceiling on the INTEGRATED
 *  froxel in-scatter (linear HDR), applied in `apply` as `L/(1+L/CAP)`. The scatter INTEGRAL is exact
 *  (RTE-pinned), but a beam source over 64 dense slices accumulates unbounded → the white vertical
 *  curtains that were captured (even inside caves, no clouds). This bounds the ACCUMULATED result: a beam
 *  core still reads bright (asymptotes toward CAP) and clears the bloom threshold (2.05) for its halo,
 *  but no ray can paint a region pure white. 2.0 is tuned as the balance: high enough that a genuine
 *  bright shaft's core still reads luminous (forest beams keep their glow, dither + grade give life),
 *  low enough that the enclosure/fog-sea wash can never accumulate into the blown-white curtains that
 *  were the BUG-2 look (proven: cave-orbit peak white-pixel frac 42%→~1%). The SEALED-cave beam kill
 *  (below) is what turns the sealed interior dark; this shoulder is the scene-agnostic saturation guard. */
export const SCATTER_CAP = 2.0
/** [2026-07-05 FROXEL REBUILD — PLAN A] Heightfield sun-occlusion taps: [reach_m, penumbra_m]. Four
 *  taps toward the sun at roughly-doubling reach, each `lit_i = smoothstep(0, penumbra_i, (p + t_i·sun).y
 *  − height((p + t_i·sun).xz))`, multiplied. The penumbra WIDENS with reach (a blocker far up-sun casts a
 *  soft shadow at p — physical soft-shadow behavior) so the field is smooth in every dimension: the input
 *  the froxel slice sampler was designed for (see the PLAN A block in the scatter kernel). */
export const HF_SUN_TAPS = /** @type {ReadonlyArray<readonly [number, number]>} */ ([
  [8, 4],
  [24, 10],
  [64, 24],
  [160, 56],
])
/** [2026-07-05 FROXEL REBUILD] 2-point Gauss-Legendre abscissa (1/√3) as a fraction of the slice
 *  HALF-thickness — the per-slice density quadrature that killed the arc staircase (see the scatter
 *  kernel's ARC CARRIER block). ρ is sampled at center ± half_dz·this and averaged: exact slice mean
 *  for linear ρ, O(dz⁴) error for smooth fields — deterministic, so no jitter noise remains at all. */
export const GAUSS_2PT = 1 / Math.sqrt(3)

/**
 * @typedef {object} FroxelTier
 * @property {number} fx @property {number} fy @property {number} fz grid dimensions
 */
// keyed by the `TierName` from core/quality/tiers.js so wiring can index `FROXEL_TIERS[tier]`.
// (Only consumed at HIGH via ?froxels=1 — DEFAULT OFF, white-halo law.) LOW = the old potato grid,
// MEDIUM unchanged, HIGH inherits the old ultra ceiling.
/** @type {Readonly<Record<'low'|'medium'|'high', FroxelTier>>} */
export const FROXEL_TIERS = {
  low: { fx: 80, fy: 45, fz: 32 },
  medium: { fx: 128, fy: 72, fz: 64 },
  high: { fx: 192, fy: 108, fz: 96 },
}

// --- pure math (exported + unit-tested; the TSL kernels mirror these) -----------------------------

/**
 * Exponential slice parameter → view distance. `slice_dist(0)=near`, `slice_dist(1)=far`.
 * @param {number} u slice parameter [0,1] @param {number} [near] @param {number} [far] @returns {number}
 */
export function slice_dist(u, near = NEAR, far = FAR) {
  return near * (far / near) ** u
}

/**
 * Inverse of `slice_dist` — a view distance → its slice parameter [0,1] (the `apply` depth mapping).
 * @param {number} dist meters @param {number} [near] @param {number} [far] @returns {number}
 */
export function depth_to_slice_w(dist, near = NEAR, far = FAR) {
  const w = Math.log2(Math.max(dist, near) / near) / Math.log2(far / near)
  return w < 0 ? 0 : w > 1 ? 1 : w
}

/**
 * @typedef {object} FroxelSlice
 * @property {[number,number,number]} scatter in-scatter SOURCE × σ (rgb), exactly as stored in the scatter texture.
 * @property {number} sigma extinction (1/m) for the slice.
 * @property {number} dz slice thickness (m).
 */
/**
 * CLOSED-FORM front-to-back integration — THE shipped froxel integrator, in pure JS so a test can
 * pin it against a brute-force RTE reference. For each homogeneous slice: `Ts=e^(−σ·dz)`,
 * `Li=(S/σ)·(1−Ts)`, accumulate `L+=Li·T`, then `T*=Ts`. Matches the TSL `integK` op-for-op.
 * @param {FroxelSlice[]} slices front-to-back
 * @returns {{ L:[number,number,number], T:number }} accumulated radiance + remaining transmittance
 */
export function integrate_slices(slices) {
  let T = 1
  const L = [0, 0, 0]
  for (const s of slices) {
    const sigma = Math.max(s.sigma, 1e-6)
    const Ts = Math.exp(-sigma * s.dz)
    const w = (1 - Ts) / sigma
    for (let c = 0; c < 3; c++) L[c] += s.scatter[c] * w * T
    T *= Ts
  }
  return { L: /** @type {[number,number,number]} */ (L), T }
}

// --- TSL factory ---------------------------------------------------------------------------------

/**
 * @typedef {object} FroxelsOptions
 * @property {(xz:*)=>*} [sample_height] float ground-height node at a world xz (default flat sea level).
 * @property {(xz:*)=>*} [moisture_at] float [0,1] biome-moisture node (default 0.5 uniform).
 * @property {(dir:*)=>*} [sample_sky] keystone sky node — vec3 ambient for a direction (default constant).
 * @property {(p:*, rho:*, dist:*)=>*} [density_hook] biome-humidity / cave-enclosure DENSITY INPUT:
 *   maps (worldPos, baseRho, viewDistM)→rho. `dist` = the sample's camera distance (float node,
 *   meters) so hooks can WINDOW their term (e.g. the NG2-ATMO near-haze band fades out before the
 *   far field — a constant floor would integrate to a whiteout over the 480 m range).
 * @property {(xz:*)=>*} [cloud_shadow_at] float cloud-shadow transmittance (light-shaft hook, e.g. clouds.shadow_at).
 * @property {(xz:*)=>*} [canopy_at] float [0,1] canopy coverage (dappled-shaft hook).
 * @property {(p:*)=>*} [sun_visibility_at] ENG-10: float [0,1] sun visibility at a WORLD point (voxel_sun.js
 *   DDA volume). When supplied, it REPLACES the heightfield horizon march + canopy hack below — a real
 *   3D occupancy trace so shafts pierce actual canopy holes + cave mouths (view-independent). 1 = open sky.
 * @property {*} [sun_direction] `uniform(vec3)` world sun direction (share sky_node's).
 * @property {*} [sun_color] vec3 node/uniform — sun radiance (color × intensity).
 * @property {number} [shaft_gain] ENG-12 HEAVY-SHAFT boost: the sun in-scatter is ×(1+min(rho·gain,
 *   {@link BEAM_BOOST_CAP})) so beams read heavy where fog is DENSE (canopy/cave) and clean in thin
 *   open air (fog law). Default 60 (was 200 — unbounded; the 2026-07-03 whiteout regression).
 * @property {number} [beam_base] ENG-12 flat multiplier on the SUN in-scatter so ANY sunlit gap paints
 *   a visible beam (target: rays read as more present). Default {@link BEAM_BASE}.
 * @property {number} [scatter_cap] ENG-19 per-channel soft-shoulder ceiling on the INTEGRATED in-scatter
 *   (the BUG-2 whiteout fix — applied in `apply`). Default {@link SCATTER_CAP}.
 * @property {(p:*)=>*} [sky_openness_at] ENG-19 BUG-2: float [0,1] sky-openness at a WORLD point (1 open
 *   above → 0 fully sealed under a roof) — voxel_sun.js's `sample_sky_openness_at`. When supplied, the
 *   froxel sun-beam is faded under a FULL SEAL (openness→0): a sealed cave's unreliable sun-visibility
 *   would otherwise wash the dense enclosure fog into the whiteout curtains. Forest canopy (openness>0
 *   through gaps) + open air keep their beams. No-op (beam unchanged) when not supplied.
 * @property {*} [wind_direction] `uniform(vec2)` for billow advection.
 * @property {number} [sea_level] flat-ground fallback height.
 * @property {FroxelTier|keyof typeof FROXEL_TIERS} [tier] grid tier (default HIGH).
 */

/**
 * Build the froxel volumetrics system (textures + scatter/integrate kernels + apply node builder).
 *
 * DEFAULT OFF: the froxel scattering path (formerly the tier `volumetrics` = `froxel_scattering` value,
 * removed 2026-07-10) is OFF by default — atmosphere.js only builds it at HIGH/ULTRA AND behind the
 * `?froxels=1` flag, pending a post-release rebuild that must first ship a slice-banding + temporal-
 * freeze pixel test at the reference framings.
 * @param {FroxelsOptions} [opts]
 */
export function create_froxels(opts = {}) {
  const tier = typeof opts.tier === 'string' ? FROXEL_TIERS[opts.tier] : (opts.tier ?? FROXEL_TIERS.high)
  const gx = tier.fx
  const gy = tier.fy
  const gz = tier.fz
  const sea_level = opts.sea_level ?? 0

  const sun_direction = opts.sun_direction ?? uniform(new Vector3(0.3, 0.6, 0.2).normalize())
  const sun_color = opts.sun_color ?? uniform(new Vector3(8.0, 7.7, 7.2))
  const wind_direction = opts.wind_direction ?? uniform(vec2(1, 0))
  const sample_height = opts.sample_height ?? /** @param {*} _xz */ ((_xz) => float(sea_level))
  const moisture_at = opts.moisture_at ?? /** @param {*} _xz */ ((_xz) => float(0.5))
  const sample_sky = opts.sample_sky ?? /** @param {*} _d */ ((_d) => vec3(0.45, 0.55, 0.72))
  const density_hook = opts.density_hook ?? /** @param {*} _p @param {*} rho */ ((_p, rho) => rho)
  const cloud_shadow_at = opts.cloud_shadow_at ?? null
  const canopy_at = opts.canopy_at ?? null
  const sun_visibility_at = opts.sun_visibility_at ?? null
  const sky_openness_at = opts.sky_openness_at ?? null

  const fog_k = uniform(0.4)
  // ENG-12 HEAVY SHAFTS: density-keyed sun-scatter boost (live-tuned knob). 1/m→dimensionless.
  // Default 60 (was 200 — the unbounded value behind the 2026-07-03 whiteout); the boost is now
  // additionally tone-capped at BEAM_BOOST_CAP in the kernel so a live over-crank can't re-blow it.
  const shaft_gain = uniform(opts.shaft_gain ?? 60)
  // ENG-12 base sun in-scatter lift (target: rays read as more present) — a live knob so beam presence tunes
  // without a rebuild. Default BEAM_BASE. Live: window.__atmo.froxels.beam_base.value.
  const beam_base = uniform(opts.beam_base ?? BEAM_BASE)
  // ENG-19 (2026-07-04) BUG-2: soft-shoulder ceiling on the INTEGRATED in-scatter radiance (applied in
  // `apply`, per channel). Rolls the brightest fog columns off toward this value so no ray saturates a
  // region white (the enclosure/fog-sea whiteout curtains). Tuned so beam cores stay bright + bloom-
  // worthy (bloom threshold 2.05) but the milk can't form. Live knob: __atmo.froxels.scatter_cap.value.
  const scatter_cap = uniform(opts.scatter_cap ?? SCATTER_CAP)
  const u_cam_pos = uniform(new Vector3())
  const u_proj_inv = uniform(new Matrix4())
  const u_cam_world = uniform(new Matrix4())

  /** @param {number} w @param {number} h @param {number} d */
  const mk = (w, h, d) => {
    const t = new Storage3DTexture(w, h, d)
    t.type = 1016 // HalfFloatType
    return t
  }
  const scatter_tex = mk(gx, gy, gz)
  const integ_tex = mk(gx, gy, gz)

  /** exponential slice parameter (0..1) → view distance (m). @param {*} u float node @returns {*} */
  const slice_dist_node = (u) => float(NEAR).mul(float(FAR / NEAR).pow(u))

  // ---- SCATTER: source + extinction per froxel ---------------------------------------------------
  const scatter_k = Fn(() => {
    const i = instanceIndex
    If(i.greaterThanEqual(gx * gy * gz), () => {
      Return()
    })
    const x = i.mod(gx)
    const y = i.div(gx).mod(gy)
    const z = i.div(gx * gy)

    // world ray through the froxel column (screen-uv y flips into NDC).
    const su = vec2(float(x).add(0.5).div(gx), float(y).add(0.5).div(gy))
    const ndc = vec2(su.x, su.y.oneMinus()).mul(2).sub(1)
    const clip = vec4(ndc.x, ndc.y, 0.5, 1)
    const view_p = mat4(u_proj_inv).mul(clip)
    const dir_v = view_p.xyz.div(view_p.w).normalize()
    const dir_w = mat4(u_cam_world).mul(vec4(dir_v, 0)).xyz.normalize().toVar()
    const cam_pos = vec3(u_cam_pos)

    // [2026-07-05 FROXEL REBUILD — THE ARC CARRIER + ITS CURE: per-slice DENSITY QUADRATURE]
    // The reported camera-locked arcs were, in the end, a NUMERICAL defect of this pass. Each slice used
    // to store ρ sampled at ONE depth offset inside the slice (a hash(z) jitter, shared by every screen
    // column). Through height/distance-graded fog that single-point estimate carries a per-slice error
    // vs the true slice mean — IDENTICAL ACROSS THE WHOLE SCREEN — so the integral bakes a screen-
    // coherent per-slice transmittance/in-scatter signature, and `apply`'s w(dist) mapping paints the
    // iso-distance slice contours as camera-locked structure: concentric arcs around the zenith on the
    // cloud deck's smooth distances, "voxel-staircase ghost" bands along terrain distance contours —
    // the reported anatomy verbatim. STATIC jitter ⇒ static arcs; per-frame jitter ⇒ shimmering arcs
    // (verified live — both wrong). It survived every vis-side fix (heightfield occlusion, enclosure
    // gating, boundary feather, donut kill, bloom-off A/B) because ρ itself was the carrier.
    // THE CURE is proper quadrature, not noise: sample ρ at the slice's TWO GAUSS-LEGENDRE points
    // (center ± dz/(2√3)) and average — exact for linearly-varying ρ, O(dz⁴) for smooth fields — so the
    // stored value IS the slice mean and the staircase collapses in EVERY frame, deterministically.
    // Source terms (sun vis / phase / ambient) sample the slice CENTER: they vary far more slowly along
    // a ray than the exponential accumulation, and the smooth heightfield vis (PLAN A) cannot band.
    // ███ RED-BASELINE PATCH (temporary): pre-fix carrier.
    const d0 = slice_dist_node(float(z).div(gz))
    const d1 = slice_dist_node(float(z).add(1).div(gz))
    const jit = hash(float(z).mul(1.618).add(0.5))
    const dist = slice_dist_node(float(z).add(jit.mul(0.8).add(0.1)).div(gz)).toVar()
    const half_dz = d1.sub(d0).mul(0.5).toVar()
    const p = cam_pos.add(dir_w.mul(dist)).toVar()

    const ground_y = sample_height(p.xz)
    const sun_dir_n = sun_direction.normalize().toVar()

    // --- density (extinction, 1/m) — 2-point Gauss-Legendre mean over the slice ---
    const drift = wind_direction.mul(time.mul(3.2))
    // dawn/dusk fog is the look; noon goes near-zero (aerial perspective owns daytime haze).
    const tod_k = smoothstep(0.55, 0.08, sun_dir_n.y).mul(1.8).add(0.12)
    /** the full density pipeline at a sample position/distance — evaluated at both Gauss points.
     * @param {*} ps vec3 world-position node @param {*} ds float camera-distance node @returns {*} */
    const rho_at = (ps, ds) => {
      const billow = mx_fractal_noise_float(ps.xz.add(drift).mul(1 / 380), 2, 2.0, 0.5, 1)
        .mul(0.425)
        .add(0.45)
      const moisture = moisture_at(ps.xz)
      const h_above = ps.y.sub(sample_height(ps.xz)).max(0)
      const rho_ground = exp(h_above.div(-20))
      const rho_alt = exp(ps.y.sub(120).max(0).div(-140))
      // moisture-selective: m² with a small floor — dry slopes clear, basins keep their mist.
      const moist_k = moisture.mul(moisture).mul(1.5).add(0.25)
      const rho_base = fog_k
        .mul(tod_k)
        .mul(billow)
        .mul(rho_ground.mul(0.8).add(rho_alt.mul(0.2)))
        .mul(moist_k)
        .mul(0.0095)
      // injectable DENSITY INPUT (biome humidity / cave enclosure) — identity until wiring. `ds`
      // (this sample's camera distance) lets hooks window their density band.
      return density_hook(ps, rho_base, ds)
    }
    // ███ RED-BASELINE PATCH: single-tap density at the jittered depth.
    const rho = rho_at(p, dist).toVar()

    // [2026-07-05 FROXEL REBUILD] DEPTH-DECOHERE the voxel-sun VOLUME taps (a supporting measure — the
    // arc root cause was the ρ staircase above, and open air no longer touches the volume at all). The
    // volume's field is BINARY occupancy-derived (sharp 0↔1 shadow contours), so the enclosure beams
    // that DO sample it would otherwise read each slice at one fixed depth and quantize those contours
    // into per-slice shells. The taps are therefore offset by a hash keyed on the CELL (x,y,z) AND the
    // frame, spanning ±~1 slice thickness, and TWO opposed taps are averaged: adjacent cells/slices read
    // the field at different depths, so contour quantization decorrelates into fine per-cell noise that
    // the trilinear vis read + the per-pixel animated IGN in `apply` smooth away. Cost: one extra volume
    // tap per froxel (the vis texture is tiny/cached), only meaningful under enclosure.
    const slice_thick = half_dz.mul(2)
    // per-cell + per-frame phase in [-0.5,0.5]; the frame term animates so nothing converges to a static pattern.
    const vis_jit = hash(float(x).mul(12.99).add(float(y).mul(78.23)).add(float(z).mul(37.71)).add(time.mul(3.3))).sub(
      0.5
    )
    const vis_off = dir_w.mul(slice_thick.mul(vis_jit))
    const p_va = p.add(vis_off).toVar()
    const p_vb = p.sub(vis_off).toVar()

    // --- sun visibility — [2026-07-05 FROXEL REBUILD, PLAN A: the ancestry ruling] -------------------
    // This kernel was ported from a demo whose sun coupling was a SMOOTH HEIGHTFIELD; the reported
    // camera-locked arcs were born when the binary, camera-boxed, progressively-filled voxel-sun DDA
    // volume was injected into a sampler architecture designed for smooth input (every artifact property
    // followed: shells = sharp 0↔1 contours × camera-concentric depth slices; the ~10 s materialize =
    // the amortized fill; the jumps = the box recenter). The OPEN-AIR sun occlusion is therefore returned
    // to the HEIGHTFIELD: HF_SUN_TAPS taps toward the sun at increasing reach with a WIDENING PENUMBRA
    // (soft shadow far from the blocker) — smooth in every dimension, so there are no shells for the
    // slices to alias, no fill-in delay, no recenter jumps: arcs impossible BY INPUT, at FULL strength
    // (smooth input needs no damping — the pre-bug open-air beauty restored). The voxel volume is kept
    // ONLY where true 3D-ness earns it: the ENCLOSURE-gated beam terms (canopy gaps / cave ceiling holes
    // carve real shafts) + the sky-openness seal below.
    const vis_hf = float(1).toVar()
    for (const [t_m, penumbra_m] of HF_SUN_TAPS) {
      const q = p.add(sun_dir_n.mul(t_m))
      vis_hf.mulAssign(smoothstep(0, penumbra_m, q.y.sub(sample_height(q.xz))))
    }
    if (!sun_visibility_at && canopy_at) {
      // isolation-only canopy coverage hack — parity for harnesses with no voxel volume mounted.
      const dy = ground_y.add(13).sub(p.y)
      const cov_off = sun_dir_n.xz.mul(dy.max(0).div(sun_dir_n.y.max(0.08)))
      const cov = canopy_at(p.xz.add(cov_off))
      vis_hf.mulAssign(dy.greaterThan(0).select(cov.mul(0.88).oneMinus(), float(1)))
    }
    // ENG-10 DDA VOLUME (voxel_sun.js) — the ENCLOSURE beams' vis: a real 3D occupancy trace toward the
    // sun so shafts pierce actual canopy holes + cave mouths (the heightfield only knows the surface
    // silhouette). Sampled at the two depth-decohered positions and averaged (see DEPTH-DECOHERE above).
    // Falls back to the heightfield when not mounted (isolation).
    const vis_vox = float(1).toVar()
    if (sun_visibility_at) vis_vox.assign(sun_visibility_at(p_va).add(sun_visibility_at(p_vb)).mul(0.5))
    else vis_vox.assign(vis_hf)
    // [2026-07-05 STEP-DISABLE #1] Isolated by bisection: the froxel×cloud-shadow coupling is OFF:
    // multiplying the fog's sun term by the cloud-shadow map PAINTED THE WEATHER TEXTURE'S CLOUD
    // PATTERN INTO THE AIR around the camera — blocky (~23 m weather texels), camera-following (the
    // shadow footprint), WHITE by day / DARK by night (lit vs shadowed fog — the tod-colored signature),
    // materializing with the shadow bake (~seconds). It rode the ?froxels=0 gate, which is why that
    // flag was the one positive kill-test all night. Terrain cloud shadows (the beloved ground shade)
    // are untouched — this only stops projecting them into the VOLUME. ?fogshadow=1 re-enables for A/B.
    const fogshadow_on =
      typeof location !== 'undefined' && new URLSearchParams(location.search).get('fogshadow') === '1'
    if (cloud_shadow_at && fogshadow_on) {
      const cs = cloud_shadow_at(p.xz)
      vis_hf.mulAssign(cs)
      vis_vox.mulAssign(cs)
    }

    // --- in-scatter source ---
    // `encl` ramps 0→1 with rho so ONLY dense fog (under canopy / in caves ⇒ rho≈0.037/m) triggers the
    // enclosure-gated beam terms below; thin open-vista fog (rho≈2e-4/m) keeps encl≈0 ⇒ byte-unchanged
    // (fog law). Computed first so the phase blend + beam gain can read it.
    const encl = rho.mul(22).clamp(0, 1)
    // [2026-07-05 PLAN A] OPEN AIR rides the smooth heightfield occlusion at FULL strength (no damping —
    // smooth input cannot arc); ENCLOSURE (canopy/cave, encl→1) rides the 3D voxel volume so real carved
    // beams keep their drama. This replaces both the retired FOG_VIS_K amplitude temper and the interim
    // mix(1, vis, encl) contour gate — open-air fog now has REAL terrain sun-shadows again (world-anchored
    // dusk shadow volumes behind ridges), just sourced from a field that is smooth by construction.
    const vis_gen = mix(vis_hf, vis_vox, encl).toVar()
    const g = FROXEL_HG_G
    const cos_t = dir_w.dot(sun_dir_n)
    const phase_hg = float((1 - g * g) / (4 * Math.PI)).div(
      float(1 + g * g)
        .sub(cos_t.mul(2 * g))
        .pow(1.5)
    )
    // ENG-14 (2026-07-03) ALL-DAY BEAMS (target: "see them most of the time during the day, way too
    // minimal"): the HG lobe is forward-peaked, so pure-HG shafts DIE off-axis + at high sun. Under
    // enclosure, lerp toward ISOTROPIC (1/4π) so dense-fog beams read from ANY view angle and at NOON
    // (vertical cathedral shafts). Open air keeps pure HG (encl≈0) — correct aerial forward-scatter.
    const phase = mix(phase_hg, float(1 / (4 * Math.PI)), encl.mul(FROXEL_ISO_MIX))
    // shadowed fog sits dark so shafts have contrast; a flat term lifts blacks slightly.
    // ENG-12 BLUE AIR (target: "not blue enough"): dense enclosure fog gets a COOL, slightly-lifted sky
    // ambient so the shaded misty air READS blue — the atmospheric half of "blue shade", complementing
    // the surface ambient tint (warm sun / cool shade).
    const amb = sample_sky(vec3(0, 1, 0))
      .mul(mix(vec3(1, 1, 1), vec3(1.8, 2.4, 4.2), encl))
      .mul(0.018)
      .mul(vis_gen.mul(0.6).add(0.4))
    // ENG-12/14 HEAVY SHAFTS (target: "sun powerfully creating rays … greatly improve"): amplify the SUN
    // in-scatter where the fog is DENSE (canopy/cave) so beams read HEAVY under canopy, while thin open
    // air stays clean per the fog law. Only the sun term is lifted (amb stays flat) so shadow columns
    // keep sitting dark ⇒ the lit/shadowed CONTRAST that makes a beam visible grows with it.
    //
    // ENG-12 REGRESSION FIX (2026-07-03): the boost was ×(1+rho·gain) UNBOUNDED with gain 200 — where
    // rho spiked it accumulated over the column into a blown radial white smear (the "concentric arcs").
    // CLAMP to a tone-cap. ENG-14: the cap CEILING lerps up with `encl` (BEAM_BOOST_CAP→_ENCL) because
    // the per-PIXEL dither in `apply` killed the coherent cell-wall that unbounded density used to form,
    // so dense-fog columns — exactly where beams live — can safely go brighter. Open air keeps the low
    // cap. A further `ENCLOSURE_BEAM_GAIN` lift makes under-canopy shafts UNMISSABLE (constraint).
    const cap = mix(float(BEAM_BOOST_CAP), float(BEAM_BOOST_CAP_ENCL), encl)
    const boost = rho.mul(shaft_gain).min(cap).add(1)
    const encl_beam = encl.mul(ENCLOSURE_BEAM_GAIN).add(1)
    // ENG-19 (2026-07-04) BUG-2 SEALED-ENCLOSURE BEAM KILL — THE whiteout root cause + fix. Field-viz'd:
    // in a SEALED room the voxel-sun SUN-visibility (.r, an ANGLED ray toward the sun) reads ~0.95
    // UNIFORMLY (the angled ray threads the coarse 2 m thin ceiling / exits the 80 m march box before it
    // hits), so the sun in-scatter lights the WHOLE dense enclosure fog evenly = the milk curtains. There
    // is NO usable vis variation to carve discrete shafts from — the signal is garbage under a full seal.
    // The clean discriminator is SKY-OPENNESS (.g, the STRAIGHT-UP ray): a sealed roof reads openness≈0,
    // forest canopy keeps openness>0 through its gaps, open air =1 — exactly the physical statement that a
    // beam needs open sky above to shaft down. `seal = smoothstep(SEAL_HI, SEAL_LO, openness)` (reversed
    // edges: openness BELOW SEAL_LO ⇒ seal 1) fades the froxel beam to ~0 ONLY under a genuine seal, so
    // FOREST + open air (seal≈0) are byte-unchanged (the froxel forest-shaft win + fog law preserved).
    // Sealed-room shafts through real ceiling holes now come from surface bloom alone (the screen-space
    // GodraysNode pass was deleted 2026-07-05); the dark cool `amb` fog carries the cave mood (the amb-only
    // debug capture = the target dark-dungeon look). Falls back to an `encl` proxy when no sky-openness sampler
    // is wired (headless/isolation) so the guard still exists there, just less selective.
    const seal = sky_openness_at
      ? smoothstep(float(BEAM_SEAL_HI), float(BEAM_SEAL_LO), sky_openness_at(p_va).add(sky_openness_at(p_vb)).mul(0.5))
      : smoothstep(float(0.9), float(0.99), encl)
    const beam_scale = float(1).sub(seal.mul(BEAM_SEAL_KILL))
    // The shaft uses vis_gen too: in OPEN air the sun in-scatter reacts only gently to the voxel-sun
    // differential (no arcs), but boost·encl_beam·beam_scale are all enclosure-gated, so under real
    // canopy/cave (encl→1) vis_gen→full vis and the dramatic shafts are preserved unchanged.
    const shaft = sun_color.mul(phase).mul(vis_gen).mul(beam_base).mul(boost).mul(encl_beam).mul(beam_scale)
    // Store the CLEAN per-froxel in-scatter source (no per-cell dither — that keyed the checker). The
    // anti-banding dither is applied PER-PIXEL downstream in `apply`, gated by the integrated fog
    // opacity so it only breaks banding where fog is thick, and can never tile at the froxel grid.
    const src = shaft.add(amb).mul(rho)
    textureStore(scatter_tex, uvec3(x.toUint(), y.toUint(), z.toUint()), vec4(src, rho)).toWriteOnly()
  })().compute(gx * gy * gz)
  scatter_k.setName('froxelScatter')

  // ---- INTEGRATE: closed-form front-to-back per screen column (mirrors integrate_slices) ---------
  const integ_k = Fn(() => {
    const i = instanceIndex
    If(i.greaterThanEqual(gx * gy), () => {
      Return()
    })
    const x = i.mod(gx)
    const y = i.div(gx)
    const T = float(1).toVar()
    const L = vec3(0, 0, 0).toVar()
    Loop(gz, (/** @type {{i:*}} */ { i: k }) => {
      const u0 = float(k).div(gz)
      const u1 = float(k).add(1).div(gz)
      const dz = slice_dist_node(u1).sub(slice_dist_node(u0))
      const uvw = vec3(float(x).add(0.5).div(gx), float(y).add(0.5).div(gy), float(k).add(0.5).div(gz))
      const s = texture3D(scatter_tex, uvw, 0)
      const Ts = exp(s.a.mul(dz).negate())
      // closed-form slice integral S/σ·(1−e^(−σ·dz)) — exact for a homogeneous slice.
      const Li = s.rgb.div(s.a.max(1e-6)).mul(float(1).sub(Ts))
      L.addAssign(Li.mul(T))
      T.mulAssign(Ts)
      textureStore(integ_tex, uvec3(x.toUint(), y.toUint(), k.toUint()), vec4(L, T)).toWriteOnly()
    })
  })().compute(gx * gy)
  integ_k.setName('froxelIntegrate')

  /**
   * Per-frame: refresh camera uniforms + run both passes.
   * @param {*} renderer WebGPURenderer @param {*} camera PerspectiveCamera
   */
  const update = (renderer, camera) => {
    u_cam_pos.value.copy(camera.position)
    u_proj_inv.value.copy(camera.projectionMatrixInverse)
    u_cam_world.value.copy(camera.matrixWorld)
    renderer.compute(scatter_k)
    renderer.compute(integ_k)
  }

  /**
   * Composite the integrated fog onto a fragment color. Mirrors `depth_to_slice_w`.
   * @param {*} col vec3 node @param {*} dist float node (meters) @param {*} screen_uv vec2 node
   * @returns {*} vec3 node
   */
  const apply = (col, dist, screen_uv) => {
    const w = dist
      .max(NEAR)
      .div(NEAR)
      .log2()
      .div(Math.log2(FAR / NEAR))
      .clamp(0, 1)
    const fr = texture3D(integ_tex, vec3(screen_uv.x, screen_uv.y, w), 0)
    // ENG-19 (2026-07-04) ACCUMULATED-IN-SCATTER SOFT SHOULDER — THE BUG-2 whiteout fix. The froxel
    // INTEGRAL (integrate_slices/integ_k) is physically exact (RTE-pinned), but a strong beam source
    // marched over 64 dense slices — enclosure ≈ max in a cave, fog-sea band outdoors — accumulates an
    // UNBOUNDED `fr.rgb`, saturating whole regions to the white vertical CURTAINS that were photographed
    // (decisively INSIDE ?cave=1 where no clouds exist). The per-sample scatter caps (BEAM_BOOST_CAP)
    // bound the SOURCE multiplier; they cannot bound the INTEGRAL. A per-channel Reinhard shoulder
    // `L/(1+L/CAP)` on the integrated radiance rolls the brightest columns off toward CAP asymptotically
    // — a beam's lit core still reads bright + bloom-worthy, but no ray can ever paint a region pure
    // white. Applied here (NOT in the integrator) so the RTE math stays exact and the shoulder is a
    // pure DISPLAY op on the composited in-scatter, exactly where saturation reaches the eye. CAP is a
    // live uniform (__atmo.froxels.scatter_cap) so beam headroom tunes without a rebuild.
    const s = fr.rgb.toVar()
    const scattered = s.div(s.div(scatter_cap).add(1))
    // PER-PIXEL anti-banding dither (2026-07-03, replaces the per-cell scatter dither that keyed the
    // full-screen checkerboard): a tiny ± screen-space grain on the in-scattered radiance, keyed by
    // interleavedGradientNoise — the in-tree idiom — so it can NEVER tile at the froxel grid. Gated by
    // fog OPACITY (`1 − transmittance`) so it only bites where fog is thick (its sole anti-banding
    // purpose) and is byte-clean over clear vistas. Amplitude ≤±15% (0.3·(ign−0.5)).
    // [2026-07-05 FROXEL REBUILD — leg 4] The IGN is now PER-FRAME ANIMATED (the canonical temporal IGN:
    // slide the pixel coordinate by an incommensurate per-frame offset). A STATIC per-pixel dither is
    // itself a camera-locked pattern — under the static-overlay detector nothing on screen may converge
    // into ANY fixed structure, however fine. Animated, it reads as gentle film grain over thick fog.
    const opacity = fr.a.oneMinus().clamp(0, 1)
    const ign_p = screenCoordinate.add(vec2(time.mul(335.7), time.mul(212.3)))
    const dither = interleavedGradientNoise(ign_p).sub(0.5).mul(0.3).mul(opacity).add(1)
    return col.mul(fr.a).add(scattered.mul(dither))
  }

  return {
    integ_tex,
    scatter_tex,
    fog_k,
    shaft_gain,
    beam_base,
    scatter_cap,
    sun_direction,
    sun_color,
    wind_direction,
    tier,
    update,
    apply,
  }
}
