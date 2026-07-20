// C9 — the HILLAIRE SKY orchestrator. Builds the atmosphere uniform bag from a parameter set, owns the
// four LUTs' lifecycle (bake once, param-LUTs rebuilt on set_atmosphere_params, view-LUTs rebuilt per
// frame — or on sun-angle change at LOW), and exposes the TWO flag-switched consumers:
//   • background_node — samples the SKY-VIEW LUT + composites the physically-reddened sun disc.
//   • fog_node        — the AERIAL-PERSPECTIVE fog on opaques (screen-frustum froxel volume).
// Mirrors create_sky_node()'s public shape (sun_direction, background_node, set_time_of_day is external)
// and clouds.js's two-phase dispose. NOTHING here touches the legacy sky/fog paths — the flag in
// renderer.js chooses which node is assigned to scene.backgroundNode / scene.fogNode.

import { Vector3 } from 'three'
import {
  cameraPosition,
  clamp,
  float,
  fog,
  length,
  max,
  mix,
  positionWorld,
  positionWorldDirection,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec3,
} from 'three/tsl'

import { create_night_sky_node } from '../sky/night_sky.js'
import {
  SUN_DISC_COS,
  MOON_DISC_COS,
  MOON_DISC_INNER_COS,
  MOON_LIMB_EDGE,
  MOON_DISC_RGB,
  MOON_ANGULAR_RADIUS,
  disc_space_uv,
  moon_texture,
} from '../sky/sky_node.js'

import { EARTH_ATMOSPHERE, merge_atmosphere_params, resolve_sky_tier } from './atmosphere_params.js'
import { create_luts } from './luts.js'

/** peak radiance of the sun-disc CORE (pre-exposure; × sun_illuminance × transmittance × exposure). */
export const SUN_DISC_RADIANCE = 8.0
/** inner cos where the disc core reaches full brightness — a soft rim band from SUN_DISC_COS → here (kills
 *  the razor-sharp 0.00008 edge that read as a flat cut circle). */
const SUN_DISC_INNER_COS = Math.cos(0.013)
/** limb darkening: the disc rim dims to this fraction of centre so its edge MELTS into the corona (the
 *  "bloom more so we don't see a yellow circle" — no hard yellow-circle boundary). */
const SUN_LIMB_EDGE = 0.55
// --- BOUNDARY-FREE sun glare — live-QA: "sun is not scattered enough, should feel like a
// blinding source of light, not a soccer ball"). The OLD corona was a pow-falloff WINDOWED to a hard 5.7°
// radius — past it the term is EXACTLY zero, so disc+corona read as a bounded ball with a thin fuzzy rim,
// not a radiating light source. Replaced by TWO boundary-free terms — mirrors sky_node.js's analytic
// GLARE_VIS/GLARE_STRENGTH/MIE_POW halo shape (the SAME rational-spike + pow-tail form, already proven
// boundary-free across the whole sky dome there, hand-fit for "sun powerfully creating rays") — rescaled
// off the physical sun_base here so it reddens/dims at dusk exactly like the disc (one source, cannot
// drift):
//   • GLARE: a tight rational spike hugging the disc rim (half-width ≈1.6°) — the "ferocious" inner glow.
//   • MIE: a pow(cosθ) tail with NO window — BLOOMING (>knee) out to ≈10° at noon (2.5× the old ~4°
//     knee-crossing), then decaying continuously as a sub-knee luminous gradient to ~45°, never a hard
//     edge anywhere.
// Sized (numeric probe against the REAL noon sun_base, L≈2.622 — see hillaire_sky.test.js) so the combined
// peak (disc+glare+mie) at noon lands ~15% over the OLD disc+corona peak (28.3→~32, luminance) — reshaped,
// not doubled. FIRST CUT (pow 7 / gain 2.0) kept the tail >knee out to ~25-30° and WHITED OUT half the
// noon sky (capture-proven — the "waaaay too bloomy" whiteout class); pow 14 / gain 0.85 puts the
// knee at ~10° with the same boundary-free shape.
export const SUN_GLARE_VIS = 0.0016
export const SUN_GLARE_GAIN = 3.5
export const SUN_MIE_POW = 14.0
export const SUN_MIE_GAIN = 0.85
/** the night MOON body: cool white-grey, soft. Its peak sits BELOW the bloom knee (2.05) so the moon never
 *  bloom-blows-out — "soft blue grey light", not a second sun. INNER/limb soften the disc; a faint halo.
 *  Corona shape (radius/pow/gain) + the photographic surface texture now live in sky_node.js (shared with
 *  LOW so the two tiers cannot drift — see moon_texture, disc_space_uv there). */
