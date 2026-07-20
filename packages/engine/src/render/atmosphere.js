// NG2-ATMO composition — the single module that wires the shelf-ready atmosphere pieces (sky_node,
// clouds, froxels) + god-rays + the ambient particle layer into ONE coherent stack, and owns the
// tunable config (cloud altitudes retuned for OUR world scale, froxel NEAR-haze floor, ambient-depth
// spec). It is the seam between the standalone atmosphere factories and renderer.js.
//
// PHASE 1 (this file, now): build the composition object + config + the per-frame schedule as pure
// wiring functions that take a renderer/scene/camera/sun handle — ZERO edits to renderer.js /
// ring_manager.js (owned by the far-shell sibling). PHASE 2 (after the sibling lands): the mechanical
// renderer.js insertion is FULLY SPECIFIED in the "PHASE-2 WIRING SPEC" block below — exact call
// sites by function, pass order, render-target reuse, and the two required deltas (ambient-depth
// BFS scale + froxel near haze) — so the wiring is copy-in mechanical, no design left to do.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// PHASE-2 WIRING SPEC (mechanical; apply after the far-shell sibling lands renderer.js/ring_manager.js)
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Files touched in phase 2: src/core/renderer.js (sky/clouds/froxels/godrays/grade wiring + a
// PostProcessing output), src/engine.js (per-frame schedule + tod handoff). NOTHING else.
//
// A. CONFIG + CONSTRUCTION — in renderer.js `create_renderer`, AFTER `const sky = create_sky_node()`
//    (currently line ~282, right where the sky node is built) and AFTER `scene.add(sun)`:
//      const atmo = create_atmosphere({
//        tier: tier_name,                    // pass the detected tier down (add a `tier` opt to create_renderer)
//        sky,                                // share the sky node (sun_direction + sample_sky)
//        sun,                                // the DirectionalLight (godrays + froxel/cloud sun uniforms)
//        world_size: <far radius m>,         // for the cloud shadow-map footprint
//      })
//    `atmo.sun_direction` MUST replace the clouds/froxels default uniforms — create_atmosphere already
//    wires clouds.sun_direction = froxels.sun_direction = sky.sun_direction (one source). The sun COLOR
//    for clouds/froxels is derived from sky.sun_tint × intensity — atmo owns that (`atmo.sun_radiance`).
//
// B. SKY BACKGROUND — already wired (renderer.js:292 `scene.backgroundNode = sky.background_node`).
//    Phase 2 does NOT change this. Clouds composite OVER the sky background in the post chain (D below),
//    not into backgroundNode (backgroundNode is drawn depth-less first; clouds need scene depth to sit
//    behind terrain/in front of sky).
//
// C. FROXEL FOG-COLOR HANDOFF — the far-shell sibling's aerial haze feeds the froxel ambient. The
//    froxels already sample `sample_sky(dir)` for their ambient term (froxels.js:237). No new handoff
//    needed beyond passing `sample_sky: sky.sample_sky` into create_froxels (create_atmosphere does).
//    The existing THREE.Fog (renderer.js:286, color = sky_horizon_color) stays as the CHEAP tier's haze;
//    at froxel-enabled tiers the froxel `apply` (below) layers volumetric scatter ON TOP of that flat fog.
//
// D. POST CHAIN — ✅ LANDED as `render/lighting/post_stack.js` (create_post_stack — uses
//    RenderPipeline, the non-deprecated r183+ name; god rays defer-mount until the sun's shadow map
//    exists; AgX applied once mid-chain via renderOutput; grade last with a 96×54 RTT low-freq luma).
//    The sketch below is the original spec, kept for the design record:
//      import { PostProcessing } from 'three/webgpu'
//      import { pass } from 'three/tsl'
//      // build after atmo:
//      const post = new PostProcessing(renderer)
//      const scene_pass = pass(scene, camera)                 // beauty + depth MRT
//      const color = scene_pass.getTextureNode()              // tonemapped? NO — see note; AgX is applied on output
//      const depth = scene_pass.getTextureNode('depth')       // for clouds depth-composite + godrays
//      let out = color
//      out = atmo.compose_clouds(out, depth, camera)          // raymarch clouds, composite by depth (E)
//      out = atmo.compose_froxels(out, depth)                 // volumetric fog apply (F)
//      out = atmo.compose_godrays(out, depth, camera, sun)    // additive god-ray shafts (G)
//      out = atmo.grade.apply(out, atmo.low_freq_luma(out))   // FINAL grade — AFTER tonemap (H)
//      post.outputNode = out
//    Then renderer.js exposes `render_frame: () => post.renderAsync()` (or `.render()`), and engine.js
//    calls `renderer_handle.render_frame()` in place of `renderer.render(...)`.
//    NOTE ON TONEMAP ORDER: AgX currently lives on `renderer.toneMapping` (renderer.js:182). With a
//    PostProcessing output node, move tonemapping into the chain: apply `renderOutput(out)` or set the
//    scene pass's tone mapping so AgX runs BEFORE `atmo.grade.apply` (the grade is a DISPLAY-space op,
//    §grading.js). Concretely: keep AgX on the pass output, then grade. Verify AgX runs exactly once.
//
// E. CLOUDS COMPOSITE — ENG-15 (2026-07-04): the per-pixel volumetric MARCH was replaced by a FLAT
//    cloud deck (constraint: clouds must look good at near-zero perf cost — never flown through
//    them). post_stack.js now calls `clouds.cloud_layer(cam_pos, dir, frag_dist)` — a single ray-plane
//    sample per deck (~zero cost, no march/jitter/half-res target) — and composites premultiplied
//    (color·alpha, alpha) by depth (`frag_dist` caps it so terrain occludes; sky pixels see the deck).
//    The original raymarch spec below is kept as the design record:
//    `atmo.compose_clouds(color, depth, camera)` reconstructs the view ray per pixel, calls
//    clouds.march(cam_pos, dir, max_dist_from_depth, blue_noise_jitter), and does
//    `mix(color, cloud.color, cloud.alpha)` where the cloud is NEARER than scene depth.
//
// F. FROXEL APPLY — `atmo.compose_froxels(color, depth)` calls froxels.apply(color, view_dist, screen_uv)
//    (froxels.js:286). view_dist from depth; screen_uv = the pass uv. This is the volumetric fog +
//    light shafts. THE NEAR-HAZE REQUIREMENT lives in the froxel density_hook (config below) — no
//    extra wiring; it is already folded into create_froxels via `density_hook: atmo._near_haze_hook`.
//
// G. GODRAYS — `atmo.compose_godrays(color, depth, camera, sun)` builds `godrays(depthNode, camera, sun)`
//    ONCE (GodraysNode, three@0.185.1 examples/jsm/tsl/display), reads its texture node, optionally
//    `bilateralBlur`s it, and composites additively via `depthAwareBlend(color, godrayColor, depth, camera)`.
//    REQUIRES: renderer.shadowMap.enabled (✅ renderer.js:174), sun.castShadow (✅), the sun's shadow map
//    populated (✅ sync_shadow). Cloud occlusion of shafts is ALREADY handled by the froxel path
//    (froxels reads clouds.shadow_at as cloud_shadow_at); GodraysNode is the SCREEN-SPACE garnish on top.
//    Set godrays.density/maxDensity from atmo config (below). It vanishes when the sun is off-screen —
//    that's expected; the froxel shafts are the always-on ones.
//
// H. GRADE — LAST. `atmo.grade.apply(out, low_freq_luma)`. The low-freq luma is a BLURRED scene
//    luminance (constraint: plane separation, not per-cell). Wiring builds it as a cheap
//    downsample+blur of the scene color's luminance (e.g. `gaussianBlur(luminance(color), R)` at a low
//    mip, R≈large so it's regional). If a blur node isn't trivially available, START with a coarse mip
//    of the color pass (`color.bicubic(level)` / a 1/8-res sample) as the low-freq proxy — the grade
//    node accepts any float luma node. WITHOUT the low-freq input the grade falls back grain-safe
//    (local_contrast defaults 1.0), so shipping the fallback first is SAFE and never adds clutter.
//
// I. PER-FRAME SCHEDULE — in engine.js `on_render` (currently ends at renderer.render, line 306),
//    BEFORE the render/post call, add (guarded on atmo presence):
//      renderer_handle.atmo.tick(renderer, camera, frame_dt_seconds)   // clouds.tick + froxels.update + opacity
//    `atmo.tick` does: clouds.tick(renderer, dt) [drifted shadow re-bake], froxels.update(renderer, camera)
//    [scatter+integrate compute], and advances particle opacity by tod. GodraysNode + the grade run inside
//    the post graph (updateBefore / fragment) — no manual per-frame call.
//
// J. TIME OF DAY — in engine.js `set_time_of_day` (line 334), AFTER `sky.set_time_of_day(phase)`, add:
//      renderer_handle.atmo.on_time_of_day()   // refresh sun_radiance from sky tint + trigger cloud shadow re-bake
//    (clouds.refresh_shadow(renderer) needs a renderer — atmo caches the last renderer from tick()).
//
// K. AMBIENT-DEPTH (constraint #2 — interior canopy cells must RECEDE). This is a TERRAIN-MATERIAL
//    change, NOT this module's file (terrain_material.js is owned elsewhere) — SPEC ONLY:
//      In terrain_material.js, where the ambient/hemisphere term is composed with the per-quad BFS sun
//      value (the existing `sun`/skylight buffer field), scale the AMBIENT contribution by a gentle BFS
//      curve: `ambient_scale = mix(0.62, 1.0, smoothstep(0, 1, bfs_sun_norm))`. Interior/creviced cells
//      (low BFS sun) drop to ~0.62× ambient so they recede into shadow; exterior cells stay 1.0×. This
//      is the single change that restores volume structure in the snowy-canopy scene (the direct sun is
//      already BFS-gated; only the ambient floor needs the same gate). Keep the DIRECT term unchanged.
//      atmo exports AMBIENT_INTERIOR_SCALE / AMBIENT_EXTERIOR_SCALE as the canonical knobs to import.
//
// L. ACCEPTANCE CAPTURE — re-shoot the reference scene type (snowy taiga canopy slope, camera INSIDE the
//    clutter) before/after phase 2. The after must let the eye separate ground plane / canopy mass / sky.
//    Levers if it still reads flat: raise froxel near-haze (ATMO_CONFIG.froxel.near_haze), raise
//    ambient interior falloff (lower AMBIENT_INTERIOR_SCALE toward 0.55), raise grade low-freq contrast.
//
// M. POINT-LIGHT VOLUMETRICS (PHASE-2+; rides the ENG-5 glow-mushroom / torch landing).
//    TWO in-hand techniques, compared (refs #1 + #3 — verdict below):
//    (1) IN-TREE PRIMARY — `VolumeNodeMaterial` + `VolumetricLightingModel` (three@0.185.1 core
//        src/materials/nodes + src/nodes/functions, MIT — the webgpu_volume_lighting example's
//        engine): a bounded BackSide volume mesh raymarched per pixel (`material.steps`, default 25;
//        `offsetNode` dithering; `scatteringNode({positionRay})` = density hook; `depthNode` = scene
//        depth for per-step occlusion). Its `direct()` natively accumulates POINT/SPOT lights with
//        inverse-square attenuation AND their shadow maps per step — and explicitly IGNORES
//        directional lights (`light.distance === undefined` guard). VERDICT: this SUPERSEDES the
//        hand-rolled atan pass for cave halos — mount ONE room-sized volume box per lit cavern room
//        with the room's point lights; shadowed colored halos come free, zero custom light plumbing.
//        Density hook = the SAME enclosure/biome hook the froxels consume (one density authority).
//        Denoise: the example renders the volume pass at reduced res + gaussian blur (matches our
//        cloud discipline). Note it never handles the SUN — validates the froxel/volume role split.
//    (2) ANALYTIC FAR-LOD — ijdykeman's closed-form scatter (~12 shader lines/light, NO marching):
//        ∫₀ᵈ dt/(h²+(t−t_c)²) = (atan((d−t_c)/h) + atan(t_c/h))/h  (h = perpendicular light-to-ray
//        distance; POINT_SCATTER_MIN_H clamps the 1/h singularity — a bulb radius). Source:
//        https://ijdykeman.github.io/graphics/simple_fog_shader (credited on the pure fn below).
//        Full-line bound π/h sizes the classic per-light bounding sphere (glow < ~1/255 ⇒ cull).
//        USE for distant/many lights where a 25-step volume per room is overkill: torch rows, spell
//        VFX, LOD-out of (1). `color += light_color · intensity · ρ_fog · integral`, additive after
//        the froxel apply, before the grade. Cap nearest-K (K≈8); cluster mushrooms per room.
//    Pure math + test land THIS wave (`point_scatter_integral` below, pinned vs a numeric
//    reference — also validates (1)'s volume sizing); implementation rides the mushroom/torch wave.
//
// SETTINGS PARITY (ref #2, three-volumetric-pass — study-only, no license): its knob surface
//    {ambient color/intensity, fog min/max Y, base/max step counts, max ray length, min step, max
//    density early-out, high/low-density fog colors, light color/intensity/falloff, fadeout pow/range,
//    density multiplier, height-fog start/end/factor, noise bias/pow/movement, post density mul/pow,
//    halfRes, globalScale, compositor} maps onto OURS as: ATMO_CONFIG.{cloud.coverage/density/wind/
//    bottom/top, froxel.fog_k/near_haze/near_start_m/near_full_m, godrays.*, grade.*, particles.*} +
//    live uniforms (clouds.coverage/density/wind_direction, froxels.fog_k/shaft_gain/beam_base,
//    atmo.near_haze/weather_density/fog_sea, grade.contrast/saturation/vibrance/local_contrast,
//    post_stack.shaft_strength + godrays_node's density/maxDensity/raymarchSteps/distanceAttenuation +
//    ENG-12 bloom_node's threshold/strength/radius) + tier tables (march_steps/res_scale =
//    its step counts/halfRes). REMAINING module-level constants (deliberate, tuning-wave candidates):
//    cloud_noise.js HG lobes/extinctions/POWDER_K, clouds.js DRIFT_V/CLOUD_SUN_GAIN/WEATHER_WORLD,
//    froxels.js FROXEL_HG_G/height-falloff constants. The demo-look bar for froxel tuning:
//    soft characterful fog with visible structure (their live demo's default look).
// ══════════════════════════════════════════════════════════════════════════════════════════════════

import { Vector2, Vector3 } from 'three'
import { clamp, exp, float, mix, smoothstep, uniform, vec3 } from 'three/tsl'

import { CLOUD_TIERS } from './sky/cloud_noise.js'
import { create_clouds } from './sky/clouds.js'
import { FROXEL_TIERS, create_froxels } from './lighting/froxels.js'
import { create_fog_height } from './lighting/fog_height.js'
import { create_voxel_sun } from './lighting/voxel_sun.js'
import { sun_tint_for } from './sky/sky_node.js'
import { create_grade_node } from './grading.js'
import { create_particles } from './particles.js'

/** @typedef {import('../core/quality/tiers.js').TierName} TierName */

// --- cloud altitudes retuned for OUR world ---------------------------------------------------------
// The ported constants assumed a 2km world (CLOUD_BOTTOM 1250 / TOP 1900). OUR world: terrain to
// y≈350, sky islands ~290-350. Clouds must sit ABOVE the islands so the islands read dramatically
// BELOW the deck. Deck at 460-700 world-y (slab 240m): a comfortable ~110m gap over the highest
// island, thick enough for the 32-step march to read as volume, low enough to stay in the fog band.
/** cloud slab bottom (world-y) — ~110m above the highest sky island (≤350). */
export const CLOUD_BOTTOM = 460
/** cloud slab top (world-y). Slab = 240m — enough vertical extent for billow at 32 steps. */
export const CLOUD_TOP = 700

/** ambient scale for INTERIOR (low-BFS-sun) cells — they recede so structure reads (constraint #2).
 * ENG-10 REBALANCE (2026-07-03): raised 0.62 → 0.78 now that the ENCLOSURE FOG carries the
 * under-canopy mood from the AIR. Target read: interior SURFACES stay light + clear up
 * close (textures stay light and clear); the DISTANCE (thick fog) does the darkening, not
 * the albedo. So nearby ground/trunks under canopy read legibly; the volumetric fog dissolves depth. */
export const AMBIENT_INTERIOR_SCALE = 0.78
/** ambient scale for EXTERIOR (full-BFS-sun) cells — unchanged. */
export const AMBIENT_EXTERIOR_SCALE = 1.0

/** RELATIVE cool-shade tint on the AMBIENT-FLOOR color at v_sun=0 (deep interior / cave) — the
 * design target: sky-lit shadow reads as a cool cast (warm sun / cool shade complementary contrast). A hue shift toward the
 * clear-day sky-dome color (echoes sky_node's SKY_DAY.zenith cobalt [0.08,0.20,0.44] — same blue-dominant
 * ordering) as a MULTIPLIER on the ambient floor. At v_sun=1 (open ground) the tint mixes to neutral
 * [1,1,1] so sunlit risers stay warm (the de-cyan regression guard — structural, holds at any values).
 * ENG-12 CRANK (2026-07-03 — canopy shade read as not blue enough): [0.75,0.85,1.15] measured only Δ(b−r)=
 * +0.0037 in deep shade (homeopathic). Pushed to [0.55,0.72,1.35] — R/G dipped BELOW 1 (cooler AND dimmer
 * = the photographic look, the Hodilton forest shadow color) while B lifts hard, so deep canopy shade
 * READS blue at a glance. Mean 0.87 (<1) keeps the shade from brightening as it cools. QA-tunable knob.
 * @type {readonly [number,number,number]} */
export const AMBIENT_SHADE_TINT = Object.freeze([0.55, 0.72, 1.35])

/**
 * @typedef {object} AtmosphereConfig
 * @property {{ bottom:number, top:number, coverage:number, density:number, wind:[number,number] }} cloud
 * @property {{ fog_k:number, near_haze:number, near_start_m:number, near_full_m:number,
 *   near_fade_start_m:number, near_fade_end_m:number, weather_density:number,
 *   altitude_haze_start_y:number, altitude_haze_full_y:number, altitude_haze_boost:number,
 *   altitude_haze_weather_boost:number, enclosure_density:number, fog_sea_level:number,
 *   fog_sea_softness:number, fog_sea_density:number }} froxel
 *   near_haze = extra extinction (1/m) WINDOWED into the near-mid band: ramps in across
 *   [near_start_m, near_full_m] (foreground stays crisp), holds, then fades OUT across
 *   [near_fade_start_m, near_fade_end_m] — softens MID-RANGE clutter without accumulating into a
 *   far-field whiteout (a constant floor integrates to τ≈3 over the 480 m froxel range — the
 *   2026-07-03 whiteout). FOG LAW (the constraint: never abuse the fog to the point terrain becomes
 *   unreadable, except at high altitude while snowing): the DEFAULT is SEASONING — terrain
 *   readable through the near ring, far shell keeps its colors. Drama is CONDITIONAL:
 *   `weather_density` (multiplier, default 1 — the weather wave drives it; snow/rain get whiteout
 *   rights) and the ALTITUDE band (peaks sit in the cloud band: haze boosted ×(1+boost·ramp) across
 *   [altitude_haze_start_y, altitude_haze_full_y]). fog_k = the base density scale.
 * @property {{ density:number, max_density:number, steps:number, distance_attenuation:number,
 *   strength:number, froxel_shaft_gain:number, froxel_beam_base:number }} godrays `strength` = composite
 *   gain of the sun-tinted screen-space shafts (post_stack). `froxel_shaft_gain` = the ALWAYS-ON froxel
 *   volumetric shafts' density-keyed boost (1/m→×, tone-capped): beams read HEAVY where the fog is dense
 *   (canopy/cave) and byte-clean in thin open air (fog law). `froxel_beam_base` = a flat lift on the sun
 *   in-scatter so ANY sunlit gap paints a visible beam (target: rays read as more present), bloomed downstream.
 * @property {{ threshold:number, strength:number, radius:number }} bloom ENG-12 cinematic bloom
 *   (post_stack, high): `threshold` = linear-HDR luminance above which a pixel blooms (≈1.05 =
 *   supra-diffuse — sun disc / sky gaps / glints / bright shafts); `strength` = additive gain of the
 *   bloom pyramid; `radius` = blend across the 5 mips (wider = softer, more cinematic halo).
 * @property {{ tint:[number,number,number], opacity:number }} particles
 * @property {{ contrast:number, saturation:number, vibrance:number, local_contrast:number,
 *   pivot:number, lift:number, shoulder:number }} grade the FULL grading.js knob set (tuned
 *   via these; defaults = the CONQUEST "dark faded" mood — humble chroma, contrast + shoulder).
 */

/** The shipped, hierarchy-first atmosphere config (every value a QA-tunable knob). @type {Readonly<AtmosphereConfig>} */
export const ATMO_CONFIG = Object.freeze({
  cloud: { bottom: CLOUD_BOTTOM, top: CLOUD_TOP, coverage: 0.6, density: 0.85, wind: [1, 0.15] },
  // near_haze: a WINDOWED band, SEASONING by default (fog law: terrain clearly readable
  // through the whole near ring): crisp to ~30 m, σ=0.002/m full by 80 m, fading out 160→300 m ⇒
  // band optical depth ≈ 0.35, ≤~18% veil across the near ring — the softening sits on the
  // MID-RANGE (80-250 m), not on near terrain (the 2026-07-03 island-quadrant chroma loss). Drama
  // is conditional: weather_density (weather wave drives it; high-altitude + snowing = the only
  // sanctioned whiteout) + the altitude band (y 260→320 ⇒ ×3 haze — peaks sit in the cloud band).
  froxel: {
    fog_k: 0.4,
    // CO-TUNE 2026-07-03: near_haze 0.002→0.0012. The A/B pinned the near band as the #1 clear-day
    // WASH in BOTH the noon vista quadrant (q_sat 0.107→0.292 with it off) AND the source of the
    // island whiteout (× the altitude boost). 0.0012 keeps it seasoning (band τ≈0.21) while the
    // near-terrain colors/structure survive; the fog-law gate compares vs near_haze=0 so LOWER = greener.
    near_haze: 0.0012,
    near_start_m: 30,
    near_full_m: 80,
    near_fade_start_m: 160,
    near_fade_end_m: 300,
    weather_density: 1.0,
    altitude_haze_start_y: 260,
    altitude_haze_full_y: 320,
    // CO-TUNE 2026-07-03: altitude_haze_boost 3→0.4 (clear-day mult ×4→×1.4). The old ×4 fired
    // UNCONDITIONALLY and amplified near_haze into the 05_island near-WHITEOUT on a CLEAR day —
    // violating the fog law (whiteout ONLY at altitude AND snowing). 0.4 = thin-air haze only.
    // The drama is now WEATHER-GATED: altitude_haze_weather_boost adds per unit of weather_density>1,
    // so the snow wave (which drives weather_density) restores the dramatic high-altitude whiteout.
    altitude_haze_boost: 0.4,
    /** extra altitude boost PER unit of weather_density above 1 — the snow-wave whiteout drama
     *  (0 contribution on a clear day; peaks sit in the cloud band so heavy haze is legal up there). */
    altitude_haze_weather_boost: 2.6,
    /** ENG-10 ENCLOSURE FOG (constraint: under canopy … the fog between [textures] is much more dense;
     *  we can see far away in open area but not far at all under canopy). An ADDITIVE extinction floor
     *  (1/m) added where the sky is occluded above: density += enclosure_density·(1 − sky_openness)·rise,
     *  sky_openness from voxel_sun's UP-ray volume (0 open → 1 enclosed). ADDITIVE + tod-INDEPENDENT so
     *  it survives the noon fog-suppression (a forest is dim at noon too); windowed past near_start_m so
     *  the foreground stays crisp. 0.035/m over ~20 m ⇒ τ≈0.7 (clear near, gloom by 25-30 m). Integrated
     *  to the froxel FAR only under canopy; open air (openness 1) adds nothing → clear long range. */
    enclosure_density: 0.035,
    /** ENG-12 ALTITUDE FOG SEA (Hodilton ref: dense fog at certain altitude … summits breaking
     *  through a white valley sea). A dense ADDITIVE extinction floor BELOW `fog_sea_level`, fading out
     *  over `fog_sea_softness` blocks at the top — so from a peak the valleys read as a white sea with
     *  summits above it, and from inside it's a bright morning mist (sun-scattered, bloomed). tod-
     *  INDEPENDENT (an alpine inversion sits all day). GATED so it is NOT everywhere-always: the effective
     *  density = fog_sea_density · (0.08 baseline + 0.9·weather_extra) — barely-there on a clear
     *  grassland day (the fog law; 2026-07-03 rebalance from 0.25 which read as a dawn soup + taxed every
     *  frame), PRESENT when the weather/alpine system raises weather_density (snow/
     *  morning inversion = the sanctioned high-altitude whiteout). fog_sea_level y≈145 (just above sea
     *  128), soft over 18 blocks. Live: __atmo.fog_sea.value (0 disables). */
    fog_sea_level: 145,
    fog_sea_softness: 18,
    fog_sea_density: 0.06,
  },
  // godrays: retuned for an OPEN world (the node's upstream defaults assume small occluded scenes —
  // in open lit air its illum saturates to max_density over the whole frame: the 2026-07-03 noon
  // white-wash). Low max_density keeps the open-air veil subtle; post_stack additionally gates the
  // composite by SUN ELEVATION (shafts are a low-sun phenomenon — full at dusk, ~zero at noon).
  // ENG-12 froxel_shaft_gain: the always-on volumetric shafts' density-keyed boost. Under canopy a
  // sun-lit gap column has rho≈0.037/m (enclosure floor) ⇒ ×(1+0.037·200)≈8× so the beam reads HEAVY
  // (its lit core naturally clips toward white — the sunbeam look); open NOON air rho≈2e-4/m ⇒ ×1.04
  // (clean vista, fog law); dusk open air rho≈0.0026 ⇒ ×1.5 (dusk shafts wanted). The under-canopy
  // beam brightness is limited by the SMALL sun-gap area in dense procedural canopy — this gain makes
  // it as heavy as the scene allows without touching vistas. Live: window.__atmo.froxels.shaft_gain.value.
  // ENG-12 (2026-07-03) froxel_shaft_gain 200→60: 200 was UNBOUNDED (×(1+rho·gain)) and behind the
  // whiteout regression — a rho spike blew the sun in-scatter into a radial white smear. 60 + the
  // kernel's BEAM_BOOST_CAP keeps beams heavy (under canopy rho≈0.037 ⇒ ×2.2, capped at 6×) without
  // the blowout. The BEAM_BASE lift (froxels.js) makes rays MORE present, not the raw gain.
  // ENG-14 (2026-07-03) froxel_beam_base HELD at 1.8: a global lift here desaturated the near-terrain at
  // the open noon vista (the fog-law sat_mean gate caught it at 0.6× floor). The "way too
  // minimal … greatly improve" ask is served instead by the ENCLOSURE-GATED terms in froxels.js
  // (ENCLOSURE_BEAM_GAIN + raised cap ceiling + isotropic phase blend), which fire ONLY under dense fog
  // (encl≈0 at open vistas ⇒ fog law preserved) — beams get strong exactly where they live, not everywhere.
  godrays: {
    density: 0.35,
    max_density: 0.18,
    steps: 60,
    distance_attenuation: 2,
    strength: 1.2,
    froxel_shaft_gain: 60,
    froxel_beam_base: 1.8,
  },
  // ENG-12 CINEMATIC BLOOM (target: "not bloomy enough … sun powerfully creating rays"): a threshold
  // bloom in LINEAR HDR before AgX (post_stack). threshold 1.5 so ONLY genuinely-bright highlights (the
  // sun disc = 40, sky gaps through canopy, water glints, boosted shafts) halo — hazy near-terrain
  // (luma ≈1.0-1.3) sits BELOW it and stays crisp, so the sun's wide bloom halo does not bleed into and
  // flatten the near-terrain band (the FOG LAW gate — a restrained strength keeps the sun bloom's
  // spread from washing structure). strength 0.18 / radius 0.6 = a soft glow on the bright cores only.
  // Tier-gated to high. Live knobs: __post.bloom_node().{threshold,strength,radius}.
  // [2026-07-04 whiteout] threshold 1.5→2.05 + strength 0.18→0.13: at low-sun tods the LIFTED sky
  // dome (ENG-12 brighter sky + MIE 0.55 halo) pushed most sky pixels past 1.5 ⇒ the whole sky bloomed,
  // washing out visibility entirely. 2.05 keeps bloom on TRUE highlights only (sun disc
  // ~40, specular glints, bright shafts) — the dome tops out below it; strength trimmed to keep halos soft.
  bloom: { threshold: 2.05, strength: 0.13, radius: 0.6 },
  particles: { tint: [0.86, 0.82, 0.72], opacity: 0.45 },
  // grade — the CONQUEST mood (2026-07-03): punchy CONTRAST, faded-filmic lift + shoulder.
  // CO-TUNE 2026-07-03: the refs' true signature is SATURATION + STRUCTURE (q_sat 0.24-0.55), not
  // just low luma — the washed day read colorless (q_sat 0.107). saturation 0.98→1.12 + vibrance
  // 0.05→0.12 restore chroma; shoulder 0.15→0.09 + lift 0.022→0.014 deepen the blacks (less milky
  // low-mid float); contrast 1.18→1.24 firms plane separation. The grade is tod-shared — the A/B
  // confirmed these deltas barely move DUSK (full 204.6→202.9), so the accepted dusk mood survives.
  grade: {
    contrast: 1.24,
    saturation: 1.12,
    vibrance: 0.12,
    local_contrast: 1.0,
    pivot: 0.45,
    lift: 0.014,
    shoulder: 0.09,
  },
})

/**
 * Validate an atmosphere config: altitudes ordered + above the sky-island band, haze/knobs in sane
 * ranges. Returns the list of problems (empty ⇒ valid). Unit-tested; the wiring asserts on it.
 * @param {AtmosphereConfig} cfg
 * @param {number} [max_island_y] highest sky-island altitude clouds must clear (default 350)
 * @returns {string[]} problems
 */
export function validate_atmo_config(cfg, max_island_y = 350) {
  const p = []
  if (!(cfg.cloud.top > cfg.cloud.bottom)) p.push('cloud.top must be > cloud.bottom')
  if (!(cfg.cloud.bottom > max_island_y)) p.push(`cloud.bottom must be > max island y (${max_island_y})`)
  if (cfg.cloud.top - cfg.cloud.bottom < 60) p.push('cloud slab too thin (<60m) to read as volume')
  if (cfg.cloud.coverage < 0 || cfg.cloud.coverage > 1) p.push('cloud.coverage out of [0,1]')
  if (cfg.cloud.density <= 0) p.push('cloud.density must be > 0')
  if (cfg.froxel.near_haze < 0) p.push('froxel.near_haze must be >= 0')
  if (!(cfg.froxel.near_full_m > cfg.froxel.near_start_m)) p.push('froxel.near_full_m must be > near_start_m')
  if (!(cfg.froxel.near_fade_start_m >= cfg.froxel.near_full_m))
    p.push('froxel.near_fade_start_m must be >= near_full_m')
  if (!(cfg.froxel.near_fade_end_m > cfg.froxel.near_fade_start_m))
    p.push('froxel.near_fade_end_m must be > near_fade_start_m')
  // whiteout guard (2026-07-03 + the FOG LAW): the CLEAR-DAY (weather_density=1, ground-level)
  // near band's total optical depth must stay under ~0.7 (≈50% peak veil) — beyond that the near
  // haze re-becomes a wall. Weather events + the altitude band are the sanctioned exceptions.
  const band =
    cfg.froxel.near_fade_end_m / 2 +
    cfg.froxel.near_fade_start_m / 2 -
    (cfg.froxel.near_start_m + cfg.froxel.near_full_m) / 2
  if (cfg.froxel.near_haze * band > 0.7) p.push('froxel near-haze band optical depth > 0.7 (whiteout)')
  if (cfg.froxel.weather_density < 0) p.push('froxel.weather_density must be >= 0')
  if (!(cfg.froxel.altitude_haze_full_y > cfg.froxel.altitude_haze_start_y))
    p.push('froxel.altitude_haze_full_y must be > start_y')
  if (cfg.froxel.altitude_haze_boost < 0 || cfg.froxel.altitude_haze_boost > 8)
    p.push('froxel.altitude_haze_boost out of [0,8]')
  // CLEAR-DAY altitude cap (fog law): the always-on thin-air haze must stay a haze, not a wall
  // (whiteout is weather-gated via altitude_haze_weather_boost). ×1.5 mult max on a clear day.
  if (cfg.froxel.altitude_haze_boost > 0.5)
    p.push('froxel.altitude_haze_boost > 0.5 (clear-day altitude whiteout — gate drama behind weather instead)')
  if (cfg.froxel.altitude_haze_weather_boost < 0 || cfg.froxel.altitude_haze_weather_boost > 8)
    p.push('froxel.altitude_haze_weather_boost out of [0,8]')
  if (cfg.froxel.fog_k <= 0) p.push('froxel.fog_k must be > 0')
  if (cfg.froxel.fog_sea_density < 0) p.push('froxel.fog_sea_density must be >= 0')
  if (cfg.froxel.fog_sea_softness <= 0) p.push('froxel.fog_sea_softness must be > 0')
  if (cfg.godrays.max_density < 0 || cfg.godrays.max_density > 1) p.push('godrays.max_density out of [0,1]')
  if (cfg.godrays.density < 0) p.push('godrays.density must be >= 0')
  if (cfg.godrays.distance_attenuation < 0) p.push('godrays.distance_attenuation must be >= 0')
  if (cfg.godrays.strength < 0) p.push('godrays.strength must be >= 0')
  if (cfg.godrays.froxel_shaft_gain < 0 || cfg.godrays.froxel_shaft_gain > 500)
    p.push('godrays.froxel_shaft_gain out of [0,500]')
  if (cfg.godrays.froxel_beam_base < 0 || cfg.godrays.froxel_beam_base > 8)
    p.push('godrays.froxel_beam_base out of [0,8]')
  if (cfg.bloom.threshold < 0) p.push('bloom.threshold must be >= 0')
  if (cfg.bloom.strength < 0 || cfg.bloom.strength > 3) p.push('bloom.strength out of [0,3]')
  if (cfg.bloom.radius < 0 || cfg.bloom.radius > 1) p.push('bloom.radius out of [0,1]')
  if (cfg.grade.contrast < 1) p.push('grade.contrast should be >= 1 (a lift, not a crush)')
  if (cfg.grade.saturation <= 0) p.push('grade.saturation must be > 0')
  if (cfg.grade.local_contrast < 0.5 || cfg.grade.local_contrast > 1.5) p.push('grade.local_contrast out of [0.5,1.5]')
  if (cfg.grade.pivot <= 0 || cfg.grade.pivot >= 1) p.push('grade.pivot out of (0,1)')
  if (cfg.grade.lift < 0 || cfg.grade.lift > 0.2) p.push('grade.lift out of [0,0.2]')
  if (cfg.grade.shoulder < 0 || cfg.grade.shoulder > 1) p.push('grade.shoulder out of [0,1]')
  return p
}

/**
 * Pure reference for the NEAR-haze density (the "more haze" requirement) — the extra froxel extinction.
 * [2026-07-05 THE SHELL KILL] A CONSTANT σ at every distance. The old CAMERA-DISTANCE WINDOW (ramp
 * 30→80 m, hold, fade) was a fog donut welded to the camera — camera-locked opacity BY CONSTRUCTION,
 * banded into concentric arcs by the exponential froxel slices: the base structure of the reported
 * "huge static circle texture following me" defect. Real atmospheres are exponential in distance with
 * constant σ — depth cueing emerges with zero camera-anchored structure. The 2026-07-03 whiteout fear
 * ("constant floor = τ≈3 over 480 m") belonged to a ~5× larger σ; at 0.0012/m, τ(480 m)≈0.58 ⇒ ~44%
 * haze at the froxel far plane: correct aerial depth, never a wall. The TSL density_hook mirrors this
 * (rise/fall = 1). @param {number} dist_m view distance (ignored — kept for the twin's call shape)
 * @param {AtmosphereConfig['froxel']} f @returns {number} extra σ (1/m)
 */
export function near_haze_sigma(dist_m, f) {
  void dist_m // constant by design — see the shell-kill note above
  return f.near_haze
}

/**
 * Sun radiance (color × intensity) for clouds/froxels at a given sun elevation — reuses the sky's
 * dusk-warmth tint so cloud lighting matches the sky. Pure; the wiring pushes this into the shared
 * uniform each tod change. @param {number} sun_y sun direction y @param {number} [intensity]
 * @returns {[number,number,number]}
 */
export function sun_radiance_for(sun_y, intensity = 8) {
  const tint = sun_tint_for(sun_y)
  // fade to near-zero below the horizon (night) so clouds/fog aren't lit by a sub-horizon sun.
  const up = Math.max(0, Math.min(1, (sun_y + 0.1) / 0.2))
  const k = intensity * up
  return [tint[0] * k, tint[1] * k, tint[2] * k]
}

// --- point-light fog scatter (SPEC §M — pure reference this wave; TSL rides ENG-5) ----------------
// Technique adapted from Isaac Dykeman's "A Simple Fog Shader" —
// https://ijdykeman.github.io/graphics/simple_fog_shader (closed-form point-light scatter integral).

/** minimum perpendicular light-to-ray distance (m) — the "bulb radius" clamp on the 1/h singularity
 *  (a view ray through the light's exact centre would diverge; physically the emitter has extent). */
export const POINT_SCATTER_MIN_H = 0.25

/**
 * Closed-form in-scatter integral for ONE point light along a view ray — THE §M reference the TSL
 * node will mirror. For ray `P(t)=cam+dir·t` (dir normalized) and a light at `light`, with
 * `t_c = dot(light−cam, dir)` (closest approach) and `h = |light − P(t_c)|` (perpendicular distance):
 *   ∫₀ᵈ dt / (h² + (t−t_c)²)  =  ( atan((d−t_c)/h) + atan(t_c/h) ) / h
 * Returned raw (1/m units); the caller multiplies by light color·intensity·ρ_fog (§M). Handles the
 * light BEHIND the camera (t_c<0) and fragments short of closest approach (d<t_c) — the atan form is
 * exact for any segment. Never exceeds π/h (the full-line integral — the §M bounding-sphere bound).
 * @param {[number,number,number]} cam ray origin (camera)
 * @param {[number,number,number]} dir unit view direction
 * @param {number} frag_dist segment length d ≥ 0 (camera→fragment, meters)
 * @param {[number,number,number]} light world light position
 * @returns {number} the scatter integral (≥ 0)
 */
export function point_scatter_integral(cam, dir, frag_dist, light) {
  const lx = light[0] - cam[0]
  const ly = light[1] - cam[1]
  const lz = light[2] - cam[2]
  const t_c = lx * dir[0] + ly * dir[1] + lz * dir[2]
  const px = lx - dir[0] * t_c
  const py = ly - dir[1] * t_c
  const pz = lz - dir[2] * t_c
  const h = Math.max(Math.sqrt(px * px + py * py + pz * pz), POINT_SCATTER_MIN_H)
  return (Math.atan((frag_dist - t_c) / h) + Math.atan(t_c / h)) / h
}

/**
 * @typedef {object} Atmosphere
 * @property {ReturnType<typeof create_clouds>} clouds
 * @property {ReturnType<typeof create_froxels>} froxels
 * @property {ReturnType<typeof create_particles>} particles
 * @property {ReturnType<typeof create_grade_node>} grade
 * @property {ReturnType<typeof create_voxel_sun> | null} voxel_sun ENG-10 sun-visibility volume (froxel
 *   tiers only; null otherwise) — its `sample_visibility_at` drives the froxel shafts.
 * @property {(fn: (cb: (rec: import('../chunks/format.js').ChunkRecord) => void) => void) => void} set_resident_provider
 *   engine hands voxel_sun its resident-chunk iterator once ring_manager exists (post-renderer build).
 * @property {*} sun_direction the shared `uniform(vec3)` (= sky.sun_direction) clouds/froxels read.
 * @property {*} sun_radiance the shared `uniform(vec3)` sun color×intensity for clouds/froxels.
 * @property {*} near_haze `uniform(float)` — the live NEAR-haze band knob (seasoning by default).
 * @property {*} weather_density `uniform(float)` — the weather wave's fog multiplier (1 = clear;
 *   snow/rain events raise it — high-altitude + snowing is the only sanctioned whiteout).
 * @property {*} fog_sea `uniform(float)` — ENG-12 altitude fog-sea strength (0 disables; the alpine/
 *   morning-inversion white valley sea, gated up by weather_density — the Hodilton peak-above-sea look).
 * @property {{ clouds:boolean, froxels:boolean, bloom_off:boolean }} features tier-derived pass gates (+ the ?bloom=0 kill switch).
 * @property {(renderer:*)=>Promise<void>} bake bake cloud volumes + particle seeds (await at setup).
 * @property {(renderer:*, camera:*, dt:number)=>void} tick per-frame: clouds.tick + froxels.update.
 * @property {()=>void} on_time_of_day refresh sun_radiance from the sky tint + re-bake cloud shadow.
 * @property {AtmosphereConfig} config the live config (mutate + call on_time_of_day / re-tick to apply).
 * @property {()=>void} dispose
 */

/**
 * @typedef {object} AtmosphereOptions
 * @property {TierName} [tier] quality tier (gates cloud/froxel/particle budgets). Default 'high'.
 * @property {import('./sky/sky_node.js').SkyNode} sky the shared sky node (sun_direction + sample_sky).
 * @property {import('three').DirectionalLight} [sun] the scene sun (for sun_radiance init; godrays wired separately).
 * @property {number} [world_size] world span (m) for the cloud shadow footprint. Default 16384.
 * @property {(x:number, z:number)=>number} [height_at] [2026-07-05 PLAN A] CPU ground-height probe
 *   (world_surface_y) feeding the froxel fog's camera-following HEIGHT FIELD (fog_height.js) — the
 *   SMOOTH open-air sun-occlusion input that replaced the voxel-sun volume there (the static-arc fix).
 *   Without it the froxel `sample_height` falls back to flat sea level (isolation harnesses).
 * @property {Partial<AtmosphereConfig>} [config] config overrides.
 */

/**
 * Build the composed atmosphere: clouds + froxels + particles + grade, all sharing the sky's
 * sun_direction and a sun_radiance derived from the sky tint, with the NEAR-haze density floor and
 * the cloud altitudes retuned for our world. Nothing GPU runs until `bake(renderer)`; passes are
 * composed by the phase-2 wiring (see the SPEC block above). This factory does NOT touch renderer.js.
 * @param {AtmosphereOptions} opts
 * @returns {Atmosphere}
 */
export function create_atmosphere(opts) {
  const tier = opts.tier ?? 'high'
  const { sky } = opts
  const world_size = opts.world_size ?? 16384
  const config = /** @type {AtmosphereConfig} */ ({
    cloud: { ...ATMO_CONFIG.cloud, ...opts.config?.cloud },
    froxel: { ...ATMO_CONFIG.froxel, ...opts.config?.froxel },
    godrays: { ...ATMO_CONFIG.godrays, ...opts.config?.godrays },
    bloom: { ...ATMO_CONFIG.bloom, ...opts.config?.bloom },
    particles: { ...ATMO_CONFIG.particles, ...opts.config?.particles },
    grade: { ...ATMO_CONFIG.grade, ...opts.config?.grade },
  })

  // shared uniforms: the sky owns sun_direction; sun_radiance derives from its tint. A real TSL vec3
  // uniform whose `.value` Vector3 is mutated in place on each tod change (froxels/clouds read it live).
  const { sun_direction } = sky
  const rad0 = sun_radiance_for(sun_direction.value.y)
  const sun_radiance_uniform = uniform(new Vector3(rad0[0], rad0[1], rad0[2]))

  const wind = new Vector2(config.cloud.wind[0], config.cloud.wind[1]).normalize()

  // NEAR-HAZE density hook (the "more haze" requirement): add a distance-ramped extinction floor to the froxel
  // base density so mid-range clutter softens. `p` is the froxel world sample; distance = |p − cam|,
  // but the froxel already encodes depth in its slice — we approximate view distance by the sample's
  // planar distance from the camera via the froxel's own uniforms is not exposed here, so we key the
  // floor off ALTITUDE-agnostic horizontal range using the camera uniform the froxel exposes. Simpler
  // and robust: add the floor as a constant small σ that the froxel's own height/tod terms then shape.
  // We express it as a hook so it stays a single knob; the ramp-by-distance refinement is a wiring
  // detail (needs the froxel cam uniform) noted in the SPEC (§F). Here: a gentle additive floor.
  const near_haze = uniform(config.froxel.near_haze) // live knob (near-band strength — SEASONING default)
  const weather_density = uniform(config.froxel.weather_density) // weather-wave whiteout lever (law §2)
  const fog_sea = uniform(config.froxel.fog_sea_density) // ENG-12 altitude fog-sea strength (0 disables)
  // Density hook = the FOG LAW in one expression:
  //   (base + windowed near band) · weather · (1 + altitude boost)
  // • near band (mirrors near_haze_sigma): rises 8→30 m, fades 100→220 m — a constant floor
  //   integrated to τ≈2.9 over the froxel range = the 2026-07-03 whiteout; the window is the fix.
  // • altitude: peaks (y 260→320+) sit in the cloud band — heavy haze is LEGAL up there.
  // • weather_density: default 1; the weather wave drives it (snow/rain = sanctioned whiteout).
  // ENG-10 enclosure sampler — assigned once voxel_sun is created (below). A closure holder (not a
  // direct ref) so the hook, defined here, safely reads it after voxel_sun initializes.
  /** @type {((p:*)=>*)|null} */
  let sky_openness_at = null
  /** @param {*} p vec3 world-pos node @param {*} rho @param {*} dist float node — camera distance (m) @returns {*} */
  const density_hook = (p, rho, dist) => {
    // [2026-07-05 THE SHELL KILL — the dying froxel-rebuild worker's last insight, executed by the
    // architect] The near-haze was WINDOWED BY CAMERA DISTANCE (rise 30→80 m, hold, fade) — i.e. a
    // fog DONUT welded to the camera at fixed radius: camera-locked BY CONSTRUCTION, banded into
    // concentric arcs by the exponential slices, sun-tinted white by day and opacity-DARK by night —
    // the reported "huge static circle texture following me" base structure (it survived every vis-side
    // fix because it is a DENSITY structure, not a visibility one). The "more haze" requirement is
    // now a CONSTANT physical floor: the same near_haze σ applied at ALL distances (real atmospheres
    // are exponential in distance with constant σ — depth cueing emerges with zero camera-locked
    // structure). The old whiteout fear ("constant floor = τ≈3 over 480 m") belonged to a 5× larger σ;
    // at 0.0012/m, τ(480 m)≈0.58 → ~44% haze at the far plane: correct aerial depth. rise/fall = 1.
    const rise = float(1)
    const fall = float(1)
    const alt = smoothstep(float(config.froxel.altitude_haze_start_y), float(config.froxel.altitude_haze_full_y), p.y)
    // altitude boost (CO-TUNE 2026-07-03) = clear-air thin haze (ALWAYS) + weather-gated whiteout
    // drama (only when weather_density>1). Clear day ⇒ weather_extra=0 ⇒ only the ×altitude_haze_boost
    // thin haze fires (fog law: whiteout ONLY at altitude AND snowing). The snow wave drives
    // weather_density up → the dramatic high-altitude whiteout returns via altitude_haze_weather_boost.
    const weather_extra = weather_density.sub(1).max(0)
    const alt_boost = alt.mul(
      float(config.froxel.altitude_haze_boost).add(weather_extra.mul(config.froxel.altitude_haze_weather_boost))
    )
    let out = rho
      .add(near_haze.mul(rise.mul(fall)))
      .mul(weather_density)
      .mul(alt_boost.add(1))
    // ENG-10 ENCLOSURE FOG: thicken the air where the sky is occluded above (canopy/cave) so interiors
    // read misty + short-range while open air stays clear. enclosure = 1 − sky_openness (0 open → 1
    // enclosed). This is an ADDITIVE, tod-INDEPENDENT density floor (a forest is dim at noon too — the
    // base rho's tod_k kills noon fog, so a multiplier on it would vanish; the target is ~20 m interior
    // visibility DAY and night). Windowed past `near_start_m` so the foreground stays crisp/readable, and
    // scaled by weather (snow thickens further). Only fires with voxel_sun mounted (froxel tiers).
    if (sky_openness_at) {
      const enclosure = float(1).sub(sky_openness_at(p))
      // Dedicated SHORT rise (≈4→18 m) — not the 30-80 m near-haze window — so under-canopy gloom builds
      // by ~20 m (target) while the immediate foreground (<4 m) stays perfectly crisp.
      // ⚠ [2026-07-05 FROXEL REBUILD — camera-distance-window DISEASE CLASS, unadjudicated] This rise is
      // the same pattern as the killed near-haze donut (a density term windowed by CAMERA distance = a
      // shell welded to the camera). Likely invisible here (short 4→18 m window inside dense ~20 m-vis
      // enclosure fog), but it has NOT been measured: adjudicate with an UNDER-CANOPY leg of
      // bench/froxel_static_overlay.spec.js before trusting it; if it reads, constant-floor it with a
      // taste re-tune (the foreground-crisp intent must survive).
      const encl_rise = smoothstep(float(4), float(18), dist)
      out = out.add(enclosure.mul(config.froxel.enclosure_density).mul(encl_rise).mul(weather_density))
    }
    // ENG-12 ALTITUDE FOG SEA (Hodilton ref: "white valley sea, summits breaking through"): a dense
    // ADDITIVE floor BELOW fog_sea_level, faded out over fog_sea_softness at the top (so summits poke
    // through). tod-INDEPENDENT (an inversion sits all day). `below` = 1 under the ceiling → 0 above it.
    // Windowed past near_start_m so the immediate foreground stays crisp. GATED so it is NOT everywhere-
    // always: 0.08 baseline (2026-07-03 rebalance, was 0.25 — a barely-there valley mist that no longer
    // reads as a dense dawn soup everywhere below y145, and stops taxing every frame with full-screen
    // scatter) + 0.9·weather_extra (the snow/alpine system drives the dramatic sea via weather_density —
    // the sanctioned high-altitude whiteout; the money shot at weather 2.2 is byte-unchanged).
    const below = smoothstep(
      float(config.froxel.fog_sea_level),
      float(config.froxel.fog_sea_level - config.froxel.fog_sea_softness),
      p.y
    )
    const sea_gate = weather_density.sub(1).max(0).mul(0.9).add(0.08)
    // ⚠ [2026-07-05 FROXEL REBUILD — camera-distance-window DISEASE CLASS, unadjudicated] `sea_rise` is
    // the same pattern as the killed near-haze donut: from INSIDE the sea band (camera below
    // fog_sea_level) this 30→80 m camera-distance ramp is a density shell welded to the camera. The
    // altitude gate (`below`) is world-anchored and legal; the DISTANCE ramp is the suspect. Inert at
    // the arc-gate's desert framings (y150 > sea level 145) so it has NOT been measured: adjudicate with
    // a VALLEY (<y145) leg of bench/froxel_static_overlay.spec.js; if it reads, make the sea purely
    // altitude-anchored (constant past a tiny foreground guard) like the near-haze constant floor.
    const sea_rise = smoothstep(float(config.froxel.near_start_m), float(config.froxel.near_full_m), dist)
    out = out.add(fog_sea.mul(below).mul(sea_gate).mul(sea_rise))
    return out
  }

  const clouds = create_clouds({
    tier: /** @type {any} */ (tier),
    sample_sky: sky.sample_sky,
    sun_direction,
    sun_radiance: sun_radiance_uniform,
    wind_direction: uniform(wind),
    world_size,
    cloud_bottom: config.cloud.bottom,
    cloud_top: config.cloud.top,
  })
  clouds.coverage.value = config.cloud.coverage
  clouds.density.value = config.cloud.density

  // ENG-10 VOXEL SUN — a view-independent DDA occupancy volume feeding the froxel shafts, so light
  // pierces real canopy holes + cave mouths (the heightfield march couldn't). Built only at froxel
  // tiers (HIGH); its `sample_visibility_at` REPLACES the froxel scatter's heightfield vis march.
  // Occupancy is CPU-authored from the resident chunks each camera-crossing — the engine hands the
  // resident-record iterator to `tick` (set_resident_provider); the DDA march re-runs per frame (cheap).
  // ✅ FROXELS DEFAULT-ON (2026-07-04, architect ruling after the ENG-14 rework PROVED green):
  // the 07-04 default-off gate existed for artifacts + frame cost — both are fixed and measured:
  // per-pixel IGN dither (checkerboard dead), sea_gate 0.08 (dawn soup dead), honest whole-pass A/B
  // ?froxels=1 vs 0 at 1440@dsf2: ON p75 +0.29ms (gate ≤+0.5), zero WebGPU errors, 613 tests green
  // (artifacts: /tmp/aresrpg-engine-artifacts/beam_sweep/). The blue under-canopy gloom (target)
  // reads. Beams are enclosure-gated by design: strong only under real dense canopy, subtle in open
  // air (fog law) — beam TASTE tuning continues via the exported knobs; ?froxels=0 = escape hatch.
  // [2026-07-05 RELEASE RULING — bisection convicted the froxel VOLUME itself] After the
  // full acquittal ladder (clouds deck ✕, cloud-shadow coupling ✕, bloom ✕, particles ✕, godrays ✕,
  // sky-island layer ✕ — each cut landed, the artifact survived; ?froxels=0 was the ONLY kill), the
  // camera-following static-texture halo is generated INSIDE the froxel field (its depth slices are
  // camera-concentric shells by construction; convergence ≈ the reported "takes up to 10s to appear").
  // Volumetric fog is DEFAULT OFF for release — the classic exponential fog + the far shell's aerial
  // haze carry distance depth (the low path never flagged). ?froxels=1 re-enables for the
  // post-release rebuild, which must ship with a slice-banding + temporal-freeze pixel test at the
  // reference framings (moving camera, ULTRA, 20s+ soak) before it may default on again.
  const froxels_on_flag = typeof location !== 'undefined' && new URLSearchParams(location.search).get('froxels') === '1'
  const froxels_on = froxels_on_flag && tier === 'high'
  const voxel_sun = froxels_on ? create_voxel_sun({ sun_direction }) : null
  // Feed the enclosure-fog hook (defined above) the sky-openness sampler now that voxel_sun exists.
  if (voxel_sun) sky_openness_at = voxel_sun.sample_sky_openness_at
  // [2026-07-05 PLAN A] the froxel fog's HEIGHT FIELD — the smooth open-air sun-occlusion input (and the
  // real ground for the density's height falloff, unwired since the port). Built only when the caller
  // supplies a CPU probe (renderer.js passes world_surface_y) at froxel tiers; the initial footprint is
  // baked synchronously at boot around the demo spawn — tick() re-bakes amortized as the camera roams.
  const fog_height = froxels_on && opts.height_at ? create_fog_height({ height_at: opts.height_at }) : null

  const froxels = create_froxels({
    tier: /** @type {any} */ (tier),
    sample_sky: sky.sample_sky,
    sun_direction,
    sun_color: sun_radiance_uniform,
    density_hook,
    shaft_gain: config.godrays.froxel_shaft_gain,
    beam_base: config.godrays.froxel_beam_base,
    cloud_shadow_at: clouds.shadow_at, // cloud shadows dim the volumetric shafts (design-coherent)
    ...(fog_height ? { sample_height: fog_height.sample_height_at } : {}),
    ...(voxel_sun
      ? {
          sun_visibility_at: voxel_sun.sample_visibility_at,
          // ENG-19 BUG-2: sky-openness gates the SEALED-cave beam kill (froxels.js) — the froxel sun-beam
          // fades where a solid roof seals the sky above (its sun-visibility is unreliable there), while
          // forest gaps + open air keep their beams. Same voxel-sun volume, its .g channel.
          sky_openness_at: voxel_sun.sample_sky_openness_at,
        }
      : {}),
  })
  froxels.fog_k.value = config.froxel.fog_k

  const grade = create_grade_node(config.grade) // full GradeConfig passthrough (fields align)

  // feature gates: the froxel path gates on tier NAME here (the former tiers.js `volumetrics` field was
  // removed 2026-07-10) — the froxel grid builds at HIGH+ via froxels_on; clouds gate on the cloud
  // tier's own march budget. post_stack + tick consume these so lower tiers pay nothing.
  // [2026-07-05 bisection switchboard] per-system kill flags to step-disable the
  // haze stack live: ?clouds=0 (deck + shadow bake), ?bloom=0 (NOTE: bloom rides the froxels tier gate,
  // so the ?froxels=0 test disabled BOTH — bloom is the other suspect that flag cleared).
  const flag_off = (/** @type {string} */ name) =>
    typeof location !== 'undefined' && new URLSearchParams(location.search).get(name) === '0'
  const features = {
    clouds: clouds.tier.march_steps > 0 && !flag_off('clouds'),
    froxels: froxels_on, // ⛔ flag-gated with the same ?froxels=1 switch (see froxels_on above)
    bloom_off: flag_off('bloom'), // consumed by post_stack's with_bloom
  }

  // [2026-07-05 THE TORMENTOR] The ambient particle layer is
  // DISABLED for release (count 0 ⇒ zero draws). The camera-following mote box (a box that follows the
  // camera — the code's own vocabulary) renders its hash-lattice motes as CONCENTRIC ARC SHELLS when viewed
  // from inside; the soft sky-lit alpha sprites read WHITE by day and DARK by night (a night capture
  // ruled out every additive-light suspect — only alpha geometry darkens a sky), blurring into the
  // observed "huge static low-res circle texture… following the camera… colored by the time of day" symptom. Days of
  // ghost-hunting (cloud march, godrays, shadow edge, sky-island layer — each a real defect, none THE
  // one) ended here. Re-enable post-release ONLY with a blue-noise spatial distribution + a lattice
  // ring-pattern test at the reference framings. ?particles=1 forces it back on for A/B.
  const particles_on = typeof location !== 'undefined' && new URLSearchParams(location.search).get('particles') === '1'
  const particles = create_particles({
    weather_particle_count: particles_on ? weather_budget_for(tier) : 0,
    tint: config.particles.tint,
  })
  particles.opacity.value = config.particles.opacity

  /** @type {*} */ let last_renderer = null
  // ENG-10: the engine hands voxel_sun its resident-chunk iterator once ring_manager exists (built
  // AFTER the renderer). Until set, the volume stays empty (all-open sky) — froxels degrade gracefully.
  /** @type {((cb: (rec: import('../chunks/format.js').ChunkRecord) => void) => void) | null} */
  let resident_provider = null
  /** @param {(cb: (rec: import('../chunks/format.js').ChunkRecord) => void) => void} fn */
  const set_resident_provider = (fn) => {
    resident_provider = fn
  }

  /** @param {*} renderer */
  const bake = async (renderer) => {
    last_renderer = renderer
    // low's march budget is 0 — skip the volume bakes entirely (no pass consumes them).
    if (clouds.tier.march_steps > 0) await clouds.bake(renderer)
    await particles.bake(renderer)
  }

  /** @param {*} renderer @param {*} camera @param {number} dt */
  const tick = (renderer, camera, dt) => {
    last_renderer = renderer
    // ENG-14: pass the camera xz so the cloud-shadow footprint tracks the player (no reachable box edge).
    if (features.clouds) clouds.tick(renderer, dt, [camera.position.x, camera.position.z])
    // ENG-10: refresh the sun-visibility volume BEFORE the froxel scatter samples it. Occupancy
    // rebuilds only on camera crossings (inside update); the DDA march re-runs each frame.
    if (voxel_sun && resident_provider) voxel_sun.update(renderer, camera, { for_each_resident: resident_provider })
    // [2026-07-05 PLAN A] keep the fog height footprint tracking the camera (amortized re-bake + blend).
    fog_height?.update(camera, dt)
    if (features.froxels) froxels.update(renderer, camera)
  }

  const on_time_of_day = () => {
    const { y } = sun_direction.value
    const r = sun_radiance_for(y)
    sun_radiance_uniform.value.set(r[0], r[1], r[2])
    // [D173, 2026-07-05: "the night is not darker… high brightness for comfort, but the rest should
    // loose coloring and the atmosphere should feel dark"] NIGHT = DESATURATION, not darkness: exposure/
    // ambient stay untouched (comfort/playability), but the grade's saturation slides toward monochrome
    // as the sun sets — the world reads as moonlit silver, the haze goes colorless-dark (its colour
    // already tracks the near-black night horizon via refresh_fog). Day saturation = the baseline tuned cfg.
    const night_amount = y >= 0.02 ? 0 : Math.min(1, (0.02 - y) / 0.14)
    grade.saturation.value = config.grade.saturation * (1 - 0.6 * night_amount)
    if (last_renderer) clouds.refresh_shadow(last_renderer)
  }

  const dispose = () => {
    particles.dispose()
    // ENG: free the cloud bake textures AND make refresh_shadow inert — a post-teardown time-of-day poke
    // (on_time_of_day → clouds.refresh_shadow) must never computeAsync the now-disposed renderer.
    clouds.dispose()
  }

  return {
    clouds,
    froxels,
    voxel_sun,
    set_resident_provider,
    particles,
    grade,
    sun_direction,
    sun_radiance: sun_radiance_uniform,
    near_haze,
    weather_density,
    fog_sea,
    features,
    bake,
    tick,
    on_time_of_day,
    config,
    dispose,
  }
}

/** the tod ambient-depth curve as a NODE builder (constraint #2) — exported for terrain_material.js
 * to import so the interior-recede scale has ONE source. Maps a normalized BFS sun value [0,1] to the
 * ambient scale [AMBIENT_INTERIOR_SCALE, AMBIENT_EXTERIOR_SCALE].
 * @param {*} bfs_sun_norm float node in [0,1] @returns {*} float ambient-scale node */
export function ambient_depth_scale(bfs_sun_norm) {
  return smoothstep(0, 1, bfs_sun_norm)
    .mul(AMBIENT_EXTERIOR_SCALE - AMBIENT_INTERIOR_SCALE)
    .add(AMBIENT_INTERIOR_SCALE)
}

/** pure twin of ambient_depth_scale for tests. @param {number} bfs [0,1] @returns {number} */
export function ambient_depth_scale_f(bfs) {
  const b = bfs < 0 ? 0 : bfs > 1 ? 1 : bfs
  const s = b * b * (3 - 2 * b)
  return AMBIENT_INTERIOR_SCALE + s * (AMBIENT_EXTERIOR_SCALE - AMBIENT_INTERIOR_SCALE)
}

/** the interior ambient-COLOR cast as a NODE builder (design ref: sky-lit shade = cool). Lerps the
 * ambient tint from neutral white at v_sun=1 (open ground — sunlit risers stay warm) toward
 * AMBIENT_SHADE_TINT (cool sky-blue) at v_sun=0 (deep interior / cave), on the SAME smoothstep curve as
 * ambient_depth_scale so tint and darkness track together. terrain_material.js multiplies the
 * ambient-FLOOR term by this ONLY — the direct/torch light lane is untouched — and it reuses v_sun (no
 * new fetch). @param {*} v_sun float node in [0,1] (BFS sun/15) @returns {*} vec3 ambient-tint node */
export function ambient_tint(v_sun) {
  return mix(
    vec3(AMBIENT_SHADE_TINT[0], AMBIENT_SHADE_TINT[1], AMBIENT_SHADE_TINT[2]),
    vec3(1, 1, 1),
    smoothstep(0, 1, v_sun)
  )
}

/** pure twin of ambient_tint for tests. @param {number} bfs [0,1] @returns {[number,number,number]} */
export function ambient_tint_f(bfs) {
  const b = bfs < 0 ? 0 : bfs > 1 ? 1 : bfs
  const s = b * b * (3 - 2 * b)
  return [
    AMBIENT_SHADE_TINT[0] + s * (1 - AMBIENT_SHADE_TINT[0]),
    AMBIENT_SHADE_TINT[1] + s * (1 - AMBIENT_SHADE_TINT[1]),
    AMBIENT_SHADE_TINT[2] + s * (1 - AMBIENT_SHADE_TINT[2]),
  ]
}

/** map a tier → its weather_particle_count (mirrors tiers.js; kept local to avoid a tiers import cycle).
 * @param {TierName} tier @returns {number} */
function weather_budget_for(tier) {
  return WEATHER_BUDGET[tier] ?? 0
}
/** @type {Record<TierName, number>} — MUST match tiers.js `weather_particle_count`. */
const WEATHER_BUDGET = {
  low: 0,
  medium: 50_000,
  high: 300_000,
}

// keep the froxel/cloud tier tables referenced (config validation + wiring index by tier).
void FROXEL_TIERS
void CLOUD_TIERS
// TSL ops reserved for the compose_* helpers landing in phase 2 (kept imported so the SPEC's
// referenced ops are present and checkJs-clean when those functions are filled in).
void clamp
void exp
