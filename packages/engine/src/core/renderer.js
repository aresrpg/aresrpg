// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WebGPURenderer boot (§2.1, §2.2). Detects navigator.gpu → WebGPU backend, else falls back to
// the WebGPURenderer's built-in WebGL2 backend. `reversedDepthBuffer` is enabled ONLY on the
// WebGPU path — the WebGL backend has open reversed-Z bugs (three.js #31413, §2.1/§9.4) — so we
// construct the renderer AFTER detecting which backend we'll actually get, rather than always
// requesting reversed-Z and hoping.
//
// Design decision (§10.1): WebGPU-only at v1 behind a capability gate — `forceWebGL` stays wired
// (three's own fallback, free via TSL dual-compile) but we surface a `backend` field on the
// returned handle so engine.js / the demo HUD can show "your browser can't run the new world
// yet" instead of silently degrading.

import {
  AgXToneMapping,
  Color,
  DirectionalLight,
  FloatType,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import {
  abs,
  cameraPosition,
  exp,
  float,
  fog,
  length,
  max,
  mix,
  positionWorld,
  sign,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl'

import { create_sky_node, sample_sky_rgb, sun_dir_from_tod } from '../render/sky/sky_node.js'
import { CELESTIAL_CYCLE_MS, celestial_tod_at, is_linear_celestial_step } from '../render/sky/celestial_motion.js'
import { create_hillaire_sky } from '../render/sky_hillaire/hillaire_sky.js'
import { world_surface_y } from '../gen/world_gen.js'
import { create_atmosphere } from '../render/atmosphere.js'
import { create_post_stack } from '../render/lighting/post_stack.js'
import { enable_fight_vfx_layer } from '../render/vfx_preset_engine.js'
import { create_auto_exposure } from '../render/lighting/auto_exposure.js'
import { couple_lighting, shadow_intensity_for, is_moon_key } from '../render/lighting/sky_light_coupling.js'
import { create_underwater_pass } from '../render/lighting/underwater.js'
import { create_camera_rotation_blur } from '../render/lighting/motion_blur.js'
import { set_water_depth_texture_type } from '../render/water_material.js'
import { atlas_layer_count, MAX_ATLAS_LAYERS } from '../render/texture_baker.js'
import { max_pool_storage_bytes } from '../render/pool_renderer.js'

import { QUALITY_TIERS, TIER_ORDER } from './quality/tiers.js'

/**
 * The ONE cinematic deep-blue haze tilt — a DARKENING multiply (R/G cut, B ≤ 1). SINGLE SOURCE shared by
 * the analytic fogNode (LOW tier, below) AND the physical aerial fog (MEDIUM/HIGH, via create_hillaire_sky
 * — passed as `cool_tilt`) so the two tiers of the sky ladder cannot drift. Ground truth (2026-07-11): the
 * rejected BRIGHT tilt read as "white soup" — brightness, not hue, was the bug; a darkening multiply keeps
 * blue dominant while dropping the far-haze luma ⇒ DEEP cinematic blue, not a pale wash.
 * @type {[number, number, number]}
 */
export const FOG_COOL_TILT = [0.62, 0.75, 1.0]

/**
 * @typedef {object} RendererHandle
 * @property {import('three/webgpu').WebGPURenderer} renderer
 * @property {Scene} scene
 * @property {PerspectiveCamera} camera
 * @property {'webgpu'|'webgl2'} backend which backend actually initialized (post-detect)
 * @property {(camera: import('three').Camera, terrain_epoch: number, queue_depth?: number) => void} sync_shadow
 *   per-frame shadow driver (W11 T1+T2 + stream debounce): recenters the sun's ortho shadow box on
 *   the camera (LIGHT-SPACE texel-snapped, on camera-chunk-boundary change) AND gates shadow-map
 *   re-render so it only re-renders when the box moved or terrain changed (autoUpdate off). Terrain-
 *   change re-renders are DEBOUNCED to ≤1 / 500 ms while streaming (queue_depth>0) and flushed
 *   immediately once streaming is idle; a box recenter always renders immediately. Call once per
 *   rendered frame BEFORE renderer.render(). `terrain_epoch` = terrain_renderer.upload_epoch();
 *   `queue_depth` = ring_manager.queue_depth() (0/omitted ⇒ treated as idle → no debounce).
 * @property {() => [number, number, number, number]} shadow_box current sun shadow ortho box world
 *   XZ extent [min_x, min_z, max_x, max_z] — the render lane pushes it into
 *   terrain_renderer.set_shadow_box so shadow-map invalidation is scoped to the shadowed region.
 * @property {() => void} request_shadow_render [C1] one-shot sun shadow-map dirty (self-clears after
 *   one render) — the pipeline warm queue fires it so a warm-mounted caster's shadow-depth pipelines
 *   compile inside the same sliced warm frame.
 * @property {import('../render/sky/sky_node.js').SkyNode} sky the analytic sky node backing the scene
 *   background + the fog haze color; its `sun_direction`/`set_time_of_day` drive day-night, and the far
 *   shell reads `sun_direction` so its flat-shade sun matches the sky (NG-LOD phase B).
 * @property {import('../render/atmosphere.js').Atmosphere | null} atmo NG2-ATMO composition — clouds,
 *   froxel fog, grade, particles + every live tuning uniform (dev/qa knobs). NULL when the
 *   resilience guard degraded the chain (construction threw — bare-render fallback).
 * @property {ReturnType<typeof create_hillaire_sky> | null} hillaire physical sky at medium/high.
 * @property {import('../render/lighting/post_stack.js').PostStack | null} post the RenderPipeline
 *   post stack; NULL under the same degradation.
 * @property {import('../render/lighting/underwater.js').UnderwaterPass | null} underwater the ENG-13
 *   underwater immersion pass (blue fog + refraction wobble when the eye is submerged), or null under
 *   the atmosphere degradation guard. Its `active`/`depth`/`warp_amp` uniforms are live owner knobs.
 * @property {(state: { submerged: boolean, depth: number, dt: number }) => void} update_underwater
 *   pushes the per-frame submerged state (engine.js computes it from the resident chunk store) — call
 *   BEFORE render_frame so the frame reflects it. No-op when degraded.
 * @property {(frame_dt_seconds?: number, speed?: number) => void} render_frame renders one frame through
 *   the post stack — the drop-in replacement for renderer.render(scene, camera); engine.js calls THIS.
 *   `speed` (m/s, default 0) forwards the player's ground speed to the motion-blur run-speed trigger.
 * @property {() => void} refresh_fog re-samples the linear-fog haze color from the sky at the
 *   current sun elevation — call after set_time_of_day so fog tracks dusk/night.
 * @property {(scale: number) => void} set_fog_scale [D213-B] master scene-fog gate (0 = none).
 * @property {(on: boolean) => void} set_motion_blur_enabled [D251-2] runtime camera-blur toggle (no-op if uncreated).
 * @property {(near_m: number, far_m: number) => void} set_far_fog pushes the fog band out to the
 *   far-shell boundary (fog near = near_m, far = far_m) — kills the ~168 m near-ring fog wall so terrain
 *   dissolves near→far-shell→sky across the whole horizon (NG-LOD phase B). Replaces the old
 *   set_fog_far_ceiling clamp. Idempotent.
 * @property {() => void} dispose releases the GPU device and detaches the device-loss handler
 */

/**
 * @typedef {object} RendererOptions
 * @property {HTMLCanvasElement} canvas
 * @property {number} [fov] vertical FOV in degrees, default 70
 * @property {number} [near] default 0.1
 * @property {number} [far] default 20000 (§5.1 far-field horizons run to 16km+)
 * @property {import('./quality/tiers.js').TierName} [tier] quality tier — gates the NG2-ATMO
 *   pass budgets (cloud march steps, froxel grid, god rays). Default 'high'.
 * @property {string} [seed] deterministic night-sky seed.
 * @property {(info: unknown) => void} [on_device_lost] called with the GPUDeviceLostInfo (or
 *   the WebGL-backend equivalent) when the device is lost; renderer.js always attempts one
 *   re-init on top of whatever the caller does (log + retry, §brief)
 * @property {(ok: boolean) => void} [on_device_restore] called once the one re-init attempt above
 *   settles — `true` on success (the SAME renderer/canvas is live again), `false` if it threw (no
 *   further retry — the caller's job is to say so honestly instead of leaving a silent black canvas).
 * @property {boolean} [hillaire_rebuild_on_rotate] false suppresses only orientation-triggered aerial rebuilds.
 * @property {() => void} [on_hillaire_aerial] hitch-probe hook at the aerial compute dispatch.
 */

/**
 * Detects whether `navigator.gpu` is present. Coarse capability gate only — the real backend
 * selection still goes through WebGPURenderer's own `getFallback`, this is just used to report
 * which path we asked for before construction.
 * @returns {boolean}
 */
export function has_webgpu_support() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
}

/** Sun ortho shadow half-extent in meters (box is ±this on X/Z around its centre). Sized to WRAP the
 *  streamed ring so cast shadows reach as far as terrain renders. D33 raised the view distance
 *  (LOAD_RADIUS_CHUNKS 5→6 ⇒ loaded edge 6·32 = 192 m, with r7 = 224 m a sanctioned owner bump), so
 *  the box grew 140→200 m: it fully covers the r6 ring and most of r7's, capped at 200 because a full
 *  224 m half-box would coarsen the fixed-2048² map's texels past the terrace-edge crispness budget
 *  (the far rim is fogged at oblique framing anyway). Texel size = 2·200/2048 = 0.195 m (was 0.137 at
 *  140) — still sub-block, so silhouettes stay sharp. The light standoff (offset length ≈ 366 m, near
 *  20 / far 700 below) brackets this box. If the radius default rises past 7, re-check span vs edge. */
const SHADOW_SPAN_M = 200
/** Sun shadow map resolution (square). */
const SHADOW_MAP_SIZE = 2048
/** World meters per shadow-map texel = (2·span)/mapSize. The box centre is FLOORED to this grid so
 *  the shadow silhouette samples the same texels frame-to-frame as the camera moves (kills the
 *  crawling/swimming edges you get from an unsnapped moving ortho box). The snap is done in the
 *  LIGHT-AZIMUTH basis (SHADOW_RIGHT/SHADOW_FWD below), not world X/Z — with a tilted sun a world-
 *  axis snap lands the box on a grid that is NOT aligned to the shadow map's texel rows, so the
 *  silhouette still crawls/jumps at each recenter (a "shadows visibly jump" artifact). */
const SHADOW_TEXEL_M = (2 * SHADOW_SPAN_M) / SHADOW_MAP_SIZE
/** Fixed sun DIRECTION, as the light's offset from its target. Preserves the original look direction
 *  (position 180,300,105 → origin) while letting the box centre move: position = centre + offset,
 *  target = centre, so the sun stays at the same angle no matter where the box recenters. */
const SHADOW_LIGHT_OFFSET = new Vector3(180, 300, 105)
/** LIGHT-AZIMUTH SNAP BASIS. The shadow silhouette on the ground plane crawls/jumps along the SUN'S
 *  AZIMUTH (its horizontal direction) as the ortho box moves — so the stable texel grid is aligned to
 *  that azimuth, NOT to world X/Z (a world-axis floor under a tilted sun leaves a sub-texel residual
 *  → swim/jump, a "shadows visibly jump" artifact). This is an ORTHONORMAL grid in the ground plane:
 *    L  = normalize(target−position) = normalize(−offset)  — full 3D sun direction
 *    SHADOW_FWD   = normalize(L.x, 0, L.z)   — along-azimuth, horizontal
 *    SHADOW_RIGHT = normalize(−L.z, 0, L.x)  — cross-azimuth, horizontal (= worldUp × SHADOW_FWD)
 *  Both are unit-length, horizontal (y=0), and perpendicular, so projecting the (y-pinned) box centre
 *  onto them, flooring each to the texel, and rebuilding x/z is an EXACT, stable snap (verified). The
 *  basis is constant because the sun direction is fixed. */
const SHADOW_LIGHT_DIR = SHADOW_LIGHT_OFFSET.clone().negate().normalize()
const SHADOW_FWD = new Vector3(SHADOW_LIGHT_DIR.x, 0, SHADOW_LIGHT_DIR.z).normalize()
const SHADOW_RIGHT = new Vector3(-SHADOW_LIGHT_DIR.z, 0, SHADOW_LIGHT_DIR.x).normalize()
/** Max shadow-map re-renders per second WHILE streaming (queue_depth>0): debounce so an arriving
 *  chunk no longer forces a full shadow re-render every frame (the "shadow pop per chunk" flicker).
 *  When streaming is idle the update applies immediately; a box recenter always applies immediately. */
const SHADOW_STREAM_DEBOUNCE_MS = 500
/** SUN-FOLLOW (shadows should follow the day-night cycle). With follow ON (default) the shading
 *  DirectionalLight + its shadow frustum track the sky's live `sun_direction` instead of the fixed afternoon
 *  angle above, so dawn casts long shadows, noon short, dusk long-again (correct side), and a below-horizon
 *  sun casts none. `?sunfollow=0` / `globalThis.__ARES_SUN_FOLLOW=0` restores the fixed angle.
 *  Standoff (m) of the light from the box centre = the legacy offset length, so `near`/`far` still bracket. */
const SUN_STANDOFF_M = SHADOW_LIGHT_OFFSET.length()
/** Re-aim + re-bake the shadow map only when the sun has swung ≥ this (rad ≈ 2°) since the last bake — paces
 *  the moving-sun re-renders to a few per minute (NEVER per-frame), composed with the box-recenter cadence
 *  above and the cloud-shadow drift re-bake (untouched). Between steps the cached map is reused. */
const SUN_FOLLOW_STEP_RAD = 0.035
/** Below this sun elevation (sun_direction.y) cast shadows have faded to ~0 (shadow.intensity, coupling) —
 *  freeze the shadow map + skip all re-bakes so a below-horizon sun never bakes upside-down night shadows. */
const SHADOW_MIN_SUN_Y = 0.04
/** Treat matching external tod publishes as clock confirmations, not new anchors. This 50 ms window absorbs
 * synchronous call-path latency without masking a deliberate GUI/QA time jump. */
const CELESTIAL_CLOCK_TOLERANCE_MS = 50
const CELESTIAL_ANCHOR_EPSILON = CELESTIAL_CLOCK_TOLERANCE_MS / CELESTIAL_CYCLE_MS
/**
 * The analytic sky color toward the horizon, as a three Color — the fog haze hue (survey S5(ii)).
 * Sampled from the sky node's JS twin (`sample_sky_rgb`) at a near-horizon, slightly-downward view
 * (the direction the fog band actually occupies) using the node's initial sun, so fog == sky at the
 * seam. Returned in linear space (three converts Fog.color sRGB→linear then AgX-tonemaps it, matching
 * the sky background which is tonemapped identically).
 * @param {import('../render/sky/sky_node.js').SkyNode} sky
 * @returns {Color}
 */
function sky_horizon_color(sky) {
  const sun = sky.sun_direction.value
  const rgb = sample_sky_rgb([0, -0.12, 1], [sun.x, sun.y, sun.z]) // slightly-down horizon-band view
  const c = new Color(clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]))
  // sample_sky_rgb returns LINEAR radiance; Fog.color is interpreted as sRGB then linearized by three.
  // Convert linear→sRGB here so the round-trip lands on the intended linear haze value.
  return c.convertLinearToSRGB()
}