export const MOON_DISC_RADIANCE = 1.55

/**
 * @typedef {object} HillaireSky
 * @property {*} sun_direction the shared `uniform(vec3)` world sun direction (y = cos zenith).
 * @property {*} background_node vec3 node for scene.backgroundNode (sky-view LUT + sun disc).
 * @property {*} fog_node the scene.fogNode (aerial-perspective) — replaces the analytic fog under the flag.
 * @property {(dir:*)=>*} sample_sky vec3 in-scatter radiance for a direction (ambient/mirror hook).
 * @property {(params:Partial<import('./atmosphere_params.js').AtmosphereParams>)=>void} set_atmosphere_params
 * @property {(renderer:*)=>Promise<void>} bake compute all four LUTs once (await at setup).
 * @property {(renderer:*, camera:*, dt:number)=>void} tick per-frame LUT refresh (view LUTs; param LUTs on dirty).
 * @property {import('./atmosphere_params.js').SkyTier} tier resolved tier.
 * @property {()=>void} dispose two-phase teardown.
 * @property {*} luts (internal) LUT texture handles + samplers — exposed for the acceptance capture.
 * @property {*} U (internal) the atmosphere uniform bag (live-tunable via set_atmosphere_params).
 * @property {*} dyn (internal) the dynamic (per-frame) uniform bag.
 * @property {*} art (internal) the art-direction dials over the raw physics (live-tunable).
 */

/**
 * Build the Hillaire sky.
 * @param {object} [opts]
 * @param {'low'|'medium'|'high'} [opts.tier] quality tier (default 'high').
 * @param {string|number} [opts.seed] world seed — drives the per-world night sky (galaxy orientation,
 *   planet orbits, star density — night_sky.js); defaults to the master seed there.
 * @param {*} [opts.sun_direction] a shared `uniform(vec3)` world sun direction (share sky_node's so tod drives it).
 * @param {[number,number,number]} [opts.cool_tilt] the shared deep-blue haze tilt (renderer.js FOG_COOL_TILT).
 * @param {Partial<import('./atmosphere_params.js').AtmosphereParams>} [opts.params] atmosphere overrides on Earth defaults.
 * @param {boolean} [opts.rebuild_on_rotate] false disables only orientation-triggered aerial-volume rebuilds.
 * @param {() => void} [opts.on_aerial_dispatch] hitch-probe hook immediately before an aerial compute.
 * @returns {HillaireSky}
 */
export function create_hillaire_sky(opts = {}) {
  const tier = resolve_sky_tier(opts.tier)
  let params = merge_atmosphere_params(EARTH_ATMOSPHERE, opts.params ?? {})
  const rebuild_on_rotate = opts.rebuild_on_rotate !== false

  const sun_direction = opts.sun_direction ?? uniform(new Vector3(0.2, 0.6, 0.78).normalize())

  // ── atmosphere uniform bag (km / per-km) — read by every kernel + sampler ──────────────────────────
  const U = {
    rayleigh_scattering: uniform(new Vector3().fromArray(params.rayleigh_scattering)),
    rayleigh_density_h: uniform(params.rayleigh_density_h),
    mie_scattering: uniform(params.mie_scattering),
    mie_absorption: uniform(params.mie_absorption),
    mie_g: uniform(params.mie_g),
    mie_density_h: uniform(params.mie_density_h),
    ozone_absorption: uniform(new Vector3().fromArray(params.ozone_absorption)),
    ozone_center: uniform(params.ozone_center_km),
    ozone_width: uniform(params.ozone_width_km),
    ground_radius: uniform(params.ground_radius_km),
    top_radius: uniform(params.top_radius_km),
    ground_albedo: uniform(new Vector3().fromArray(params.ground_albedo)),
    sun_illuminance: uniform(new Vector3().fromArray(params.sun_illuminance)),
    exposure: uniform(params.exposure),
  }

  // ── dynamic uniform bag — updated per frame by tick() ──────────────────────────────────────────────
  const dyn = {
    sun_dir: sun_direction,
    cam_height_km: uniform(0.2),
    cam_fwd: uniform(new Vector3(0, 0, -1)),
    cam_right: uniform(new Vector3(1, 0, 0)),
    cam_up: uniform(new Vector3(0, 1, 0)),
    tan_half_x: uniform(0.7),
    tan_half_y: uniform(0.7),
    aerial_range_km: uniform(params.aerial_range_km),
    aerial_depth_power: uniform(params.aerial_depth_power),
    units_to_km: uniform(params.length_unit_m / 1000),
  }

  // ── ART-DIRECTION over the raw physics (live-tunable + exposed on __hillaire.art) ──────
  // The four LUTs are physically correct but read as a raw demo ("white thing looking up, nothing
  // looking down, no blue distance fog"). These dials art-direct the look to the AC-Black-Flag bar WITHOUT
  // forking the physics — the two consumers below document what each drives. The deep-blue tilt vector is
  // the SAME cinematic cool as the analytic fogNode (renderer.js FOG_COOL_TILT, passed via opts.cool_tilt)
  // so the LOW (analytic) and MEDIUM/HIGH (physical) tiers cannot drift. The night gate reuses far_field.js's
  // proven sun-elevation threshold (y ≥ 0.02 full day, ≤ −0.12 full night), not a fresh magic number.
  const A = {
    cool_tilt: uniform(new Vector3().fromArray(opts.cool_tilt ?? [0.62, 0.75, 1.0])),
    tilt_amt: uniform(1), // master scale on the day-gated aerial tilt (0 = raw physics)
    haze_density: uniform(8), // aerial opacity ×mult — tuned 2026-07-11: noon far-band L≈141 / B−R≈27 (MEDIUM band 144/+26 ±8/±5)
    factor_max: uniform(0.85), // aerial opacity ceiling — far ridgelines keep their silhouette (RANGE_MAX parity)
    // NEAR-FIELD CLEAR (near terrain "high quality, punchy colours"; open terrain keeps ONLY the
    // DISTANCE fog). Aerial in-scatter should be ~0 in the foreground, but MEDIUM's coarse aerial LUT
    // (32²×16 @ 8 steps) over-estimates the nearest slices' in-scatter → ×haze_density paints a blue veil
    // on near terrain (HIGH's finer LUT computes near in-scatter ≈0, so near stays punchy). This distance
    // gate zeroes the art-directed haze below `near_fog_start` and eases it to full by `near_fog_full`,
    // killing MEDIUM's foreground wash while the TUNED mid/far band is byte-unchanged (near≈0 on HIGH ⇒ a
    // near-no-op there). World units (≈m). Live-tunable via __hillaire.art.near_fog_{start,full}.
    near_fog_start: uniform(40),
    near_fog_full: uniform(150),
    horizon_cap: uniform(0.25), // sky-view background luma ceiling (post-exposure linear, pre-AgX) — MEASURED 2026-07-11: up-horizon L=148 (≤150 gate), rgb(110,153,209) blue not white; zenith L=120 (deep blue)
  }
  /** night→day fade on sun elevation (far_field.js's proven pair); tilt = identity at night ⇒ byte-dark. */
  const day_f = smoothstep(float(-0.12), float(0.02), float(dyn.sun_dir.y))

  const luts = create_luts({ U, dyn, tier })

  // ── kernels (built in bake; nulled in dispose so tick/rebuild go inert — the clouds two-phase law) ──
  /** @type {*} */ let k_transmittance = null
  /** @type {*} */ let k_multiscatter = null
  /** @type {*} */ let k_skyview = null
  /** @type {*} */ let k_aerial = null
  let params_dirty = false
  // rebuild-throttle state (the LUTs are OUTPUT-INVARIANT while their inputs hold still, so we skip the
  // compute when nothing moved — this idles the per-frame storm during static streaming, the crash window).
  const last_sun = new Vector3().copy(sun_direction.value)
  const last_fwd = new Vector3(0, 0, -1)
  let last_alt = -1 // km — forces a first-frame rebuild
  const _fwd = new Vector3()
  const _right = new Vector3()
  const _up = new Vector3()

  // ── consumer 1: background = sky-view LUT + bloomed sun disc/corona + the night moon ────────────────
  const view_dir = positionWorldDirection.normalize()
  const sky_radiance = luts.sample_skyview(view_dir).mul(U.exposure)
  const cam_r = dyn.cam_height_km.add(U.ground_radius)
  const cos_view_sun = view_dir.dot(dyn.sun_dir)
  const sun_up = clamp(dyn.sun_dir.y.add(0.1).div(0.2), 0, 1)
  // base sun radiance reaching the eye — transmittance-reddened at dusk, 0 in the planet shadow. The ONE
  // source for BOTH the disc core and its corona, so they redden/dim together (never drift).
  const sun_base = U.sun_illuminance.mul(luts.sample_transmittance(cam_r, dyn.sun_dir.y)).mul(U.exposure)
  // SUN DISC (limb-darkened core) — a soft-edged bright disc whose rim dims into the corona (no hard cut
  // circle), well above the bloom knee so it blooms into a big soft sun.
  const disc_edge = smoothstep(float(SUN_DISC_COS), float(SUN_DISC_INNER_COS), cos_view_sun)
  const disc_rim_t = clamp(cos_view_sun.sub(float(SUN_DISC_COS)).div(float(1 - SUN_DISC_COS)), 0, 1)
  const disc_limb = mix(float(SUN_LIMB_EDGE), float(1), disc_rim_t)
  const sun_core = sun_base.mul(SUN_DISC_RADIANCE).mul(disc_edge.mul(disc_limb))
  // BOUNDARY-FREE GLARE — replaces the old windowed corona (see the SUN_GLARE_* comment above). Both terms
  // are angular-local (functions of cos_view_sun only — never a screen-space veil, the white-halo law).
  const vdots = clamp(cos_view_sun, 0, 1)
  const vdots4 = vdots.mul(vdots).mul(vdots).mul(vdots)
  // tight rational spike (mirrors sky_node.js's GLARE_VIS term exactly): saturates to ~(1-VIS) at the disc,
  // half-width ≈1.6°, hugging the rim with no window edge.
  const glare_spike = float(SUN_GLARE_VIS)
    .div(vdots4.mul(-(1 - SUN_GLARE_VIS)).add(1))
    .sub(float(SUN_GLARE_VIS))
  // broad pow(cosθ) tail (mirrors sky_node.js's MIE_POW term exactly): NO window/clamp on the falloff
  // itself — decays continuously all the way to cos_view_sun=0 (90° away), never a hard edge.
  const mie_tail = pow(vdots, float(SUN_MIE_POW))
  const sun_halo = sun_base.mul(glare_spike.mul(SUN_GLARE_GAIN).add(mie_tail.mul(SUN_MIE_GAIN)))
  const sun_glow = sun_core.add(sun_halo).mul(sun_up)
  // MOON — the antipodal night body (overhead at midnight): a soft cool-grey limb-darkened disc + a real
  // photographic maria texture, fading in as the sun sets. Its own fixed radiance (the sun's is 0 below the
  // horizon) kept UNDER the knee. 2026-07-13 (target: "use a better moon texture maybe, optimize it, fade
  // it"): the disc-space UV is FIXED to the moon (disc_space_uv — sky_node.js), never the camera, exactly as
  // before — only the mottling SOURCE changed (moon_texture() there, shared so both tiers cannot drift).
  // Round 2: DISC only — the halo + the moonlit-sky illumination moved to night_sky.js (the windowed
  // corona's visible boundary on black was a "lamp" read; the replacement kernels are boundary-free).
  const moon_dir = dyn.sun_dir.mul(-1)
  const cos_view_moon = view_dir.dot(moon_dir)
  const moon_up = clamp(moon_dir.y.add(0.02).div(0.14), 0, 1) // sun.y ≲ 0 ⇒ moon rising
  const moon_edge = smoothstep(float(MOON_DISC_COS), float(MOON_DISC_INNER_COS), cos_view_moon)
  const moon_rim_t = clamp(cos_view_moon.sub(float(MOON_DISC_COS)).div(float(1 - MOON_DISC_COS)), 0, 1)
  const moon_limb = mix(float(MOON_LIMB_EDGE), float(1), moon_rim_t)
  const moon_uv = disc_space_uv(view_dir, moon_dir).div(float(MOON_ANGULAR_RADIUS)).mul(0.5).add(0.5)
  const moon_surface = texture(moon_texture(), moon_uv).r
  const moon_amt = float(MOON_DISC_RADIANCE).mul(moon_edge.mul(moon_limb).mul(moon_surface))
  const moon_glow = vec3(MOON_DISC_RGB[0], MOON_DISC_RGB[1], MOON_DISC_RGB[2]).mul(moon_amt.mul(moon_up))
  // NIGHT SKY (round 2 — target: a sky illuminated a bit, beautiful stars, planets, milky way, a
  // genuinely amazing sky): the full set — deep blue-grey base (the LUT sky is ~0 at night), broad moonlit-sky
  // glow + boundary-free moon halo, 3-tier stars, the seed-oriented milky way, 2 drifting planets. Gated to
  // EXACTLY 0 in daylight inside the node, so the day sky is byte-unchanged.
  const night = create_night_sky_node({
    seed: opts.seed,
    sun_dir: dyn.sun_dir,
    view_dir,
    with_base: true,
    with_milky_way: true,
  })
  // HORIZON LUMA CEILING ("white thing when I lift the camera"). The physical sky-view horizon is
  // bright + desaturated (Mie forward-scatter + multiple scattering) and blows to WHITE under AgX at the
  // elevated exposure. Soft-cap the in-scatter LUMA with a hue-preserving smooth-min (below) so the horizon
  // stays LUMINOUS but never white; the deep-blue zenith (luma ≪ cap) is untouched and a dark night sky is
  // inert. The sun/moon discs are added AFTER the cap so they keep full brightness.
  const sky_L = sky_radiance.dot(vec3(0.2126, 0.7152, 0.0722)).max(float(1e-4))
  // smooth-min knee (∼min(L,cap) with a soft shoulder): ≈ L when L ≪ cap so the deep-blue zenith is UNTOUCHED,
  // asymptotes to cap when L ≫ cap so only the blown-out horizon is clipped. Hue-preserving (scales RGB by
  // capped/L). Inert at night (L ≪ cap).
  const sky_L_capped = sky_L.div(pow(float(1).add(pow(sky_L.div(A.horizon_cap), float(4))), float(0.25)))
  const sky_capped = sky_radiance.mul(sky_L_capped.div(sky_L))
  const background_node = sky_capped.add(sun_glow).add(moon_glow).add(night.node).max(0)

  /** @param {*} dir vec3 world dir @returns {*} vec3 in-scatter radiance (ambient/mirror hook). */
  const sample_sky = (dir) => luts.sample_skyview(dir.normalize()).mul(U.exposure).max(0)

  // ── consumer 2: aerial-perspective fog on opaques — ART-DIRECTED over the raw physics ─────────────
  // L_out = L_surface·T + L_inscatter, as three's fog(color, factor) = mix(surface, color, factor):
  //   factor = 1 − meanT,  color = inscatter / (1 − meanT). Two tunable dials fold the AC-Black-Flag
  //   mood onto the physically-correct-but-thin Earth-scale aerial perspective (over a few-km view real AP
  //   is nearly invisible — no perceptible blue distance fog when looking down; NOT a froxel clip,
  //   verified: screenUV.y and the froxel row share the bottom-origin convention):
  //   • haze_density scales the OPACITY up to the analytic fog's cinematic thickness. Near stays ~true
  //     (base_factor≈0 there ⇒ ×density is still ≈0); the mid/far vista AND the look-down valley gain a blue
  //     veil. Capped at factor_max (<1) so far ridgelines keep their silhouette (analytic RANGE_MAX parity —
  //     the crisp-far-peaks Minecraft/Black-Flag ref), never a full white-out wall.
  //   • a day-gated deep-blue TILT (the analytic fogNode's cinematic cool — ONE source via opts.cool_tilt)
  //     sinks the far haze blue-teal; night → identity (byte-dark), golden → the physical warmth survives
  //     (the tilt is a hue-preserving multiply, so a red-dominant sunset in-scatter stays warm).
  const frag_len = length(positionWorld.sub(cameraPosition)) // world units (≈ m) — the near-clear gate axis
  const frag_dist_km = frag_len.mul(dyn.units_to_km)
  const aerial = luts.sample_aerial(screenUV, frag_dist_km)
  const base_factor = clamp(float(1).sub(aerial.transmittance), 0, 1)
  // near-field clear: kill the art-directed haze in the foreground, ease it to full by near_fog_full so the
  // TUNED mid/far band (haze_density above) is untouched. The physical `base_factor` is already ≈0 near, so
  // this only removes the LUT-noise near veil (MEDIUM); it does not weaken the distance fog.
  const near_gate = smoothstep(A.near_fog_start, A.near_fog_full, frag_len)
  const fog_factor = base_factor.mul(A.haze_density).min(A.factor_max).mul(near_gate)
  const raw_color = aerial.inscatter.mul(U.exposure).div(max(base_factor, float(1e-3)))
  const tilt = mix(vec3(1, 1, 1), A.cool_tilt, day_f.mul(A.tilt_amt).clamp(0, 1))
  const fog_color = raw_color.mul(tilt)
  const fog_node = /** @type {*} */ (fog)(fog_color, fog_factor)

  // ── param writer (set_atmosphere_params + mood crossfade feed) ─────────────────────────────────────
  const write_uniforms = () => {
    U.rayleigh_scattering.value.fromArray(params.rayleigh_scattering)
    U.rayleigh_density_h.value = params.rayleigh_density_h
    U.mie_scattering.value = params.mie_scattering
    U.mie_absorption.value = params.mie_absorption
    U.mie_g.value = params.mie_g
    U.mie_density_h.value = params.mie_density_h
    U.ozone_absorption.value.fromArray(params.ozone_absorption)
    U.ozone_center.value = params.ozone_center_km
    U.ozone_width.value = params.ozone_width_km
    U.ground_radius.value = params.ground_radius_km
    U.top_radius.value = params.top_radius_km
    U.ground_albedo.value.fromArray(params.ground_albedo)
    U.sun_illuminance.value.fromArray(params.sun_illuminance)
    U.exposure.value = params.exposure
    dyn.aerial_range_km.value = params.aerial_range_km
    dyn.aerial_depth_power.value = params.aerial_depth_power
    dyn.units_to_km.value = params.length_unit_m / 1000
  }

  /** @param {Partial<import('./atmosphere_params.js').AtmosphereParams>} partial */
  const set_atmosphere_params = (partial) => {
    params = merge_atmosphere_params(params, partial)
    write_uniforms()
    params_dirty = true // transmittance + multiple-scattering rebuild on the next tick
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────
  /** @param {*} renderer WebGPURenderer */
  const bake = async (renderer) => {
    k_transmittance = luts.build_transmittance_kernel()
    k_multiscatter = luts.build_multiscatter_kernel()
    k_skyview = luts.build_skyview_kernel()
    k_aerial = luts.build_aerial_kernel()
    // transmittance → multiscatter (reads it) → the two view LUTs (read both).
    await renderer.computeAsync(k_transmittance)
    await renderer.computeAsync(k_multiscatter)
    await renderer.computeAsync(k_skyview)
    await renderer.computeAsync(k_aerial)
  }

  /** @param {*} camera three PerspectiveCamera */
  const update_dynamic = (camera) => {
    dyn.cam_height_km.value = Math.max(0.002, (camera.position.y * params.length_unit_m) / 1000)
    const e = camera.matrixWorld.elements
    _right.set(e[0], e[1], e[2]).normalize()
    _up.set(e[4], e[5], e[6]).normalize()
    _fwd.set(-e[8], -e[9], -e[10]).normalize()
    dyn.cam_right.value.copy(_right)
    dyn.cam_up.value.copy(_up)
    dyn.cam_fwd.value.copy(_fwd)
    const half_y = Math.tan(((camera.fov ?? 70) * Math.PI) / 180 / 2)
    dyn.tan_half_y.value = half_y
    dyn.tan_half_x.value = half_y * (camera.aspect ?? 1)
  }

  /** @param {*} renderer @param {*} camera @param {number} _dt */
  const tick = (renderer, camera, _dt) => {
    if (!k_skyview) return // disposed — inert (two-phase law)
    if (camera) update_dynamic(camera)
    night.tick(sun_direction.value) // planet drift follows the sun azimuth (a few flops CPU)
    let force = false
    if (params_dirty) {
      renderer.compute(k_transmittance)
      renderer.compute(k_multiscatter)
      params_dirty = false
      force = true // new atmosphere → the view LUTs must refresh too
    }
    // Rebuild the view LUTs only when their inputs moved (output-equivalent to per-frame, but idles when
    // still — the fix for the streaming compute storm). Sky-view depends on the sun + camera ALTITUDE;
    // the aerial volume additionally on camera ORIENTATION (it is a view-frustum volume). LOW gates the
    // aerial on the sun only (mobile floor: the fog may lag a fast rotation — the "per-frame-skippable" rung).
    const sun = sun_direction.value
    const sun_cos_eps = tier.rebuild_on_sun_only ? 0.99982 : 0.9999939 // ~1.1° vs ~0.2° of sun travel
    const sky_dirty = force || last_sun.dot(sun) < sun_cos_eps || Math.abs(dyn.cam_height_km.value - last_alt) > 0.001
    const orient_moved = rebuild_on_rotate && !tier.rebuild_on_sun_only && last_fwd.dot(dyn.cam_fwd.value) < 0.9999939
    if (sky_dirty) {
      renderer.compute(k_skyview)
      last_sun.copy(sun)
      last_alt = dyn.cam_height_km.value
    }
    if (sky_dirty || orient_moved) {
      opts.on_aerial_dispatch?.()
      renderer.compute(k_aerial)
      last_fwd.copy(dyn.cam_fwd.value)
    }
  }

  const dispose = () => {
    // STOP the ticker reaching the GPU first (null the kernels — tick early-returns), THEN free textures.
    k_transmittance = null
    k_multiscatter = null
    k_skyview = null
    k_aerial = null
    luts.dispose()
  }

  return {
    sun_direction,
    background_node,
    fog_node,
    sample_sky,
    set_atmosphere_params,
    bake,
    tick,
    tier,
    dispose,
    // exposed for the acceptance capture (window.__hillaire) — live LUT handles + uniforms.
    luts,
    U,
    dyn,
    art: A, // the art-direction dials (cool_tilt / tilt_amt / haze_density / factor_max / horizon_cap)
  }
}