/** @param {number} x @returns {number} clamp to [0,1] */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * Creates and initializes the three.js WebGPURenderer (or its WebGL2 fallback), plus a bare
 * scene + fly-style perspective camera. Async because `renderer.init()` is async (device
 * request happens here) — engine.js awaits this before starting the frame loop.
 * @param {RendererOptions} options
 * @returns {Promise<RendererHandle>}
 */
export async function create_renderer({
  canvas,
  fov = 70,
  near = 0.1,
  far = 20000,
  tier = 'high',
  seed = 'aresrpg', // world seed — drives the per-world night sky (night_sky.js: galaxy/planets/stars)
  on_device_lost,
  on_device_restore,
  hillaire_rebuild_on_rotate = true,
  on_hillaire_aerial,
}) {
  const requested_webgpu = has_webgpu_support()

  // DEVICE LIMITS (device-ACQUISITION parameters). three's WebGPUBackend requests the device inside init()
  // from parameters.requiredLimits, so we resolve every raised limit BEFORE construction: probe the adapter
  // up-front with the SAME adapterOptions three's backend uses (so we measure the very adapter it acquires),
  // then request min(adapter max, needed) for each. min() never over-requests (an over-request rejects
  // requestDevice and kills the boot); a genuine adapter shortfall degrades LOUDLY, never a silent crash.
  /** @type {Record<string, number> | undefined} */
  let required_limits
  // #158 DIAGNOSTIC UNLOCK: captured off the SAME probe_adapter request below (no extra requestAdapter
  // call) — GPUAdapterInfo's spec fields (vendor/architecture/device/description; three.js source's
  // gather_detect_signals in quality/detect.js reads the same shape). Logged once, post-init, alongside
  // the resolved backend + reversedDepthBuffer (see the console.info a few lines under `backend` below).
  /** @type {{vendor?: string, architecture?: string, device?: string, description?: string} | null} */
  let adapter_info = null
  if (requested_webgpu && typeof navigator !== 'undefined' && navigator.gpu) {
    const probe_adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
      featureLevel: 'compatibility',
    })
    if (probe_adapter) {
      adapter_info = {
        vendor: probe_adapter.info?.vendor,
        architecture: probe_adapter.info?.architecture,
        device: probe_adapter.info?.device,
        description: probe_adapter.info?.description,
      }
      const lim = probe_adapter.limits
      required_limits = {}

      // [S5 PERF_MOBILE_PLAN 2026-07-14] ADAPTER-FIT TIER: never boot a tier whose terrain pool cannot
      // BIND on this adapter — the old path logged the shortfall LOUDLY then hit the invalid bind group
      // anyway (the Safari page-crash / user-BSOD class). Step the tier down until the pool fits; a
      // spec-minimum adapter lands on 'low' and RENDERS. (The atlas already degrades this way below.)
      {
        const fits = (/** @type {import('./quality/tiers.js').TierName} */ t) =>
          max_pool_storage_bytes(t) <= lim.maxStorageBufferBindingSize
        const requested_tier = tier
        let i = TIER_ORDER.indexOf(tier)
        if (i !== -1) {
          while (i > 0 && !fits(TIER_ORDER[i])) i -= 1
          tier = TIER_ORDER[i]
        }
        if (tier !== requested_tier)
          console.warn(
            `[renderer] tier '${requested_tier}' terrain pool exceeds this adapter's storage-binding ` +
              `limit (${lim.maxStorageBufferBindingSize} B) — auto-fit to '${tier}'`
          )
      }

      // (1) TEXTURE-ARRAY LAYERS (block-texture atlas). The WebGPU/WebGL2 DEFAULT (and spec MINIMUM) is 256,
      // but the atlas bakes atlas_layer_count() layers (currently 357) into ONE DataArrayTexture — at the
      // default every terrain draw would throw GPUValidationError (depthOrArrayLayers > 256) and the world
      // renders BLACK. We request min(adapter max, MAX_ATLAS_LAYERS): the cap ties the limit to the build-time
      // ceiling (texture_baker.test.js) so the two can't drift. On a spec-MINIMUM adapter (mobile — max 256 <
      // the natural 357) we DON'T blind-allocate: pool_renderer.js passes this GRANTED limit to
      // bake_block_textures as `max_layers`, and fit_layer_plan bakes a REDUCED atlas that fits (every block
      // keeps its base recipe, sheds decorative variants) — graceful, never a black screen.
      const atlas_needed = atlas_layer_count()
      const layers_adapter_max = lim.maxTextureArrayLayers
      const layers_requested = Math.min(layers_adapter_max, MAX_ATLAS_LAYERS)
      required_limits.maxTextureArrayLayers = layers_requested
      if (layers_adapter_max < atlas_needed) {
        // LOUD but non-fatal: the atlas bakes REDUCED to fit this constrained adapter (mild per-cell tiling,
        // correct block textures). The exact reduced layer count is logged by pool_renderer after the bake.
        console.warn(
          `[renderer] GPU adapter caps texture-array layers at ${layers_adapter_max} (< the ${atlas_needed}-layer ` +
            `natural atlas) — baking a REDUCED atlas to fit (fewer per-cell variants; blocks still render).`
        )
      } else {
        console.log(
          `[renderer] block-texture atlas: ${atlas_needed} layers · device limit ${layers_requested} (adapter max ${layers_adapter_max})`
        )
      }

      // (2) STORAGE-BUFFER BINDING (the mega terrain quad pool, pool_renderer.js). The densest render
      // class's pool is ONE storage buffer of max_pool_storage_bytes(tier); at HIGH (r8 solid ≈138 MiB) it
      // EXCEEDS the WebGPU DEFAULT maxStorageBufferBindingSize (128 MiB) → the storage bind group is invalid
      // → GPUValidationError → the tab CRASHES on a dense HIGH boot (QA F2/B2). Raise the limit to fit the
      // pool, but NEVER below the spec default (so a buffer we did not audit never loses its default
      // headroom) and NEVER above the adapter (over-request rejects the boot). maxBufferSize is audited the
      // same way: the largest pool buffer (138 MiB) sits under ITS 256 MiB default, so the clamp keeps it at
      // the default today and auto-raises only if a future pool crosses 256 MiB.
      const pool_bytes = max_pool_storage_bytes(tier)
      const DEFAULT_STORAGE_BINDING_BYTES = 128 * 1024 * 1024 // WebGPU spec default (128 MiB)
      const DEFAULT_BUFFER_BYTES = 256 * 1024 * 1024 // WebGPU spec default (256 MiB)
      const storage_adapter_max = lim.maxStorageBufferBindingSize
      const buffer_adapter_max = lim.maxBufferSize
      required_limits.maxStorageBufferBindingSize = Math.min(
        storage_adapter_max,
        Math.max(pool_bytes, DEFAULT_STORAGE_BINDING_BYTES)
      )
      required_limits.maxBufferSize = Math.min(buffer_adapter_max, Math.max(pool_bytes, DEFAULT_BUFFER_BYTES))
      if (storage_adapter_max < pool_bytes) {
        // Honest, LOUD degradation — this adapter cannot bind the tier's pool buffer. Never a silent tab
        // crash: the named shortfall says exactly why and points at the fix (run a lower quality tier).
        console.error(
          `[renderer] GPU adapter caps maxStorageBufferBindingSize at ${storage_adapter_max} B, but the ` +
            `'${tier}' terrain pool needs a ${pool_bytes} B buffer — this tier will not fit on this device; ` +
            `use a lower quality tier (requested ${required_limits.maxStorageBufferBindingSize}).`
        )
      } else {
        console.log(
          `[renderer] terrain pool storage [tier ${tier}]: largest buffer ${pool_bytes} B · device limit ` +
            `${required_limits.maxStorageBufferBindingSize} (adapter max ${storage_adapter_max})`
        )
      }
    }
  }

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false, // tiers own AA via TAAU/TRAA/FSR1 (§5.1), not MSAA
    // Ask the OS for the discrete/high-perf GPU adapter (matters on dual-GPU laptops — the default
    // can pick the integrated GPU and halve throughput). No-op where only one adapter exists.
    powerPreference: 'high-performance',
    // reversedDepthBuffer is WebGPU-path-only (§2.1) — WebGL backend has open bugs (#31413).
    // We can't know the *actual* backend before construction (getFallback resolves lazily
    // inside init()), so we gate on the capability probe: if navigator.gpu is missing we were
    // always going to WebGL2, and reversedDepthBuffer must stay off.
    reversedDepthBuffer: requested_webgpu,
    // Raised device limits (maxTextureArrayLayers for the atlas, maxStorageBufferBindingSize/maxBufferSize
    // for the terrain pool) resolved above against the adapter's real ceilings. Undefined ⇒ three uses {}
    // (defaults) — correct for the WebGL2 fallback path, where these limits don't apply.
    requiredLimits: required_limits,
  })

  await renderer.init()

  // `isWebGPUBackend` is a runtime-only flag on the concrete WebGPUBackend class (three.js
  // source, three.webgpu.js) not surfaced on the public `Backend` type — cast narrowly here.
  const backend = /** @type {{isWebGPUBackend?: boolean}} */ (renderer.backend)?.isWebGPUBackend ? 'webgpu' : 'webgl2'

  // #158 CAPABILITY-DETECTION CORRECTION. `reversedDepthBuffer: requested_webgpu` above was requested
  // from the PRE-init navigator.gpu probe — but three's own fallback wiring (WebGPURenderer's
  // `getFallback`, invoked from Renderer.init() on ANY `WebGPUBackend.init()` throw: bad adapter,
  // requestDevice rejection, a driver that advertises navigator.gpu but can't actually stand up a
  // device) can still swap the ACTIVE backend to WebGL2 *inside* `renderer.init()` above, for reasons
  // the pre-init probe cannot predict. `renderer.reversedDepthBuffer` is a plain constructor-time flag
  // (Renderer.js) that three never resets on that fallback, so it can be left `true` on a backend that
  // actually resolved to WebGL2 — exactly the case this file's header warns about ("the WebGL backend
  // has open reversed-Z bugs, three.js #31413 — reversedDepthBuffer must stay off"). Left stale, EVERY
  // reversed-Z-branching depth read (perspectiveDepthToViewZ's `builder.renderer.reversedDepthBuffer`
  // branch; PassNode.setup()'s own depth-texture format pick, PassNode.js:770) silently uses the wrong
  // convention — not a thrown error, just wrong numbers — which is how the fight-VFX overlay's depth-
  // fade mask (vfx_overlay_pass.js) can collapse to 0 (particles invisible) on a machine that requested
  // WebGPU but actually renders on WebGL2. Correct the flag to the ACTUAL resolved backend the same way
  // `backend` itself is computed above — before anything downstream (water, the vfx overlay, any future
  // PassNode) reads it.
  if (backend !== 'webgpu') renderer.reversedDepthBuffer = false

  // #158 DIAGNOSTIC UNLOCK (owner: still-zero VFX post-.42, never supplied F12 adapter info — make the
  // answer AUTOMATIC). ONE always-on boot line naming the adapter identity the engine actually got, the
  // RESOLVED backend, and the FINAL (post-correction, above) reversedDepthBuffer state — the exact three
  // facts a human would otherwise have to dig out of F12 by hand. Same boot-line idiom as the atlas /
  // terrain-pool lines in this function; every future console screenshot carries the backend answer.
  const adapter_identity = adapter_info
    ? `${adapter_info.vendor || 'unknown-vendor'}/${adapter_info.architecture || 'unknown-arch'}` +
      (adapter_info.description ? ` "${adapter_info.description}"` : '') +
      (adapter_info.device ? ` (device ${adapter_info.device})` : '')
    : 'no GPUAdapter (WebGPU unavailable or requestAdapter() failed)'
  console.info(
    `[renderer] adapter: ${adapter_identity} · backend=${backend} · reversedDepthBuffer=${renderer.reversedDepthBuffer}`
  )

  // RUNTIME PROVENANCE (QA F2/B2). Log the storage-binding limit the device ACTUALLY got vs the largest
  // terrain pool buffer it must bind — a headless HIGH boot asserts granted ≥ needed on this line, and any
  // shortfall (adapter genuinely below the pool) is LOUD, never a silent crash. `backend.device` is the
  // concrete GPUDevice on the WebGPU path (three r0.185 WebGPUBackend.init sets `this.device`).
  if (backend === 'webgpu') {
    const device = /** @type {{device?: {limits?: {maxStorageBufferBindingSize?: number}}}} */ (renderer.backend)
      ?.device
    const granted = device?.limits?.maxStorageBufferBindingSize
    const needed = max_pool_storage_bytes(tier)
    if (typeof granted === 'number') {
      const line = `[renderer] storage-binding GRANTED=${granted} B · pool needs ${needed} B · tier ${tier} · ${granted >= needed ? 'OK' : 'SHORTFALL'}`
      if (granted >= needed) console.log(line)
      else console.error(line)
    }
  }

  // WATER DEPTH-GRAB FORMAT (NG2-ATMO integration): under the post stack the scene renders into a
  // PassNode whose depth is FloatType/depth32float on the reversed-Z WebGPU path (PassNode.js:770) —
  // align the water material's viewport-depth grab texture so the per-frame depth copy validates
  // (default depth24plus mismatches → one WebGPU error per frame). WebGL2 keeps the default.
  if (backend === 'webgpu') set_water_depth_texture_type(FloatType)

  // dpr policy — TIER-capped (low:1 ⇒ 4× fewer pixels on a Retina/mobile screen — the fill-rate lever),
  // applied ONCE here BEFORE any pipeline compiles. The 07-11 incident law stands: never realloc the
  // swapchain mid-compile — so the mobile win comes from the boot BASELINE, not live mid-stream
  // downscaling (that needs the C-wave compile-quiescence handshake). `dpr_max` lives in tiers.js
  // (SSOT); a tier without the field keeps the legacy cap 2. This is the single source of truth for
  // pixel ratio; nothing else (demo, resize handler, device-loss) may touch canvas.width/height.
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, QUALITY_TIERS[tier]?.dpr_max ?? 2))

  // Soft shadows (§5.1). PCFSoft gives filtered penumbra edges instead of hard aliased ones; the
  // single sun below owns the one shadow map (M3's CSM replaces this). Must be enabled before the
  // first render so the pipeline compiles the shadow sampler in.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap

  const scene = new Scene()

  // TONE MAPPING (§5.1 look-dev). AgX gives filmic highlight roll-off + gentle desaturation so the
  // lit grass reads vibrant without the sun-facing tops blowing to white; exposure nudged >1 to keep
  // midtones bright under AgX's darker response. Applied on the color output, sky included.
  renderer.toneMapping = AgXToneMapping
  renderer.toneMappingExposure = 1.1

  // Baseline scene lighting (§5.1 hemisphere / §6.1 day-night placeholder until M3 WS5 lands the
  // real sky + CSM). terrain_material.js uses a LIT PBR node material — with ZERO Light objects in
  // the scene, PBR resolves every fragment to black regardless of the voxel colorNode. One key
  // directional (now shadow-casting) + a hemisphere fill make the island read with real form; M3
  // replaces all of this with the day/night rig.
  //
  // SUN + SHADOWS. The directional light casts a single tight ortho shadow map centered on the
  // origin (the demo island / camera spawn). AgX + shadows darken everything a touch, so the sun is
  // a hair brighter than the pre-shadow value and the hemisphere fill is lifted to keep shaded
  // faces (grass risers, north sides) from crushing. positionNode terrain displaces identically in
  // three's shadow depth pass — Renderer.js copies the object material's `positionNode` onto the
  // shadow override material (verified on screen: shadows follow terraces, not unit quads).
  const sun = new DirectionalLight(0xfff2dd, 3.0)
  // Direction (0.6,1.0,0.35) scaled out so the ortho shadow frustum sits above the terrain and looks
  // back down through it. The shadow box FOLLOWS THE CAMERA (sync_shadow below, W11 T1) — position
  // + target are recentered per camera-chunk crossing, so this initial (origin-centred) placement is
  // just the pre-first-frame default until sync_shadow runs.
  sun.position.set(SHADOW_LIGHT_OFFSET.x, SHADOW_LIGHT_OFFSET.y, SHADOW_LIGHT_OFFSET.z)
  sun.castShadow = true
  // Ortho half-extent ±SHADOW_SPAN_M each side wraps the streamed ring; near/far bracket the light's
  // standoff. 2048² keeps terrace edges crisp at this coverage. normalBias fights acne on the greedy
  // quads (large flat faces, DoubleSide).
  sun.shadow.camera.left = -SHADOW_SPAN_M
  sun.shadow.camera.right = SHADOW_SPAN_M
  sun.shadow.camera.top = SHADOW_SPAN_M
  sun.shadow.camera.bottom = -SHADOW_SPAN_M
  // near/far bracket the light's standoff to the ±SHADOW_SPAN_M box (the terrain band inside it). The
  // box grew to ±200 m (D33), whose nearest corner now projects to ~25 m along the light axis — so
  // near drops 50→20 (a corner between 25 and 50 m would otherwise be clipped OUT of the shadow
  // frustum → missing near shadows). far 700 still clears the farthest corner (~521 m). Verified.
  sun.shadow.camera.near = 20
  sun.shadow.camera.far = 700
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
  sun.shadow.normalBias = 0.6
  sun.shadow.bias = -0.0002
  // SHADOW-MAP CACHING (W11 T2). The sun is static and terrain is static, so the shadow map must NOT
  // re-render every frame. In the WebGPU/node renderer the per-frame shadow-render gate is on the
  // LIGHT'S shadow object (three r0.185 src/nodes/lighting/ShadowNode.js:855 reads
  // `shadow.needsUpdate || shadow.autoUpdate`; there is NO renderer.shadowMap.autoUpdate — that
  // object is only {enabled,transmitted,type}, src/renderers/common/Renderer.js:703). So we disable
  // per-frame auto-update here and set `needsUpdate = true` from sync_shadow ONLY when the box
  // recentered or terrain changed. `needsUpdate` self-clears after one render (ShadowNode.js:873).
  sun.shadow.autoUpdate = false
  sun.shadow.needsUpdate = true // render once on the first frame
  scene.add(sun)
  scene.add(sun.target) // target follows the camera in sync_shadow; add so its matrix updates

  // WARM BACK-FILL (readability, W11 T-shading). CHOSEN over a hemisphere-intensity bump because it
  // targets the exact geometric cause of the "black bands / void trunks": faces pointing AWAY from
  // the single directional sun get zero direct light, so they render on cold hemisphere indirect
  // alone and AgX crushes them to black. This second directional aims from ROUGHLY OPPOSITE the sun
  // (−x/−z and below) with NO shadow and low intensity, so it deposits a little DIRECTIONAL light
  // precisely on the −x/−z faces the sun misses — turning "void" into readable shade WITHOUT
  // flattening (it has its own N·L falloff, so sun-facing +x/+z sides still read brighter). Its
  // direction (position→origin ≈ (150,−90,120), normalised y≈−0.43) points slightly DOWN, so on the
  // ±y grass TOPS N·L is negative → clamped to zero: tops receive NONE of this fill, only the ±x/±z
  // and −y faces do. Warm-tinted (not the sky's blue) so shaded sides read as warm shade and the
  // previous icy-cyan wash on the risers is neutralised. Measured: sunlit-top luminance byte-identical
  // before/after; trunk-band pure-black pixel fraction 4.9% → 0.06% (see /tmp shading_* proof shots).
  // Intensity LIFTED 0.85→1.35 as the second half of the riser-de-sky fix (with the de-cyaned
  // hemisphere below): deep terrace risers sit in heavy AO with a near-zero sun byte, so even the
  // warmed hemisphere left them faintly blue-dominant (measured (114,130,144), b>r). This warm
  // directional deposits real N·L on exactly the −x/−z shaded faces, pushing them warm-neutral
  // (un-sky) — and its downward tilt (y≈−0.43) keeps N·L≤0 on the ±y grass TOPS, so tops receive NONE
  // of it and their measured luma is unchanged (the W15 "tops byte-identical" budget is preserved).
  const back_fill = new DirectionalLight(0xffd6a8, 1.35)
  back_fill.position.set(-150, 90, -120) // opposite-ish the sun (180,300,105), tilted down — grazes shaded sides only
  scene.add(back_fill)
  scene.add(back_fill.target) // target defaults to origin; direction is position→origin, that's all we need

  // Hemisphere fill (§5.1). SKY STOP DE-CYANED AT MATCHED LUMINANCE — the decisive lever for the
  // "sky-holes along terrace contours" defect. Terrace RISERS (−x/−z/+z faces the sun can't reach)
  // survive on hemisphere indirect alone, and the old cyan sky stop 0x9fb2c8=(159,178,200) drove them
  // to ~(150,170,186) — within ΔE 25 of the actual sky/fog, so risers RENDERED sky-blue and read as
  // holes (measured: a low-fly hole gate counted ~10k such pixels/frame; the sand biome made the cyan
  // risers glaring). The back-fill directional above only grazes faces aimed at its own direction, so
  // many risers stayed cyan — the general cure is to remove the BLUE from the ambient itself. New sky
  // stop 0xbcb2a0=(188,178,160) is a pale WARM grey (blue is now the LOW channel, not the high one)
  // with Rec709 luma 177.5 ≈ the old 175.5 (Δ1.1%, inside the ±2% "tops byte-identical" budget since
  // tops are sun-dominated), so ambient-only risers can no longer go blue-dominant from the hemisphere
  // at ANY orientation — the 50/50 sky/ground side blend lands unambiguously warm. Ground stop warmed/
  // lifted 0x8a7355 to 0x977f56 so shaded sides read as warm earth-shade, never cold grey.
  const hemi = new HemisphereLight(0xbcb2a0, 0x977f56, 0.9)
  scene.add(hemi)

  // ── SKY→TERRAIN LIGHT COUPLING (the "2 different engines in one render" fix) ──────────────────────
  // The three lights above ARE the terrain's sun + ambient (stock PhysicalLightingModel reads them).
  // Left FIXED they never followed the physical sky — a proper physical sky drove terrain
  // lighting that was never actually connected. couple_lighting (render/lighting/sky_light_coupling.js)
  // recolours them per tod-change off the SAME atmosphere the Hillaire sky uses: SUN = transmittance-
  // filtered (reddens + dims toward dusk, 0 in the planet shadow), AMBIENT = a low-order sky irradiance
  // (physical luminance + a de-cyan-safe warm/cool tint, never the raw blue dome that would re-cyan the
  // risers). NOON is the fixed point ⇒ the tuned look is byte-preserved; only dawn/dusk/night vary.
  // Cheap CPU (no readback, no RT) so it runs at EVERY tier. Escape: ?skycouple=0 or
  // globalThis.__ARES_SKY_COUPLE=0 keeps the legacy fixed-colour lights + the [D184] night-dim ramp.
  const sky_couple_off =
    (typeof globalThis !== 'undefined' &&
      /** @type {any} */ (
        globalThis.__ARES_SKY_COUPLE === 0 || /** @type {any} */ (globalThis).__ARES_SKY_COUPLE === false
      )) ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).get('skycouple') === '0')
  const sky_couple_on = !sky_couple_off
  // SUN-FOLLOW escape (mirrors the sky-couple hatch): ?sunfollow=0 or globalThis.__ARES_SUN_FOLLOW=0 pins the
  // shading sun + shadow frustum at the fixed afternoon angle (the pre-follow behaviour, byte-identical).
  const _g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : {})
  const sun_follow_off =
    _g.__ARES_SUN_FOLLOW === 0 ||
    _g.__ARES_SUN_FOLLOW === false ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).get('sunfollow') === '0')
  const sun_follow_on = !sun_follow_off
  // Capture the tuned baseline ONCE (linear working-space rgb) — the single source the coupling
  // scales, so noon reproduces these exactly and the OFF path is byte-identical to the pre-coupling ramp.
  const light_baseline = {
    sun_color: [sun.color.r, sun.color.g, sun.color.b],
    sun_intensity: sun.intensity,
    fill_color: [back_fill.color.r, back_fill.color.g, back_fill.color.b],
    fill_intensity: back_fill.intensity,
    hemi_sky: [hemi.color.r, hemi.color.g, hemi.color.b],
    hemi_ground: [hemi.groundColor.r, hemi.groundColor.g, hemi.groundColor.b],
    hemi_intensity: hemi.intensity,
  }
  if (typeof window !== 'undefined') /** @type {any} */ (window).__sky_couple = { on: sky_couple_on }

  // AERIAL HAZE + ANALYTIC SKY (NG-LOD phase B — the near-ring fog WALL dies here). Two scene pieces:
  //
  // (1) DISTANCE FOG — the atmospheric depth cue that dissolves BOTH the near terrain AND the far
  //     shell (far_field.js) into the horizon haze. three auto-converts THREE.Fog → a range-fog TSL
  //     node (NodeManager.getFogNode) applied to every fogged NodeMaterial (near terrain + far shell);
  //     the sky background is drawn fog-disabled so the horizon dissolves terrain→haze→sky, not a wall.
  //     NG-LOD extends the handoff (quadtree.js phase-B spec §2): fog FAR is pushed OUT to the far-shell
  //     boundary via set_far_fog() (engine.js feeds it the far streamer's reach) — replacing the old
  //     ~168 m near-ring fog wall, which pinned fog far just ahead of the streamed near edge. With the
  //     far shell rendering to the horizon, fog now blends near detail → far shell over a wide band and
  //     far shell → sky at the very edge, so km-scale terrain reads instead of a grey wall (the old
  //     "mostly fog / no infinite LOD" complaint). FOG COLOR is the analytic sky sampled toward
  //     the horizon (survey S5(ii)) so haze == sky hue at the seam; both go through AgX identically.
  const sky = create_sky_node({ seed })
  // [D171] analytic height-fog constants — the cinematic depth mood, tuned to this world's relief
  // (valleys ~150-175, ridges 190+): haze pools below ~BASE_Y+H and thins exponentially above.
  const HEIGHT_FOG = {
    BASE_Y: 150, // world-Y where the haze is densest (valley floors)
    FALLOFF: 1 / 26, // 1/H — 26 m scale height: ridge tops rise clear of the pool
    // [D175] Initial tuning was verified only from the 240 m vista distance; at walk/eye height the
    // near-horizontal integral saturates to σ·d, producing excessive haze by 200 m. 0.0009 ⇒
    // eye-level: ~25% veil at 400 m, ~50% at 900 m (depth, not blindness); the vista pooling look
    // survives because downward rays still integrate the dense valley layer.
    DENSITY: 0.0013, // [D175-B/S-27] slightly thinner: reduces the blue haze wash on distant terrain; terrain stays clearer further
    MAX: 0.46, // [D180/S-27] lower ceiling — distant peaks read crisp (his Minecraft ref), never a colour-wash
  }
  const FOG_NEAR = 460 // m — [D180/S-27 'super blue decayed'] the range veil starts further: mid-distance keeps full saturation
  const FOG_FAR = 900 // m — provisional; set_far_fog() pushes this to the far-shell boundary once known
  const fog_color = sky_horizon_color(sky)
  // [D171 (2026-07-05): the froxel-based volumetric fog lost the cinematic haze look and produced visible
  // arcs; the volumetric lane is RETIRED for open air (three failed tuning passes — architecture verdict, kept only as future cave-shaft
  // machinery behind its default-off flag). The mood returns ANALYTICALLY: a closed-form exponential
  // HEIGHT fog (iq's integral — depth haze pooling in valleys, ridges rising clear) + the existing far
  // RANGE veil, as scene.fogNode. No slices, no temporal state ⇒ banding/arcs are impossible by
  // construction; cost ~zero (a handful of ALU in the fog mix every fog-enabled material already pays).
  const u_fog_rgb = uniform(new Color(fog_color.getHex()))
  const u_fog_scale = uniform(1)
  const u_fog_near = uniform(FOG_NEAR)
  const u_fog_far = uniform(FOG_FAR)
  {
    const rd = positionWorld.sub(cameraPosition)
    const dist = length(rd)
    // vertical slope of the view ray (the analytic integral's denominator)
    const rdy_raw = rd.y.div(max(dist, float(1e-3)))
    // [D175-B] a visible discontinuity line appeared at a specific view angle; the integral has a REMOVABLE
    // singularity at rdy=0 (limit = σ(camY)·d); a hard eps-clamp made it a visible DISCONTINUITY line at
    // the horizon (f(+eps) ≠ f(−eps)). Blend to the analytic limit inside the near-horizontal band.
    const rdy = sign(rdy_raw).mul(max(abs(rdy_raw), float(0.02)))
    const B = float(HEIGHT_FOG.FALLOFF)
    const cam_falloff = exp(cameraPosition.y.sub(float(HEIGHT_FOG.BASE_Y)).mul(B).negate())
    const amount_slope = float(HEIGHT_FOG.DENSITY)
      .div(B)
      .mul(cam_falloff)
      .mul(float(1).sub(exp(dist.mul(rdy).mul(B).negate())))
      .div(rdy)
    const amount_limit = float(HEIGHT_FOG.DENSITY).mul(cam_falloff).mul(dist) // the rdy→0 limit
    const amount = mix(amount_limit, amount_slope, smoothstep(float(0.015), float(0.05), abs(rdy_raw)))
    // never fog the first meters (close detail stays crisp), never white out (view floor cap)
    const height_f = float(1)
      .sub(exp(amount.negate()))
      .mul(smoothstep(float(10), float(45), dist))
      .min(float(HEIGHT_FOG.MAX))
    const range_s = smoothstep(u_fog_near, u_fog_far, dist) // raw distance ramp 0..1 (the range-veil source, pre-cap)
    // [S-27-DEPTH 2026-07-11 — owner, 2nd escalation: open vistas WHITE OUT / far reads as "soup".] Cap the
    // range veil below full opacity so the farthest terrain always keeps ~15% of its own silhouette: depth
    // now reads as blue DISTANCE, not an opaque wall. The sky background is fog-disabled, so this touches
    // only terrain + the far shell — their ridgelines survive into the haze (his crisp-far-peaks Minecraft ref).
    const range_f = range_s.mul(float(0.85)) // RANGE_MAX — veil ceiling (was an implicit 1.0 ⇒ full white-out beyond FAR)
    const fog_amt = max(height_f, range_f) // total haze opacity (height pool ∪ range veil) — the fogNode blend factor
    const sky_luma = /** @type {*} */ (u_fog_rgb).dot(vec3(0.2126, 0.7152, 0.0722)) // horizon brightness (Rec709, linear)
    const day_f = smoothstep(float(0.09), float(0.22), sky_luma) // 0 below the night horizon luma (~0.057) → tilt = identity → night untouched
    // DEEP-BLUE TILT (tier-independent, replaces the HIGH-only ternary): a DARKENING multiply — R/G cut, B
    // UN-boosted (≤1). The old tilt BOOSTED blue (×1.06) keeping the haze BRIGHT → the far vista read as a
    // pale wash = a "white soup" look. Ground truth (2026-07-11 captures): the rejected bright tilt
    // measured B−R +28 at the far band yet still read washed — BRIGHTNESS, not hue, is the soup. Darkening
    // (R/G<1, B=1) drops the far-haze luma ~15% while keeping blue dominant ⇒ DEEP cinematic blue, not pale.
    // day_f fades the tilt to identity at a dark horizon, so night is byte-untouched (the multiply barely
    // moved a near-black horizon anyway). fog_amt-gated by the fogNode ⇒ un-fogged near blocks stay TRUE;
    // only the haze darkens to blue. [This deliberately overrides the MEDIUM byte-freeze — the bright tilt WAS the
    // bug.] LIMIT: the mid-distance shoulder is far_field.js's own sky-tint fade (HAZE_TINT, out of fence),
    // where fog_amt is thin — the fogNode cannot fully deepen it (flagged as a known limit).
    const day_tilt = /** @type {*} */ (mix)(
      vec3(1, 1, 1),
      vec3(FOG_COOL_TILT[0], FOG_COOL_TILT[1], FOG_COOL_TILT[2]),
      day_f
    ) // darken toward deep blue, daylight only (FOG_COOL_TILT — shared w/ the physical aerial)
    const cool_rgb = /** @type {*} */ (u_fog_rgb).mul(day_tilt)
    const fwd = rd
      .div(max(dist, float(1e-3)))
      .dot(sky.sun_direction)
      .clamp(0, 1)
    const haze_rgb = /** @type {*} */ (mix)(cool_rgb, vec3(1.0, 0.88, 0.66), fwd.pow(3).mul(0.5))
    // [D213-B the cave wash root]: height_f and range_f combine via MAX, so set_far_fog could never
    // gate the HEIGHT term — at cave depth (camera far below BASE_Y, rays near-horizontal) height_f
    // saturates into a pale wash immune to the range knob, tinted by the sky (sun-independent — the
    // exact night-surviving signature). u_fog_scale is the master gate: enclosed scenes set 0 (their
    // mood is the dark BFS + shafts); the overworld default 1 is byte-identical to before.
    scene.fogNode = /** @type {*} */ (fog(haze_rgb, fog_amt.mul(u_fog_scale)))
  }
  //
  // (2) ANALYTIC SKY BACKGROUND (sky_node.js — shelf-ready, tested; NG2 finishes clouds). Replaces the
  //     old flat 2-stop gradient: a humid luminous horizon (never a black void below it), a mie-boosted
  //     warm sun halo, and a readability-oversized sun disc, all from ONE analytic function that the
  //     fog color above samples too — so far shell, fog, and sky share one palette and cannot drift.
  scene.backgroundNode = sky.background_node

  const camera = new PerspectiveCamera(fov, aspect_of(canvas), near, far)
  camera.position.set(0, 0, 0)

  // SINGLE-OWNER RESIZE (§2.1). The renderer owns every resize: `renderer.setSize(..., false)`
  // reallocates BOTH the swapchain color attachment AND three's internal depth texture in lock-
  // step, keeping them the same dimensions. Mutating canvas.width/height directly (the old demo
  // bug) resized only the swapchain — leaving the depth texture stale → color≠depth attachment
  // sizes → invalid render pass → black screen. Every setSize in this module routes through here.
  function apply_size() {
    const width = canvas.clientWidth || canvas.width || 1
    const height = canvas.clientHeight || canvas.height || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  apply_size()

  // Observe the canvas itself (its client box tracks the CSS layout box, which is what
  // apply_size() reads). Fires once synchronously on observe, so first paint is sized too.
  const resize_observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => apply_size()) : null
  resize_observer?.observe(canvas)

  const handle_device_lost = build_device_lost_handler({
    renderer,
    apply_size,
    on_device_lost,
    on_device_restore,
  })
  renderer.onDeviceLost = handle_device_lost

  // ── NG2-ATMO: volumetric clouds + froxel fog + god rays + grade (render/atmosphere.js SPEC A-L) ──
  // The atmosphere composes off the SAME analytic sky node (sun_direction shared, cloud/fog lighting
  // derives from the sky tint) and the post stack replaces the bare renderer.render with ONE
  // RenderPipeline graph: scene pass → clouds → froxels → god rays → AgX → low-freq grade. Tier
  // gates the budgets (atmo.features): low pays nothing beyond the scene pass + grade.
  // ── ARCHITECT RESILIENCE LAW (2026-07-03, after the post chain killed the boot TWICE): the
  // atmosphere/post stack is an ENHANCEMENT — its construction failure must NEVER kill the engine.
  // If any part of the chain throws during construction/bake, we log loudly and degrade to the bare
  // `renderer.render` path (terrain + sky still fully playable). The atmosphere lane re-lands its
  // chain pass-by-pass against a LIVE boot, per the incremental-landing protocol.
  /** @type {ReturnType<typeof create_atmosphere> | null} */
  let atmo = null
  // [C9] Hillaire physical sky/atmosphere — the DEFAULT at MEDIUM/HIGH (assigned below). SWITCHES which node
  // feeds scene.backgroundNode / scene.fogNode; the analytic paths above stay as the LOW-tier ladder rung.
  /** @type {ReturnType<typeof create_hillaire_sky> | null} */
  let hillaire = null
  /** @type {ReturnType<typeof create_post_stack> | null} */
  let post = null
  let motion_blur = /** @type {ReturnType<typeof create_camera_rotation_blur> | undefined} */ (undefined) // [D251-2] hoisted so the handle's toggle can reach it
  /** @type {import('../render/lighting/underwater.js').UnderwaterPass | null} */
  let underwater = null
  try {
    // [2026-07-05 PLAN A] height_at feeds the froxel fog's camera-following HEIGHT FIELD (fog_height.js)
    // — the SMOOTH open-air sun-occlusion + real ground for the fog's height falloff (the static-arc fix;
    // world_surface_y is the same gen the terrain/far shell draw, so fog shadows match the world).
    atmo = create_atmosphere({ tier, sky, sun, height_at: world_surface_y })
    // ENG-8 CAMERA MOTION BLUR — REMOVED FROM THE MOUNT (2026-07-05, owner release session). Its
    // 12-sample reprojection smear under ROTATION paints tangential arc streaks around the rotation
    // center — a "huge white circle static texture" artifact (concentric rings of ghost scene copies,
    // one per sample; worst at 5K where the uv deltas span more pixels). Every pinned-camera probe
    // missed it because a static camera has zero frame delta — the artifact only exists while the
    // view MOVES (verify-the-pixels law addendum: verify post effects with a MOVING camera).
    // ENG-13 UNDERWATER — constructed at EVERY atmosphere tier (low included: it renders tint/fog
    // only, its warp amplitude gated to 0 by the tier — so a SINGLE graph serves all tiers). The engine
    // frame loop pushes the submerged state via update_underwater() (it owns the resident chunk store).
    underwater = create_underwater_pass({ tier })
    // [D214] Camera-rotation motion blur — smooths the view during fast camera rotation. Implemented via the
    // ENG-8 output_effect hook realized for the CAMERA-ONLY case (no motion vectors needed). One
    // full-internal-res rtt + 6 taps; tier-gated to HIGH; magnitude gates to zero at rest
    // (still frames byte-identical). ?blur=0 kill switch for bisection (one flag, one system).
    const blur_off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('blur') === '0'
    motion_blur = tier === 'high' && !blur_off ? create_camera_rotation_blur() : undefined
    // BENCH HOOK (§7, same spirit as window.__godrays/__sharpen): expose the live handle so a bench/QA
    // probe can read u_mag.value directly instead of diffing pixels. No-op cost (a reference copy).
    if (typeof window !== 'undefined') /** @type {any} */ (window).__motion_blur = motion_blur
    // ── S-43 release-visual prototypes — DEFAULT OFF, flag-gated (brand law: __ARES_* globals set by the
    // bench via addInitScript, with a ?taau=1 / ?godrays=1 URL convenience). These are graded behind
    // the flag; NO default is flipped here. taau_scale: a numeric flag in (0,1] is the scene render-scale,
    // a bare truthy uses 0.66 (a clear, measurable downscale taau() upscales back). godrays_on: mount the
    // shadow-volume shafts on the sun.
    const ares_flag = (/** @type {string} */ name, /** @type {string} */ param) => {
      const g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : {})[`__ARES_${name}`]
      if (g !== undefined && g !== 0 && g !== false && g !== '0') return g
      return typeof location !== 'undefined' && new URLSearchParams(location.search).get(param) === '1' ? 1 : null
    }
    const taau_flag = ares_flag('TAAU', 'taau')
    // A fractional flag in (0,1) is an explicit scene render-scale; anything else truthy (incl. the common
    // `=1`) means "on at the default 0.66". (Bugfix: `=1` must NOT map to scale 1.0 = no downscale.)
    let taau_scale =
      taau_flag == null ? null : typeof taau_flag === 'number' && taau_flag > 0 && taau_flag < 1 ? taau_flag : 0.66
    // S-43 SHARPEN (default OFF): FSR1 RCAS to recover the detail the taau_scale bilinear upscale softens.
    // A fractional flag in (0,2) sets three's `sharpness` (0=max, 2=none); anything else truthy ⇒ 0.4.
    const sharpen_flag = ares_flag('SHARPEN', 'sharpen')
    let sharpen_amount =
      sharpen_flag == null
        ? null
        : typeof sharpen_flag === 'number' && sharpen_flag > 0 && sharpen_flag < 2
          ? sharpen_flag
          : 0.4
    // THE MEDIUM RECIPE — NOW THE BASE-GAME DEFAULT: the taau medium recipe merged into the base
    // game. MEDIUM renders the SCENE pass at 0.66 + RCAS sharpen (the buildable Fortnite-lite path; real
    // temporal reconstruction stays varying-blocked). The half-res bloom + the governor floor are already
    // medium defaults, so this completes medium's perf recipe. MEDIUM tier ONLY (high/low untouched — this
    // block is tier-gated, mirroring the is_medium_tier half-res-bloom branch in post_stack.js).
    // ESCAPE to native medium: ?taau_medium=0 (or the global __ARES_TAAU_MEDIUM=0). NOTE: this is a BOOT-tier
    // bake (baked into the post-stack at construction, like half-res bloom / motion blur / grass sway) — a
    // live no-reload set_tier only re-applies render_scale (setPixelRatio), NOT the scene-pass scale/sharpen,
    // so switching TO medium in-session arms this on the next reload. AXES: the 0.66 is the SCENE pass only
    // (post/UI stay full-res); the governor's setPixelRatio dip (floor 0.72) is a SEPARATE whole-swapchain
    // axis — worst-case they compose on the beauty only (0.66 × 0.72) under sustained fill load, never on post/UI.
    const taau_medium_g = /** @type {any} */ (typeof globalThis !== 'undefined' ? globalThis : {}).__ARES_TAAU_MEDIUM
    const taau_medium_off =
      taau_medium_g === 0 ||
      taau_medium_g === false ||
      taau_medium_g === '0' ||
      (typeof location !== 'undefined' && new URLSearchParams(location.search).get('taau_medium') === '0')
    if (tier === 'medium' && !taau_medium_off) {
      if (taau_scale == null) taau_scale = 0.66 // an explicit ?taau=<frac> override still wins
      if (sharpen_amount == null) sharpen_amount = 0.4
    }
    // Real temporal resolve (velocity + jitter). BLOCKED on this engine's varying-heavy materials
    // (velocity's positionPrevious varying pushes them past the 16 WebGPU inter-stage limit) — kept as an
    // explicit opt-in for a future material varying-diet, never the default TAAU path.
    const taau_temporal = ares_flag('TAAU_TEMPORAL', 'taau_temporal') != null
    // [S-85 ULTRA → REVERTED 2026-07-11, owner #71/#73/#74] god-rays stay DEFAULT-OFF (flag-gated) at every
    // tier. The S-85 experiment flipped them ON at HIGH, but the in-tree GodraysNode in-scatters ADDITIVELY
    // camera→depth with NO per-pixel occlusion: on any LEVEL/UP framing in open sun every lit ray saturates to
    // maxDensity and the additive shaft (≈maxDensity·sun_radiance·GODRAYS_GAIN ≈ +0.30 linear) washes the whole
    // NEAR/MID field to a milky-white veil — looking up instantly turned everything white, not realistic
    // + the under-canopy "bright void" (canopy gaps = sky-facing rays through the same term). The pitch/sun GAIN
    // (godray_gain.js → u_godray_gain) only fades DOWNWARD framings, so looking DOWN was clean while level/up
    // stayed washed — a purely PITCH-keyed flood (A/B-proven: mid-band luma 161 on vs 88 off at level, 46=46 at
    // pitch −0.7). Gating OFF restores the clean committed look at ALL pitches; the endorsed blue distance haze
    // (sky/far-shell aerial perspective) is untouched. The proper always-on shaft system is froxels.js
    // (DEFAULT-OFF, real occlusion) — the queued lighting-overhaul lane's job, NOT a default flip here.
    // ?godrays=1 / __ARES_GODRAYS still force it ON at any tier for bench isolation (?godrays=0 ⇒ off too).
    const godrays_on = ares_flag('GODRAYS', 'godrays') != null
    // GodraysNode.setup() reads sun.shadow.map.depthTexture — allocated only once a shadow CASTER first
    // renders, which is AFTER this boot (terrain streams in later, and the scene is empty here). So
    // godrays mounts LAZILY: post.try_mount_godrays() (called each frame in render_frame) rebuilds the
    // output graph the moment the map exists. No forced pre-render — an empty scene never allocates it.
    post = create_post_stack({
      renderer,
      scene,
      camera,
      sun,
      atmo,
      underwater,
      output_effect: motion_blur,
      taau_scale,
      taau_temporal,
      sharpen_amount,
      godrays_light: godrays_on ? sun : null,
      // [TASTE 2026-07-11] READ-ONLY fog range for the godray far-haze falloff (post_stack): the SAME
      // u_fog_near/u_fog_far the frozen scene.fogNode uses, so the additive godray wash yields to the
      // deep-blue haze in the far field with one source of truth. The fog node itself is NOT touched.
      fog_range: { near: u_fog_near, far: u_fog_far },
      // HALF-RES POST gate: the bloom pyramid drops to a lower internal resolution on MEDIUM only.
      tier,
    })
    // bake the cloud noise volumes + particle seeds once (compute passes; awaited so the first frame
    // never samples an empty 3D texture).
    await atmo.bake(renderer)
  } catch (error) {
    atmo = null
    post = null
    underwater = null
    // VFXMOB (iPhone/WebGPU/Low: VFX barely visible on mobile) — the bare render_frame()
    // fallback below has NO overlay pass, so the camera's default layer-0-only mask would otherwise make
    // every fight-cast VFX (routed to FIGHT_VFX_LAYER) silently invisible on top of the degraded post stack.
    // Widen the mask now so combat VFX stay visible (pre-overlay colour) instead of vanishing outright.
    enable_fight_vfx_layer(camera)

    // WARN not ERROR: this is a HANDLED degradation (WebGL2-only / no-WebGPU GPUs) — the world stays
    // fully playable on the bare-render path, so it must not surface as an error (qa S-56).
    console.warn(
      '[renderer] atmosphere/post stack failed to construct — degrading to bare render (world stays playable):',
      error
    )
  }

  // ── HILLAIRE PHYSICAL SKY — THE DEFAULT at MEDIUM/HIGH (the sky tier ladder) ───────────────────────
  // The 4-LUT pipeline (transmittance / multiple-scattering / sky-view / aerial-perspective) rebuilt on the
  // GPU, ART-DIRECTED to the game's cinematic bar (hillaire_sky.js `art` dials: deep-blue aerial tilt sharing
  // FOG_COOL_TILT with the analytic fog, a horizon luma cap, a haze-density lift). The LADDER: LOW = the
  // analytic sky/fog assigned above; MEDIUM/HIGH = this physical sky (sky-view LUT → background, aerial
  // volume → fog on opaques). No URL flag by design (flags are avoided here). An internal override —
  // `globalThis.__ARES_SKY_ANALYTIC` — forces the analytic path at any tier for the bench PARITY spec ONLY
  // (never URL-parsed). Its OWN resilience guard degrades to the analytic sky on any construction/bake
  // failure (never kills the boot), mirroring the atmo law.
  const analytic_override = typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).__ARES_SKY_ANALYTIC
  const sky_hillaire_on = tier !== 'low' && !analytic_override
  if (sky_hillaire_on) {
    try {
      // share sky.sun_direction so set_time_of_day drives the physical sun with zero extra plumbing;
      // pass FOG_COOL_TILT so the physical aerial haze and the analytic fog share ONE cinematic-blue source.
      hillaire = create_hillaire_sky({
        tier,
        seed,
        sun_direction: sky.sun_direction,
        cool_tilt: FOG_COOL_TILT,
        rebuild_on_rotate: hillaire_rebuild_on_rotate,
        on_aerial_dispatch: on_hillaire_aerial,
      })
      await hillaire.bake(renderer) // compute all four LUTs before the first frame
      scene.backgroundNode = hillaire.background_node
      scene.fogNode = hillaire.fog_node
    } catch (error) {
      hillaire?.dispose()
      hillaire = null
      console.warn('[renderer] Hillaire sky failed to construct — keeping the analytic sky/fog:', error)
    }
  }

  // AUTO-EXPOSURE — transient eye adaptation (the white flood reads as an 'eye
  // adaptation' feeling — a decaying exposure event, never a standing veil). A CPU servo meters the post
  // stack's low_freq LDR target (readback, no new pass) and drives renderer.toneMappingExposure, which the
  // AgX tonemap reads LIVE (three's ToneMappingNode default exposure = rendererReference). All tiers;
  // degrades to the static baseline when post/metering is unavailable. Internal handle only (no URL flag —
  // by design): window.__auto_exposure exposes the live cfg + kill switch for developer/QA tuning.
  const auto_exposure = create_auto_exposure({ baseline: renderer.toneMappingExposure })
  if (typeof window !== 'undefined') /** @type {any} */ (window).__auto_exposure = auto_exposure

  /**
   * Renders one frame through the atmosphere post stack when it constructed cleanly — the drop-in
   * replacement for `renderer.render(scene, camera)` (engine.js §I). Advances the cloud weather
   * clock + froxel grid, refreshes the post stack's scene-camera uniforms, then renders the composed
   * pipeline. Falls back to the bare render when the chain is degraded (see resilience law above).
   * @param {number} [frame_dt_seconds] real frame delta (drives cloud drift; 0 is safe)
   * @param {number} [speed] horizontal player ground speed (m/s) — forwarded to the post stack's output
   *   effect (ENG-8 motion blur's run-speed trigger). Optional; 0 is a safe default (byte-identical to
   *   before this param existed).
   */
  function render_frame(frame_dt_seconds = 0, speed = 0) {
    // LINEAR CELESTIAL CLOCK: sample the wall-clock orbit BEFORE LUT refresh + render so every frame sees the
    // same constant angular velocity. Shadow-map re-bakes remain independently paced by sync_shadow.
    tick_sun()
    // [C9] refresh the physical-sky LUTs (view LUTs per frame; param LUTs on set_atmosphere_params) —
    // no-op at LOW (hillaire null). Before render so THIS frame's background + fog read fresh LUTs.
    hillaire?.tick(renderer, camera, frame_dt_seconds)
    if (atmo && post) {
      atmo.tick(renderer, camera, frame_dt_seconds)
      // S-43 GODRAYS: self-guarding no-op unless the flag is on and the sun shadow map just became ready
      // (one-time deferred graph rebuild). Cheap early-return otherwise.
      post.try_mount_godrays?.()
      post.update(camera, speed)
      // AUTO-EXPOSURE: advance the eye-adaptation servo from the LAST frame's metered luma and apply the
      // exposure the AgX tonemap will read this frame (set BEFORE render). Then, after render, kick an async
      // readback of the freshly-rendered low_freq target to feed the NEXT frame (one readback in flight).
      renderer.toneMappingExposure = auto_exposure.pre_render(frame_dt_seconds)
      post.render_frame()
      auto_exposure.post_render(renderer, post.meter_target())
    } else {
      renderer.render(scene, camera)
    }
  }

  /**
   * ENG-13: push the per-frame underwater state (computed by the engine loop, which owns the resident
   * chunk store) into the immersion pass. No-op when the atmosphere degraded (underwater null). Called
   * from engine.js BEFORE render_frame so this frame's colour already reflects the submerged flag.
   * @param {{ submerged: boolean, depth: number, dt: number }} state
   */
  function update_underwater(state) {
    underwater?.update(state)
  }

  /**
   * Re-samples the fog haze color from the analytic sky at the CURRENT sun (SPEC §J) — call after
   * set_time_of_day so the linear-fog band tracks dusk/night instead of keeping the boot-time hue.
   */
  function refresh_fog() {
    u_fog_rgb.value.copy(sky_horizon_color(sky))
    apply_sky_lighting(true)
  }

  /**
   * Recolour the terrain's sun + ambient lights to the sky at the current sun elevation — the SKY→TERRAIN
   * coupling (see the block by the light creation). ON (default): couple_lighting reddens/dims the sun off
   * the physical transmittance and warms/cools + dims the ambient, with NOON == the tuned baseline. OFF
   * (?skycouple=0): the legacy fixed colours + the [D184] night-dim ramp ("the night is not dark enough …
   * looks like desaturated day" → comfort floors: sun 15% / back-fill 30% / hemi 45%, so shapes stay
   * legible while the world reads NIGHT). Called per tod-change (after set_time_of_day) and once at boot.
   */
  // LINEAR CELESTIAL CLOCK: two paced external tod samples establish that the caller is the cycle driver;
  // render_frame then samples the configured orbit directly from performance.now(), every frame. A one-shot
  // demo/screenshot phase remains pinned. There is no target chase, easing curve, quantisation, or idle gate.
  let celestial_anchor_tod = sky.time_of_day.value
  let celestial_anchor_ms = performance.now()
  let celestial_clock_running = false
  let has_celestial_publish = false
  let last_published_tod = sky.time_of_day.value
  let last_publish_ms = 0
  const _key_dir = new Vector3() // scratch: the direction the DirectionalLight comes FROM (sun by day, moon at night)

  /**
   * Recolour the terrain's three lights for a GIVEN sun direction — the ONE colour path (ON: couple_lighting
   * reddens/dims the sun off the physical transmittance + warms/cools the ambient, NOON == baseline, and it
   * already crossfades the sun→a cool low MOONLIGHT below the horizon; OFF ?skycouple=0: the legacy night-dim
   * ramp). Shared by the boot/tod-change capture and the per-frame linear clock so they can never drift.
   * @param {number} sx @param {number} sy @param {number} sz unit sun direction
   */
  function recolor_lights(sx, sy, sz) {
    if (sun_follow_on) sun.shadow.intensity = shadow_intensity_for(sy)
    if (sky_couple_on) {
      const L = couple_lighting([sx, sy, sz], light_baseline)
      sun.color.setRGB(L.sun_color[0], L.sun_color[1], L.sun_color[2]) // linear working space (round-trips)
      sun.intensity = L.sun_intensity
      back_fill.color.setRGB(L.fill_color[0], L.fill_color[1], L.fill_color[2])
      back_fill.intensity = L.fill_intensity
      hemi.color.setRGB(L.hemi_sky[0], L.hemi_sky[1], L.hemi_sky[2])
      hemi.groundColor.setRGB(L.hemi_ground[0], L.hemi_ground[1], L.hemi_ground[2])
      hemi.intensity = L.hemi_intensity
      return
    }
    const night = sy >= 0.02 ? 0 : Math.min(1, (0.02 - sy) / 0.14)
    sun.intensity = light_baseline.sun_intensity * (1 - 0.85 * night)
    back_fill.intensity = light_baseline.fill_intensity * (1 - 0.7 * night)
    hemi.intensity = light_baseline.hemi_intensity * (1 - 0.55 * night)
  }

  /**
   * A first/one-shot publish pins deterministic demo and capture lighting. Two samples whose phase delta
   * matches the configured cycle start the per-frame clock; later matching publishes only confirm it. A
   * deliberate seek or repeated fixed phase stops the clock and becomes the new pin.
   * @param {boolean} [is_external_publish]
   */
  function apply_sky_lighting(is_external_publish = false) {
    const now_ms = performance.now()
    const incoming_tod = sky.time_of_day.value
    if (is_external_publish) {
      if (!has_celestial_publish) {
        celestial_clock_running = false
        celestial_anchor_tod = incoming_tod
        celestial_anchor_ms = now_ms
      } else if (!celestial_clock_running) {
        celestial_clock_running = is_linear_celestial_step(
          last_published_tod,
          incoming_tod,
          now_ms - last_publish_ms,
          CELESTIAL_CLOCK_TOLERANCE_MS
        )
        celestial_anchor_tod = incoming_tod
        celestial_anchor_ms = now_ms
      } else {
        const expected_tod = celestial_tod_at(now_ms - celestial_anchor_ms, celestial_anchor_tod)
        const phase_error = incoming_tod - expected_tod
        const wrapped_error = phase_error - Math.round(phase_error)
        if (Math.abs(wrapped_error) <= CELESTIAL_ANCHOR_EPSILON) sky.set_time_of_day(expected_tod)
        else {
          celestial_clock_running = false
          celestial_anchor_tod = incoming_tod
          celestial_anchor_ms = now_ms
        }
      }
      has_celestial_publish = true
      last_published_tod = incoming_tod
      last_publish_ms = now_ms
    }
    const sd = sky.sun_direction.value
    recolor_lights(sd.x, sd.y, sd.z)
  }
  apply_sky_lighting(false) // establish the initial coupled state at the boot sun elevation (tod 0.3)

  /**
   * Per-frame wall-clock sample: advance the shared sky phase/direction, light colour, and DirectionalLight
   * direction at one constant orbital velocity. The shadow map keeps its independent 2° rebuild gate.
   */
  function tick_sun() {
    if (!celestial_clock_running) return
    const tod = celestial_tod_at(performance.now() - celestial_anchor_ms, celestial_anchor_tod)
    sky.set_time_of_day(tod)
    const rendered_sun = sky.sun_direction.value
    recolor_lights(rendered_sun.x, rendered_sun.y, rendered_sun.z)
    if (sun_follow_on) {
      // the key light comes FROM the sun by day, the MOON (antipode) once the sun sets — colour/intensity
      // crossfade is recolour_lights' `night` factor; here we only pick the body. At the y≈0 switch the
      // directional intensity is ~0, so the azimuth handover is invisible; shadows stay frozen/off at night.
      if (is_moon_key(rendered_sun.y)) _key_dir.set(-rendered_sun.x, -rendered_sun.y, -rendered_sun.z)
      else _key_dir.copy(rendered_sun)
      sun.position.set(
        sun.target.position.x + _key_dir.x * SUN_STANDOFF_M,
        _key_dir.y * SUN_STANDOFF_M,
        sun.target.position.z + _key_dir.z * SUN_STANDOFF_M
      )
    }
  }

  // ── SHADOW FOLLOW + CACHE + STREAM DEBOUNCE (W11 T1/T2 + shadow-jump/stream fix) ─────────────────
  // Recenters the sun's ortho shadow box on the camera and gates shadow re-render. Called once per
  // rendered frame from engine.js's on_render. Triggers that set needsUpdate; steady frames set nothing:
  //   • box recenter — only on a camera CHUNK-boundary crossing (cadence note in the fn); the new centre
  //     is texel-snapped IN LIGHT SPACE so the silhouette samples stable texels (no swim/jump). ALWAYS
  //     applied immediately (a recenter with a stale map is a visible mismatch).
  //   • terrain change — terrain_epoch differs from last frame (a chunk uploaded/removed). While the
  //     stream is ACTIVE (queue_depth>0) this is DEBOUNCED to ≤1 re-render / SHADOW_STREAM_DEBOUNCE_MS
  //     so an arriving chunk no longer pops the whole shadow map every frame; the moment streaming is
  //     IDLE (queue_depth==0) the pending change applies immediately so shadows settle without lag.
  // If nothing fired, needsUpdate stays false and ShadowNode.updateBefore skips the shadow render.
  let last_shadow_center_x = Number.NaN
  let last_shadow_center_z = Number.NaN
  let last_terrain_epoch = -1
  const CHUNK = 32 // world-config CHUNK_SIZE; the box recenters on camera-chunk crossings (T1 cadence)
  let last_center_chunk_x = Number.NaN
  let last_center_chunk_z = Number.NaN
  // Stream-debounce state: a terrain change seen mid-stream sets `terrain_dirty` and is flushed at
  // most once per window (or immediately when the queue empties). perf.now clock; test drives real time.
  let terrain_dirty = false
  let last_shadow_flush_ms = Number.NEGATIVE_INFINITY
  // SUN-FOLLOW state: the sun direction at the last shadow bake (angular-pacing anchor) + reusable scratch
  // vectors for the per-frame dynamic azimuth basis / light offset (no per-frame allocation).
  const last_baked_sun = new Vector3(Number.NaN, Number.NaN, Number.NaN)
  const _fwd = new Vector3()
  const _right = new Vector3()
  const _off = new Vector3()

  /**
   * @param {import('three').Camera} active_camera
   * @param {number} terrain_epoch monotonic counter from terrain_renderer.upload_epoch()
   * @param {number} [queue_depth] pending gen+mesh chunks (ring_manager.queue_depth()); 0/absent =
   *   streaming idle → terrain changes flush immediately, no debounce.
   */
  function sync_shadow(active_camera, terrain_epoch, queue_depth = 0) {
    // SUN-FOLLOW basis for THIS frame. ON (default): the shading sun tracks the sky's live sun_direction —
    // a DYNAMIC azimuth snap basis + the light standoff along the real sun direction, re-aimed on an angular
    // step so a moving sun re-bakes a few times/minute (never per-frame). OFF (?sunfollow=0): the fixed
    // afternoon angle (SHADOW_LIGHT_OFFSET / SHADOW_FWD / SHADOW_RIGHT) — byte-identical to the pre-follow path.
    let fwd = SHADOW_FWD
    let right = SHADOW_RIGHT
    let off = SHADOW_LIGHT_OFFSET
    let sun_stepped = false
    if (sun_follow_on) {
      const sd = sky.sun_direction.value
      // NIGHT: sun below the horizon → shadows have faded to ~0 (shadow.intensity). Freeze the (invisible)
      // map, skip every re-bake — a below-horizon sun must never bake upside-down night shadows.
      if (sd.y < SHADOW_MIN_SUN_Y) return
      // Dynamic light-azimuth basis: the texel grid runs along the CURRENT sun azimuth (its horizontal
      // projection). Same orthonormal ground-plane grid the fixed path uses, rebuilt for the live sun so the
      // snap stays exact as the sun swings (kills the "shadows jump" residual under a moving sun).
      const hlen = Math.hypot(sd.x, sd.z) || 1
      fwd = _fwd.set(sd.x / hlen, 0, sd.z / hlen)
      right = _right.set(-fwd.z, 0, fwd.x)
      // Light stands off from the box centre ALONG the real sun direction — so the DirectionalLight (and its
      // shadow frustum) look back down the true sun ray; dawn ⇒ grazing/long, noon ⇒ steep/short.
      off = _off.set(sd.x, sd.y, sd.z).multiplyScalar(SUN_STANDOFF_M)
      // ANGULAR PACING: re-aim only when the sun has swung ≥ SUN_FOLLOW_STEP_RAD since the last bake.
      const dot = Math.max(-1, Math.min(1, last_baked_sun.x * sd.x + last_baked_sun.y * sd.y + last_baked_sun.z * sd.z))
      sun_stepped = Number.isNaN(last_baked_sun.x) || Math.acos(dot) >= SUN_FOLLOW_STEP_RAD
      if (sun_stepped) last_baked_sun.set(sd.x, sd.y, sd.z)
    }

    // RECENTER CADENCE: on a camera CHUNK-boundary crossing (box is ±SHADOW_SPAN_M ≫ 32 m, so this stays
    // rare) OR when the sun stepped (the snap basis rotated + the light must re-aim). Both snap the centre
    // to the light-azimuth texel grid and reposition the light; `moved` gates the re-bake below.
    const cx = Math.floor(active_camera.position.x / CHUNK)
    const cz = Math.floor(active_camera.position.z / CHUNK)
    const chunk_crossed = cx !== last_center_chunk_x || cz !== last_center_chunk_z
    let moved = false
    if (chunk_crossed || sun_stepped) {
      last_center_chunk_x = cx
      last_center_chunk_z = cz
      // LIGHT-AZIMUTH TEXEL SNAP: project the camera ground position onto the (dynamic) orthonormal azimuth
      // basis, floor each coordinate to the texel, rebuild x/z — an exact snap to the light's own texel grid
      // (the "shadows visibly jump" fix), now tracking the live sun azimuth.
      const px = active_camera.position.x
      const pz = active_camera.position.z
      const s = px * right.x + pz * right.z // cross-azimuth coordinate (both y=0)
      const t = px * fwd.x + pz * fwd.z // along-azimuth coordinate
      const s_snapped = Math.floor(s / SHADOW_TEXEL_M) * SHADOW_TEXEL_M
      const t_snapped = Math.floor(t / SHADOW_TEXEL_M) * SHADOW_TEXEL_M
      const center_x = s_snapped * right.x + t_snapped * fwd.x
      const center_z = s_snapped * right.z + t_snapped * fwd.z
      // Reposition even when the centre is unchanged: a pure sun-step keeps the centre but rotates the offset.
      if (center_x !== last_shadow_center_x || center_z !== last_shadow_center_z || sun_stepped) {
        last_shadow_center_x = center_x
        last_shadow_center_z = center_z
        // Box vertically anchored to the terrain band (centre y = 0) so near/far bracket the surface; only
        // X/Z track the camera. target = centre, position = centre+offset aims the light down the sun ray.
        sun.target.position.set(center_x, 0, center_z)
        sun.position.set(center_x + off.x, off.y, center_z + off.z)
        moved = true
      }
    }

    // Latch a terrain change; whether it renders THIS frame depends on the stream-debounce below.
    if (terrain_epoch !== last_terrain_epoch) {
      last_terrain_epoch = terrain_epoch
      terrain_dirty = true
    }

    // FLUSH POLICY. A recenter/sun-step always renders now. A terrain change renders now IF streaming is idle
    // (queue_depth==0) OR the debounce window since the last flush has elapsed — otherwise it waits (still
    // latched in terrain_dirty), so a burst of arriving chunks collapses to ≤1 re-render/window.
    const now_ms = performance.now()
    const streaming = queue_depth > 0
    const window_elapsed = now_ms - last_shadow_flush_ms >= SHADOW_STREAM_DEBOUNCE_MS
    const flush_terrain = terrain_dirty && (!streaming || window_elapsed)

    if (moved || flush_terrain) {
      if (flush_terrain) terrain_dirty = false
      last_shadow_flush_ms = now_ms
      // ShadowNode.renderShadow re-runs shadow.updateMatrices(light) on the next render, so the recentered/
      // re-aimed box takes effect exactly when we flip this — no separate matrix poke needed.
      sun.shadow.needsUpdate = true
      // Bench-only invalidation counter (mirrors engine.js's window.__ares_scene__ hook) — lets the
      // TASK-3 spec count actual shadow re-renders during a fly without patching three internals.
      if (typeof window !== 'undefined') {
        /** @type {any} */ window.__shadow_invalidations = /** @type {any} */ (window.__shadow_invalidations ?? 0) + 1
      }
    }
  }

  /**
   * Current sun shadow ortho box extent in world XZ, as [min_x, min_z, max_x, max_z]. The render lane
   * feeds this to terrain_renderer.set_shadow_box so shadow-map invalidation is SCOPED to chunks that
   * actually touch the shadowed region (chunks streaming in/out beyond the box during flight don't
   * force a re-render). Before the first recenter the box is centred on the sun target (origin).
   * @returns {[number, number, number, number]}
   */
  function shadow_box() {
    const cx = Number.isNaN(last_shadow_center_x) ? sun.target.position.x : last_shadow_center_x
    const cz = Number.isNaN(last_shadow_center_z) ? sun.target.position.z : last_shadow_center_z
    return [cx - SHADOW_SPAN_M, cz - SHADOW_SPAN_M, cx + SHADOW_SPAN_M, cz + SHADOW_SPAN_M]
  }

  /**
   * Pushes the fog band OUT to the far-shell boundary (NG-LOD phase B — the near-ring wall dies). The
   * far shell renders to `far_m`, so fog far sits AT the horizon and the near→far→sky dissolve spans
   * the whole distance instead of a ~168 m grey wall. `near_m` keeps the near band crisp. Idempotent;
   * engine.js calls it once the far streamer's reach is known (replacing set_fog_far_ceiling's clamp).
   * @param {number} near_m fog near (meters)
   * @param {number} far_m fog far (meters) — the far-shell outer radius
   */
  function set_far_fog(near_m, far_m) {
    u_fog_near.value = near_m
    u_fog_far.value = far_m
  }

  /** [D213-B] master scene-fog scale (0 disables ALL aerial fog — enclosed scenes).
   *  @param {number} v */
  function set_fog_scale(v) {
    u_fog_scale.value = Math.max(0, v)
  }

  /** [D251-2] runtime toggle for the camera-rotation blur (no motion blur in fights). No-op when
   *  the blur wasn't created (low/medium tier, or ?blur=0). */
  function set_motion_blur_enabled(/** @type {boolean} */ on) {
    motion_blur?.set_enabled?.(on)
  }

  return {
    renderer,
    scene,
    camera,
    set_fog_scale,
    set_motion_blur_enabled,
    backend,
    sky,
    atmo,
    hillaire,
    post,
    underwater,
    update_underwater,
    render_frame,
    refresh_fog,
    sync_shadow,
    shadow_box,
    set_far_fog,
    // [C1] one-shot shadow-map dirty for the pipeline warm queue: a warm-mounted GLB caster gets its
    // shadow-depth pipeline compiled in the SAME sliced frame (needsUpdate self-clears after one render;
    // sync_shadow only ever SETS this flag, so ordering with it is race-free).
    request_shadow_render() {
      sun.shadow.needsUpdate = true
    },
    dispose() {
      resize_observer?.disconnect()
      renderer.onDeviceLost = () => {}
      // null when the resilience guard degraded the chain (see the ARCHITECT RESILIENCE LAW above).
      post?.dispose()
      atmo?.dispose()
      hillaire?.dispose() // [C9] two-phase teardown (kernels nulled → tick inert → LUT textures freed)
      renderer.dispose()
    },
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {number}
 */
function aspect_of(canvas) {
  const width = canvas.clientWidth || canvas.width || 1
  const height = canvas.clientHeight || canvas.height || 1
  return width / height
}

/**
 * Builds the `renderer.onDeviceLost` hook (§brief: "log + attempt re-init"). WebGPURenderer
 * calls this with the platform's device-lost info object; we log it, notify the caller, and
 * attempt exactly one re-init of the GPU device in place (same renderer instance — three.js
 * supports re-requesting the device via `init()` again after loss on most backends). If that
 * throws, we give up loudly rather than looping forever.
 * @param {object} params
 * @param {import('three/webgpu').WebGPURenderer} params.renderer
 * @param {() => void} params.apply_size the module's single resize call site (§2.1) — routes the
 *   post-reinit re-size through the SAME setSize path as boot/ResizeObserver, so the depth texture
 *   never desyncs from the swapchain after a device loss.
 * @param {(info: unknown) => void} [params.on_device_lost]
 * @param {(ok: boolean) => void} [params.on_device_restore] fired once the re-init below settles
 *   (§brief extension — witness-r4: a silent recovery attempt left a black canvas with zero user-facing
 *   signal either way; the caller now gets an honest true/false instead of console-only breadcrumbs).
 * @returns {(info: unknown) => void}
 */
function build_device_lost_handler({ renderer, apply_size, on_device_lost, on_device_restore }) {
  return function on_device_lost_internal(info) {
    console.error('renderer.js: GPU device lost', info)
    on_device_lost?.(info)
    renderer
      .init()
      .then(() => {
        apply_size()
        console.warn('renderer.js: GPU device re-initialized after loss')
        on_device_restore?.(true)
      })
      .catch((error) => {
        console.error('renderer.js: GPU device re-init failed — manual reload required', error)
        on_device_restore?.(false)
      })
  }
}
