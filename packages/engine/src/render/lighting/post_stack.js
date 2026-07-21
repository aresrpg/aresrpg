// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One output graph: scene → clouds/froxels → AgX → display grade/effects. Scene reconstruction uses
// explicit camera uniforms because the post quad's own camera is orthographic.

import { AgXToneMapping, FloatType, Matrix4, SRGBColorSpace, Vector3 } from 'three'
import { RenderPipeline } from 'three/webgpu'
import {
  Fn,
  float,
  getViewPosition,
  luminance,
  mrt,
  output,
  pass,
  renderOutput,
  rtt,
  uniform,
  uv,
  vec4,
  velocity,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
// S-43 flag-gated release-visual prototypes (DEFAULT OFF — pixels are graded by hand, never flipped
// to default here). taau: Temporal AA Upscaling for the TAAU tier (medium §5.1) — resolves a
// low-res scene pass to output res with jitter+velocity reprojection. Lazy-imported constant;
// unused (and never constructed) when its flag is off.
import { taau } from 'three/addons/tsl/display/TAAUNode.js'
// S-43 SHARPEN: FSR1 RCAS (Robust Contrast-Adaptive Sharpening — the AMD/FSR family Fortnite's TSR
// pairs with) contrast-limited sharpen. The buildable half of the medium "render-at-0.66-upscale"
// recipe while real temporal reconstruction (taau_temporal) stays varying-blocked: a scene-pass
// bilinear upscale (taau_scale) is SOFT, and RCAS recovers the perceived edge detail for ~one cheap
// display-space pass. Lazy const; unconstructed when sharpen_amount is null (off).
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'

// FIGHT-VFX POST-AgX OVERLAY: fight-cast VFX render on FIGHT_VFX_LAYER (auto-excluded from THIS scene pass by the
// camera's default layer-0 mask), then this pass isolates them and composites them additively in DISPLAY space so
// the purchased pack's saturated glow reads as pure light instead of AgX-desaturated white (see vfx_overlay_pass.js).
import { create_vfx_overlay } from '../vfx_overlay_pass.js'
// BOARD-HIGHLIGHT POST-AgX OVERLAY: tactical board highlights render on BOARD_HIGHLIGHT_LAYER (auto-excluded
// from THIS scene pass by the camera's default layer-0 mask), then this pass isolates them and composites them
// OVER the graded frame at a FIXED exposure so their colour is CONSTANT across the day↔night auto-exposure
// swing — the "highlight colors washed at night" strike (see board_highlight_overlay_pass.js).
import { create_highlight_overlay } from '../board_highlight_overlay_pass.js'

// S-43 GODRAYS: physically-based shadow-map-gated in-scatter (god_rays.js) — replaces the three-addon
// shadow-volume GodraysNode this leg used to mount; that isotropic accumulation washed open/downward
// framings to a milky white, which god_rays.js fixes at the source (shadow gating + HG phase + height
// falloff) instead of the CPU pitch/sun gain band-aid this file used to apply.
import { create_god_rays } from './god_rays.js'
// ENG-13.5 LENS WATER: water should appear to flow down the lens when the camera exits water —
// screen-space droplets on the underwater EXIT edge (see underwater.js's just_exited()). Always
// constructed (no deferred resource, unlike godrays) — see lens_water.js header for the full design.
import { create_lens_water } from './lens_water.js'

/** fixed low-freq luma target — small enough to be free, big enough to resolve scene REGIONS. */
const LF_W = 96
const LF_H = 54

/**
 * @typedef {object} PostStack
 * @property {import('three/webgpu').RenderPipeline} pipeline
 * @property {(camera: import('three').PerspectiveCamera, speed?: number) => void} update per-frame
 *   BEFORE render: copies the scene camera's matrices into the reconstruction uniforms. `speed` (m/s,
 *   ENG camera-feel, default 0) forwards the player's ground speed to the output effect (motion blur).
 * @property {() => void} render_frame renders the composed pipeline (replaces renderer.render).
 * @property {() => boolean} try_mount_godrays deferred S-43 godrays mount — rebuilds the output graph
 *   once the sun's shadow map exists (renderer.js calls it per frame until true; no-op when off/mounted).
 * @property {(renderer: *) => Promise<void>} compile async-warms the scene-pass pipelines (D221).
 * @property {() => (import('three').RenderTarget | null)} meter_target the low_freq LDR render target
 *   for auto-exposure metering (renderer.js reads back its average luma each frame). Null before first build.
 * @property {() => *} bloom_node the mounted BloomNode (null on tiers below high) — its
 *   `threshold`/`strength`/`radius` uniforms are live tuning knobs (ENG-12 cinematic bloom).
 * @property {import('./underwater.js').UnderwaterPass | null} underwater the ENG-13 underwater pass
 *   (null when the tier didn't construct it) — the frame loop calls its `update()` and live-tuning can
 *   live-tune its `active`/`depth`/`warp_amp` uniforms.
 * @property {() => void} dispose
 */

/**
 * @typedef {object} OutputEffectContext reconstruction handles handed to an output effect's build().
 * @property {*} scene_depth the scene depth texture node (`.r` = raw depth).
 * @property {*} u_proj_inv `uniform(Matrix4)` — scene camera projectionMatrixInverse (per-frame).
 * @property {*} u_cam_world `uniform(Matrix4)` — scene camera matrixWorld (per-frame).
 * @property {*} u_cam_pos `uniform(Vector3)` — scene camera world position (per-frame).
 */

/**
 * @typedef {object} OutputEffect
 * @property {(final_node: *, ctx: OutputEffectContext) => *} build wraps the final graded vec4.
 * @property {(camera: import('three').PerspectiveCamera, speed?: number) => void} update per-frame,
 *   before render. `speed` (m/s, ENG camera-feel) is the player's horizontal ground speed — optional,
 *   forwarded from render_frame's own optional `speed` param; effects that don't use it just ignore it.
 */

/**
 * Build the full post-processing composition. Pure node-graph construction — nothing renders until
 * `render_frame()`. The atmosphere handle supplies clouds/froxels/grade + live config.
 * @param {object} opts
 * @param {import('three/webgpu').WebGPURenderer} opts.renderer
 * @param {import('three').Scene} opts.scene
 * @param {import('three').PerspectiveCamera} opts.camera
 * @param {import('three').DirectionalLight} opts.sun shadow-casting sun (kept: underwater/output effects may consume; unused by the core chain since the godrays deletion)
 * @param {import('../atmosphere.js').Atmosphere} opts.atmo
 * @param {import('../../core/quality/tiers.js').TierName} [opts.tier] quality tier — gates HALF-RES POST
 *   on MEDIUM only: the bloom pyramid renders at 0.25 internal scale AND the flat cloud deck renders in
 *   its own 0.5-linear rtt (see the HALF-RES POST block; ?halfpost=0 escapes). high/low untouched.
 * @param {import('./underwater.js').UnderwaterPass} [opts.underwater] OPTIONAL underwater immersion
 *   pass (ENG-13). Unlike `output_effect` (a FINAL display-space wrap), this is woven INTO the HDR
 *   chain BEFORE bloom so the blue immersion fog blooms naturally: its `warp_uv` wobbles the scene
 *   colour sample, and its `apply(col, frag_dist, ray_dir)` composites the depth-graded blue fog +
 *   vertical gradient + depth-darken over the (cloud/fog/godray) HDR colour. Uniform-driven (submerged
 *   flag / depth / clock), so the graph never recompiles on a submerge/surface flip — dry frames are
 *   byte-identical bar one dependent texture read. Left undefined the chain is unchanged.
 * @param {number|null} [opts.taau_scale] S-43 TAAU leg (param DEFAULT null=off; renderer.js passes 0.66 for
 *   MEDIUM by default — the base-game taau recipe, ?taau_medium=0 escapes). When set (e.g. 0.66), the
 *   SCENE pass renders at this fraction of output res (`PassNode.setResolutionScale`); the atmosphere
 *   (clouds/froxels/godrays/bloom/grade) still composites at full output res on top of the upscaled beauty.
 *   By itself this is a velocity-free dynamic-resolution upscale (bilinear) — the compatible, measurable
 *   path. The temporal resolve (real TAAU) is a SEPARATE opt-in (`taau_temporal`) — see below.
 * @param {number|null} [opts.sharpen_amount] S-43 SHARPEN leg (param DEFAULT null=off; renderer.js passes 0.4
 *   for MEDIUM by default — pairs with the taau recipe, ?taau_medium=0 escapes). When set (e.g. 0.4),
 *   wraps the FINAL display-space image in an FSR1 RCAS sharpen (three's `sharpen()` node). The value is
 *   three's `sharpness` param: 0 = maximum sharpening, 2 = none (so LOWER = sharper). Pairs with
 *   `taau_scale` as the buildable Fortnite-lite recipe — a 0.66 scene-pass bilinear upscale is soft, and
 *   RCAS restores the perceived edge detail for one cheap display-space pass. Live knob: `window.__sharpen`.
 * @param {boolean} [opts.taau_temporal] S-43 TAAU temporal resolve (DEFAULT false). When true AND
 *   taau_scale is set, adds a velocity MRT to the scene pass and resolves via three's `taau()` node
 *   (jitter + history reprojection). BLOCKED on this engine: velocity adds a `positionPrevious` varying to
 *   every material, but several materials already use all 16 WebGPU inter-stage varyings → pipeline-limit
 *   failure (18 > 16). Kept behind its own flag for a future material varying-diet; NOT the default path.
 * @param {import('three').DirectionalLight|null} [opts.godrays_light] S-43 GODRAYS leg (DEFAULT null=off).
 *   When set (the sun), mounts the physically-based `create_god_rays()` in-scatter (god_rays.js) and adds
 *   its shafts additively in LINEAR HDR (before tonemap, where the deleted screen-space pass used to sit).
 *   Requires the light's shadow.map to exist at build time (renderer.js forces one shadow render first);
 *   deferred (try_mount_godrays) until it is.
 * @param {OutputEffect} [opts.output_effect] OPTIONAL final-stage wrapper (ENG-8 camera motion blur).
 *   A documented, additive insertion hook that does NOT restructure the chain: after the display-space
 *   grade produces the final `vec4`, if present, its `build(final_node, ctx)` wraps it (returns a new
 *   `vec4`) and its `update(camera)` runs each frame before render (to refresh the effect's uniforms).
 *   `ctx` exposes the scene-camera reconstruction handles the effect needs (depth + inverse-proj +
 *   world matrix + camera position uniforms) so a screen-space effect can reconstruct view/world rays
 *   with the SAME basis the clouds/fog/godrays use (the quad-camera trap — see header). Left undefined
 *   the chain is byte-identical to before this hook existed.
 * @returns {PostStack}
 */
export function create_post_stack({
  renderer,
  scene,
  camera,
  sun,
  atmo,
  underwater,
  output_effect,
  taau_scale = null,
  taau_temporal = false,
  sharpen_amount = null,
  godrays_light = null,
  tier = 'high',
}) {
  const cfg = atmo.config
  const pipeline = new RenderPipeline(renderer)
  pipeline.outputColorTransform = false // we apply AgX+sRGB manually mid-chain (renderOutput below)

  // ── HALF-RES POST (MEDIUM tier, perf mandate) ──────────────────────────────────────────────────
  // [wave 1 — BLOOM] The bloom sub-chain was the DOMINANT per-pixel post cost — measured 7.87 ms of the
  // medium sky+post budget at 22.9 Mpx (bench/_halfres_post.spec.js [retired, issue #74]: baseline 24.85 ms → 16.98 ms with
  // ?bloom=0). BloomNode renders its high-pass + full mip pyramid at `_resolutionScale` × the swapchain
  // (three default 0.5); dropping it to 0.25 on MEDIUM quarters that pyramid's fill. Visually free for
  // THIS bloom: threshold 2.05 (only genuine highlights — sun disc, water glints, sky-through-canopy),
  // strength 0.13, radius 0.6 — a WIDE, SUBTLE blur of SPARSE bright pixels, source grid far finer than
  // the kernel (A/B-verified at rest AND in motion). The FULL-RES hdr bake that feeds the sharp final
  // composite is untouched, so terrain stays crisp — only the blur pyramid downsamples.
  // [wave 2 — CLOUDS, half-res-post wave] The flat cloud deck is the ONE remaining default-ON
  // fullscreen atmosphere pass at medium (froxels + godrays are default-OFF at every tier; the scene fog
  // is scene.fogNode INSIDE the 0.66-scaled scene pass — no separate fullscreen fog pass exists at
  // medium). Its ~7-octave noise eval ran per FULL swapchain pixel inside the hdr bake — measured
  // 1.40 ms of the medium frame at 13.8 Mpx (bench attribution: baseline 9.91 → clouds_off 8.51). The
  // deck now renders in its OWN rtt at HALF_RES_CLOUD_SCALE (0.5 linear = 0.25× area) and the
  // premultiplied (color·α, α) texture is composited at full res with plain bilinear — the correct
  // filter for a premultiplied over (no fringing). The deck is a LOW-FREQ hazy layer whose fwidth-lod
  // already fades unresolvable detail (at half res that lod correctly engages one octave earlier), so
  // the honest cost is edge softness where the deck meets terrain silhouettes (depth-derived alpha at
  // half res) — A/B'd at vista + sky framings, day + dusk, plus a moving-camera capture.
  // [wave 2b — ONCE-PER-FRAME RTT DEDUPE] Instrumenting wave 2 exposed a pre-existing defect: RENDER-type
  // rtts re-render per CONSUMER pass (see the hdr_tex comment in build_output) — the full-res hdr bake ran
  // 3×/frame in the shipped chain. The medium recipe now arms autoUpdate=false + a per-frame re-arm on
  // hdr_tex and the cloud rtt ⇒ each bakes exactly once. Byte-identical pixels; pure pass-count cut.
  // NOT half-res (the declared split): AgX + grade + RCAS sharpen are per-pixel color transforms OF the
  // full-res beauty — computing them at half res would halve the FINAL image itself (tonemap banding +
  // softness on everything, incl. the taau-recipe scene detail RCAS just recovered); they stay
  // display-res by design. The full-res hdr bake also stays: it IS the beauty path (col = hdr + bloom).
  // RCAS interaction: the sharpen runs ONCE, display-space, on the finished composite — upsampled cloud
  // edges get the same single contrast-limited pass as everything else (no double-sharpen anywhere).
  // MEDIUM ONLY for the SCALING (bloom/cloud half-res): high/low keep the inline full-res chain,
  // byte-identical — high still renders every pixel at full res. The ONE piece that ALSO now reaches
  // high is the hdr dedupe itself (wave 2c, hdr_dedupe_on below) — a pass-count cut, not a scaling one.
  // ESCAPE (house switchboard):
  // ?halfpost=0 boots the pre-half-res-post medium — clouds composite INLINE (byte-identical graph) and
  // bloom restores three's 0.5. Live knob: window.__half_res_post.{enabled,bloom_scale,cloud_scale} —
  // `enabled` toggles the bloom pyramid scale AND the cloud rtt scale (0.5 ↔ 1.0) next frame; the rtt
  // INDIRECTION itself is boot-baked, same class as the other medium recipes (taau/sharpen/atlas size)
  // — a live set_tier re-arms on reload (the set_tier live-arm residual ticket covers all of them).
  const HALF_RES_BLOOM_SCALE = 0.25
  const BLOOM_DEFAULT_SCALE = 0.5 // three's BloomNode default — the OFF / high-ultra value (byte-identical)
  const HALF_RES_CLOUD_SCALE = 0.5 // deck rtt linear scale (0.25× area); 1.0 = the live-off value
  const is_medium_tier = tier === 'medium'
  const halfpost_off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('halfpost') === '0'
  const half_res_post = {
    enabled: is_medium_tier && !halfpost_off,
    bloom_scale: HALF_RES_BLOOM_SCALE,
    cloud_scale: HALF_RES_CLOUD_SCALE,
  }
  // structural (graph-build-time) gate for the WHOLE medium half-res-post recipe: the deck renders
  // through an rtt AND the cloud rtt's once-per-frame dedupe arms only here — ?halfpost=0 keeps the deck
  // inline + the shipped multi-render, so the escape graph is byte-identical to the shipped chain. (The
  // hdr_tex dedupe below is a SEPARATE gate, hdr_dedupe_on — it also arms on high, which has no cloud rtt.)
  const half_res_post_on = is_medium_tier && !halfpost_off
  if (is_medium_tier && typeof window !== 'undefined') {
    const w = /** @type {any} */ (window)
    w.__half_res_post = half_res_post
  }
  // ONCE-PER-FRAME HDR DEDUPE gate [wave 2c — residual off wave 2b, see the hdr_tex comment in
  // build_output]: medium's half-res-post recipe OR high. HIGH shares hdr_tex's exact 3-consumer shape
  // (bloom high-pass sub-render + low_freq auto-exposure quad + the main swapchain pass's own direct
  // read) with NONE of medium's half-res SCALING, so it pays the identical shipped 3×/frame full-res hdr
  // bake. Pure pass-count cut, byte-identical pixels (A/B: bench/_halfres_post.spec.js [retired, issue #74]'s high-tier
  // describe). Unconditional at high (no escape flag — nothing else on its path is flag-escapable
  // either). LOW untouched — out of scope for this pass.
  const hdr_dedupe_on = half_res_post_on || tier === 'high'

  const scene_pass = pass(scene, camera)
  // S-43 TAAU: render the scene beauty at a fraction of output res. The temporal resolve additionally
  // needs a velocity MRT — setMRT is REQUIRED (PassNode renders with setMRT(this._mrt), null by default,
  // so getTextureNode('velocity') alone samples an unwritten buffer). Velocity is BLOCKED on this engine's
  // varying-heavy materials (18 > 16 limit), so it's gated behind taau_temporal only. Off ⇒ untouched.
  const use_temporal = taau_scale != null && taau_temporal
  if (taau_scale != null) scene_pass.setResolutionScale(taau_scale)
  if (use_temporal) scene_pass.setMRT(mrt({ output, velocity }))
  const scene_color = scene_pass.getTextureNode()
  const scene_depth = scene_pass.getTextureNode('depth')
  const scene_velocity = use_temporal ? scene_pass.getTextureNode('velocity') : null
  // FIGHT-VFX OVERLAY: build the isolated layer-10 pass ONCE (its texture node in the output graph makes the pipeline
  // render it each frame). composite() below adds it post-AgX, depth-masked against scene_depth (VFX behind geometry
  // occlude). Byte-identical for any frame with no fight VFX live (an empty layer-10 pass is a cheap clear).
  const vfx_overlay = create_vfx_overlay({ scene, camera, scene_depth })
  // BOARD-HIGHLIGHT OVERLAY: sibling of vfx_overlay — the tactical highlights render on BOARD_HIGHLIGHT_LAYER
  // (auto-excluded from the main scene pass), and composite() below re-tonemaps them at a FIXED exposure post-
  // AgX so their colour is CONSTANT across the day↔night auto-exposure swing. Empty layer outside a fight ⇒ a
  // cheap clear, byte-identical. Depth-masked against scene_depth (a fighter's body occludes the wash under it).
  const highlight_overlay = create_highlight_overlay({ scene, camera, scene_depth })
  if (taau_scale != null && typeof window !== 'undefined') {
    const w = /** @type {any} */ (window)
    w.__taau_scale = taau_scale // bench probe: read renderTarget.texture.{width,height}
    w.__scene_pass = scene_pass
  }
  // Godrays can only build once its light's shadow MAP is allocated — and that happens on the first frame
  // a shadow CASTER renders (terrain streams in after create_renderer, so the map is null at boot). We
  // therefore build without godrays now and lazily re-mount (rebuild the output graph) on the first frame
  // the map exists, via try_mount_godrays() below — the deferred-remount pattern this file always had for
  // the godrays shadow-map dependency. A null map at GodraysNode.setup() would throw, so this gate is load-bearing.
  const godrays_ready_now = () => Boolean(godrays_light && godrays_light.shadow && godrays_light.shadow.map)

  // scene-camera uniforms for per-pixel ray reconstruction (see header — quad camera trap).
  const u_proj_inv = uniform(new Matrix4())
  const u_cam_world = uniform(new Matrix4())
  const u_cam_pos = uniform(new Vector3())

  // S-43 SHARPEN: RCAS strength as a live uniform (three's `sharpness`: 0=max, 2=none). Default 0.4 =
  // a firm-but-safe sharpen that offsets the taau_scale bilinear softness without ringing. Off ⇒ never
  // constructed. Live knob mirrors the __half_res_post idiom: window.__sharpen.sharpness, read in update().
  const u_sharpness = uniform(sharpen_amount ?? 0.4)
  if (sharpen_amount != null && typeof window !== 'undefined') {
    const w = /** @type {any} */ (window)
    w.__sharpen = { sharpness: sharpen_amount }
  }

  /** @type {*} */ let bloom_node = null
  // HALF-RES CLOUDS: the medium deck rtt (null = inline/off tier). update() live-toggles its scale.
  /** @type {*} */ let cloud_rtt = null
  // ONCE-PER-FRAME hdr dedupe handle (medium recipe): update() re-arms its textureNeedsUpdate.
  /** @type {*} */ let hdr_rtt = null
  // AUTO-EXPOSURE meter: the low_freq RTT's render target, captured at build so renderer.js can read back
  // its average luma each frame (the eye-adaptation servo). Reusing the target the grade already renders
  // ⇒ zero new passes. Re-captured on any output-graph rebuild (godrays remount) via build_output below.
  /** @type {import('three').RenderTarget | null} */ let meter_rt = null
  // S-43 GODRAYS: the god_rays.js handle (null until the deferred shadow-map mount builds it in
  // build_output). update() refreshes its coupled sun each frame; dispose() releases it at teardown.
  /** @type {*} */ let god_rays = null
  // Bloom is tier-gated to the froxel tiers (high) and does NOT depend on the shadow map, so it
  // mounts at boot and never re-mounts (its threshold/strength/radius are live uniforms). ENG-12.
  // [SHADER DIET D7 — mobile] Bloom OFF at LOW (the mobile floor). The BloomNode high-pass + 5-mip
  // pyramid compiles ~13 SEPARATE render pipelines — the single biggest pipeline-COUNT hog in the
  // low-tier boot compile (measured: SHADER_DIET_DESIGN.md §1/§3) — to add a soft highlight halo the
  // LOW tier is explicitly meant to skip ("no fancy post", tiers.js header). Dropping it also removes
  // the full-res hdr_tex bake at low. HIGH/MEDIUM keep bloom BYTE-IDENTICAL (this only adds a low
  // branch — nothing on their path changes). Auto-exposure metering reads the low_freq rtt, built
  // independently of the hdr bake, so it survives with_bloom=false. ?bloom=0 still forces off everywhere.
  const with_bloom = !atmo.features.bloom_off && tier !== 'low' // [D186 — bloom must stay available independent of froxels] DECOUPLED from froxels — bloom died as collateral when froxels went default-off; it is its own feature with its own kill switch
  const lens_water = create_lens_water({ tier })
  if (typeof window !== 'undefined') /** @type {any} */ (window).__lens_water = lens_water
  /** @type {*} */ let lens_dry = null
  /** @type {*} */ let lens_wet = null
  let lens_warm_pending = true

  /**
   * Compose the full output graph — built ONCE at boot; all tuning is live uniforms.
   * @returns {*} vec4 output node
   */
  const build_output = () => {
    // ── ray reconstruction (per pixel): view→world via the scene camera's uniforms ────────────────
    const view_pos = getViewPosition(uv(), scene_depth.r, u_proj_inv)
    const world_pos = u_cam_world.mul(vec4(view_pos, 1)).xyz
    const ray = world_pos.sub(u_cam_pos)
    const frag_dist = ray.length()
    const ray_dir = ray.div(frag_dist.max(1e-4))

    // ── ENG-13 underwater: wobble the SCENE COLOUR sample uv (identity when dry / on low — the warp
    // amp uniform is 0 there, so the mix inside warp_uv collapses to uv()). Depth is reconstructed from
    // the UNWARPED uv above on purpose — we refract the visible image, not the geometry/fog distances,
    // which is the classic cheap underwater look. Absent the pass, `col` is the plain `.rgb` as before.
    // S-43 TAAU: when on, the beauty base is the taau()-resolved (full-res, temporally upscaled) color
    // instead of the raw scene texture. The underwater warp is bypassed under TAAU (the resolve owns the
    // sub-pixel history); dry/non-TAAU frames are byte-identical to before. taau_node is reachable from
    // the output graph here so its per-frame resolve (updateBefore) runs inside the pipeline.
    const taau_node = use_temporal
      ? taau(scene_color, scene_depth, /** @type {import('three/webgpu').TextureNode} */ (scene_velocity), camera)
      : null
    if (taau_node) {
      // TAAUNode's private previous-depth RT defaults to a Depth24Plus DepthTexture, but this engine's
      // scene-pass depth is Depth32Float (reversed-Z WebGPU + FloatType water depth grab). Its per-frame
      // copyTextureToTexture (current depth → previous depth) REQUIRES identical formats, so align the
      // RT's depth type to FloatType — the exact same fix renderer.js applies to the water depth grab.
      const prev_depth = /** @type {any} */ (taau_node)._previousDepthRenderTarget?.depthTexture
      if (prev_depth) prev_depth.type = FloatType
      if (typeof window !== 'undefined') /** @type {any} */ (window).__taau = taau_node
    }
    let col = taau_node
      ? taau_node.rgb
      : underwater
        ? scene_color.sample(underwater.warp_uv(uv())).rgb
        : scene_color.rgb

    // ── clouds (§E): a FLAT cloud deck (ENG-15), depth-composited — `frag_dist` caps the ray-plane hit
    // so terrain nearer than the deck occludes it; sky pixels reconstruct at the far plane and see the
    // full layer. Skipped when the tier has no cloud budget (low). Single ray-plane sample, ~zero cost
    // — no march, no jitter, no bands (the per-pixel volumetric march + its artifact classes are gone).
    if (atmo.features.clouds) {
      // `cloud_layer` uses TSL select()/dependent texture reads (no If/Loop STACK ops), but keep the
      // Fn() wrapper for parity with the rest of the chain (the graph captures the outer ray nodes by
      // closure). Returns premultiplied (color·alpha, alpha) → composite is the standard over.
      const cloud_fn = Fn(() => {
        const c = atmo.clouds.cloud_layer(u_cam_pos, ray_dir, frag_dist)
        return vec4(c.color, c.alpha)
      })
      // HALF-RES CLOUDS (medium — see the HALF-RES POST block): evaluate the deck in its OWN rtt at
      // 0.5 linear and sample the premultiplied result bilinearly at full res. The rtt's quad shares
      // this graph's uv()/depth/uniform basis (same closure), so the reconstruction is identical —
      // only the sampling density halves. Texture-chaining rtts is the SHIPPED shape (low_freq samples
      // hdr_tex + bloom), so this adds one proven link, not a new nesting class. On rebuild (godrays
      // remount) the previous rtt's target is released before the new one mounts.
      /** @type {*} */ let cloud
      if (half_res_post_on) {
        cloud_rtt?.renderTarget?.dispose?.()
        cloud_rtt = rtt(cloud_fn())
        cloud_rtt.setResolutionScale(HALF_RES_CLOUD_SCALE)
        // ONCE-PER-FRAME (see the hdr_tex dedupe below — same mechanism, measured 3×/frame here too).
        cloud_rtt.autoUpdate = false
        // bench probe handle (the __scene_pass idiom): renderTarget size + updateBefore counting.
        if (typeof window !== 'undefined') /** @type {any} */ (window).__cloud_rtt = cloud_rtt
        cloud = cloud_rtt
      } else {
        cloud = cloud_fn()
      }
      col = cloud.rgb.add(col.mul(float(1).sub(cloud.a)))
    }

    // ── froxel volumetric fog (§F): scatter+transmittance from the integrated froxel grid; the
    // The NEAR-haze floor rides the froxel density hook (atmosphere.js). Applies over clouds too
    // (fog is nearer than the deck — correct layering for free). HIGH+ tiers only (gate).
    if (atmo.features.froxels) col = atmo.froxels.apply(col, frag_dist, uv())

    // ── S-43 GODRAYS (flag-gated, default OFF): physically-based shadow-map-gated in-scatter (god_rays.js)
    // composited additively in LINEAR HDR — exactly where the deleted screen-space pass sat. Shadow-map
    // sampling + Henyey-Greenstein forward phase + height falloff make an open/downward view integrate to
    // ≈0 at the source (the CPU pitch/sun gain band-aid this leg used to need is gone with it — see
    // god_rays.js header for the non-washout proof). It reconstructs world rays from the SCENE camera's OWN
    // per-frame uniforms (constructor takes `camera`), so it does NOT bind the ortho quad camera. Inherits
    // the coupled Hillaire sun (direction + radiance) refreshed every frame in update() below. Live tuning:
    // window.__godrays.{u_density,u_g,u_falloff_h,u_ground_y,u_strength,u_max_dist}.
    if (godrays_ready_now()) {
      god_rays = create_god_rays({
        light: /** @type {import('three').DirectionalLight} */ (godrays_light),
        camera,
        scene_depth,
      })
      col = col.add(god_rays.in_scatter)
      if (typeof window !== 'undefined') /** @type {any} */ (window).__godrays = god_rays
    }

    // ── god-ray shafts (screen-space, radial): DELETED (2026-07-05). The screen-space GodraysNode
    // radial march was THE source of the observed "huge white circle static texture" — undersampled
    // radial blur from the sun's projected position paints concentric arc rings containing smeared
    // ghost copies of the scene (captured footage showed the staircase ghosts inside the rings). It
    // survived the ENG-15 cloud-march deletion because it was never the clouds. The froxel shafts
    // (enclosure-aware, always-on volumetrics) are the ONE god-ray system — per the one-home law the
    // screen-space garnish is removed outright, not flag-gated: the artifact class must be impossible.

    // ── ENG-13 UNDERWATER IMMERSION ── composited HERE (after clouds/fog/godrays, BEFORE bloom) so the
    // blue immersion fog is a LINEAR-HDR colour that blooms naturally (the surface glint / bright cyan
    // ceiling gain the soft halo). Depth-graded blue-green fog toward WATER_BODY_COLOR + up/down view-
    // ray gradient + depth-darken, all multiplied by the live submerged uniform so a dry frame is
    // unchanged. Reads the SAME depth-reconstructed `frag_dist`/`ray_dir` the volumetrics use.
    if (underwater) col = underwater.apply(col, frag_dist, ray_dir)

    // ── cinematic bloom (ENG-12 — target: more bloom, sun powerfully creating rays) ──────────
    // Threshold bloom in LINEAR HDR, BEFORE AgX, so the high-pass threshold means "brighter than
    // diffuse-lit surfaces" (≈1.0). The sun disc (SUN_DISC_INTENSITY=40), sky gaps through canopy, water
    // glints, and the boosted shafts all clear it and gain a soft halo; ordinary lit surfaces sit below
    // it and stay crisp — a SELECTIVE bloom without needing an emissive MRT. The composed HDR is first
    // baked to a full-res RTT (one evaluation of the whole clouds/froxel/godray graph) so BloomNode's
    // internal high-pass + 5-mip pyramid sample a cheap TEXTURE, not the heavy graph (the perf budget).
    // Tier-gated: only where the froxel stack runs (high). BloomNode auto-sizes each frame.
    if (with_bloom) {
      // Bake the composed HDR to ONE full-res texture, then bloom + add from that SAME texture. The
      // single rtt is deliberate: it makes the clouds/froxel/godray graph evaluate ONCE, and both the
      // bloom high-pass AND the additive re-add sample the cheap texture — no deep render-target nesting
      // (an rtt-inside-rtt-inside-bloom tripped a WebGPU pipeline-invalidation, the 2026-07-03 boot break).
      const hdr_tex = rtt(vec4(col, 1))
      // ONCE-PER-FRAME DEDUPE (medium's half-res-post recipe AND high — wave 2c, hdr_dedupe_on above).
      // RTTNode is RENDER-type with autoUpdate — and NodeFrame's RENDER dedupe is per-renderId (Renderer
      // sets renderId = info.calls on every internal pass), so EVERY pass whose graph references an rtt
      // re-renders it. hdr_tex has THREE consumers on both tiers (the bloom high-pass sub-render, the
      // low_freq quad, and either the sharpen input bake OR — with sharpen off, e.g. high's default —
      // the main swapchain pass's own direct read) ⇒ the shipped chain baked this FULL-RES HDR 3× per
      // frame on medium (measured: the __cloud_rtt probe read renders_per_frame=3 — the deck rides
      // inside this graph, so its count IS hdr's count) and identically on high (same consumer shape;
      // A/B'd in bench/_halfres_post.spec.js [retired, issue #74]'s high-tier describe via the __hdr_rtt probe below).
      // autoUpdate=false + a per-frame textureNeedsUpdate re-arm in update() renders it exactly ONCE:
      // the first consumer's traversal bakes it, the rest sample the same-frame texture. Byte-identical
      // content — every uniform is already set in update() before pipeline.render(), so every consumer
      // always saw this same frame anyway. Gated to hdr_dedupe_on (medium OR high); ?halfpost=0 still
      // escapes MEDIUM's dedupe to the shipped 3× chain for A/B — high has no equivalent escape (nothing
      // else on its path is flag-escapable either), so its dedupe is unconditional.
      if (hdr_dedupe_on) {
        hdr_tex.autoUpdate = false
        hdr_rtt = hdr_tex
        // bench probe handle (the __cloud_rtt idiom): direct .autoUpdate toggle for a live, same-page
        // A/B (bench/_halfres_post.spec.js [retired, issue #74]'s high-tier dedupe test flips this without a reload so
        // pose/world/time-of-day stay bit-for-bit identical across the off/on capture).
        if (typeof window !== 'undefined') /** @type {any} */ (window).__hdr_rtt = hdr_tex
      }
      bloom_node = bloom(hdr_tex, cfg.bloom.strength, cfg.bloom.radius, cfg.bloom.threshold)
      col = hdr_tex.rgb.add(bloom_node.rgb) // BloomNode outputs vec4 — add only rgb (keep col a vec3)
    }

    // ── tonemap ONCE (§D note): linear HDR → AgX → sRGB. Everything after is display space.
    const ldr = renderOutput(vec4(col, 1), AgXToneMapping, SRGBColorSpace)

    // ── low-freq luma (§H): the tonemapped chain re-rendered at 96×54 (trivial — the whole chain at
    // 5k pixels) and bilinearly upsampled = regional luminance for the plane-separation grade.
    const low_freq = rtt(ldr, LF_W, LF_H)
    meter_rt = low_freq.renderTarget // AUTO-EXPOSURE metering source (readback in renderer.js)
    const graded = atmo.grade.apply(ldr.rgb, luminance(low_freq.rgb))
    /** @type {*} */ let out = vec4(graded, 1)

    // ── OUTPUT EFFECT HOOK (ENG-8 camera motion blur) ── final additive wrap in display space. The
    // effect samples this graded frame with velocity offsets, so it MUST run last (after grade/AgX) —
    // a screen-space smear of the finished image. Reconstruction handles are shared so the effect's
    // ray math matches the clouds/fog/godrays (quad-camera trap). No effect ⇒ `out` unchanged.
    if (output_effect) {
      out = output_effect.build(out, {
        scene_depth,
        u_proj_inv,
        u_cam_world,
        u_cam_pos,
      })
    }

    // ── S-43 SHARPEN (flag-gated, default OFF): FSR1 RCAS as the VERY LAST pass, on the finished
    // display-space image — exactly where FSR runs its sharpen. It bakes `out` to one texture and
    // applies a 5-tap contrast-limited sharpen, recovering the perceived detail a taau_scale bilinear
    // upscale softens. Contrast-limited ⇒ no ringing on the crisp full-res post (bloom halos, UI-free
    // terrain edges). Off ⇒ `out` untouched (byte-identical). One rtt + one dependent tap.
    if (sharpen_amount != null) out = vec4(sharpen(out, u_sharpness).rgb, 1)

    // POST-AgX DISPLAY-SPACE OVERLAYS (composited AFTER the tonemap/grade so the night auto-exposure swing
    // never touches them, and AFTER the low_freq meter above so highlights never feed the exposure servo).
    // Board highlights FIRST (floor UI), fight VFX OVER them (bursts read on top of the ground washes).
    out = highlight_overlay.composite(out)
    out = vfx_overlay.composite(out)
    lens_dry = lens_water.apply(out, false)
    lens_wet = lens_water.apply(out, true)
    return lens_wet
  }

  const select_lens_output = () => {
    const next = lens_water.intensity.value > 0 ? lens_wet : lens_dry
    if (!next || pipeline.outputNode === next) return
    pipeline.outputNode = next
    pipeline.needsUpdate = true
  }

  // Boot mount. When the S-43 godrays flag is on but its shadow map is not yet allocated, this first
  // build omits godrays; try_mount_godrays() re-runs build_output() once the map appears (deferred remount).
  pipeline.outputNode = build_output()
  pipeline.needsUpdate = true
  let godrays_mounted = godrays_ready_now()

  /**
   * S-43 GODRAYS deferred mount: if the flag is on and the sun's shadow map has since been allocated
   * (first shadow caster rendered), rebuild the output graph WITH godrays and recompile the pipeline —
   * ONCE. No-op when godrays is off, already mounted, or the map is still null. Called per-frame by
   * renderer.js's render_frame until it succeeds. @returns {boolean} whether godrays is mounted.
   */
  const try_mount_godrays = () => {
    if (godrays_mounted || !godrays_light) return godrays_mounted
    if (!godrays_ready_now()) return false
    pipeline.outputNode = build_output()
    pipeline.needsUpdate = true
    lens_warm_pending = true
    godrays_mounted = true
    return true
  }

  /** @param {import('three').PerspectiveCamera} active_camera @param {number} [speed] horizontal player
   *  ground speed (m/s), forwarded to the output effect (ENG-8 motion blur's run-speed trigger) — the
   *  same per-frame idiom as the sky/underwater uniforms above. Optional; 0 is a safe default. */
  const update = (active_camera, speed = 0) => {
    u_proj_inv.value.copy(active_camera.projectionMatrixInverse)
    u_cam_world.value.copy(active_camera.matrixWorld)
    u_cam_pos.value.copy(active_camera.position)
    // HALF-RES POST (medium): apply the live bloom-pyramid scale. Off / high-ultra ⇒ three's 0.5
    // (byte-identical). setResolutionScale only sets a field; BloomNode.updateBefore resizes its RTs to
    // the new scale (once, on change) — a no-op when the scale is unchanged, so this is free per frame.
    if (is_medium_tier && bloom_node) {
      bloom_node.setResolutionScale(half_res_post.enabled ? half_res_post.bloom_scale : BLOOM_DEFAULT_SCALE)
    }
    // HALF-RES CLOUDS (medium): same live-knob idiom — RTTNode auto-resizes on a scale change
    // (updateBefore), a no-op when unchanged. Live-disabled ⇒ the deck evaluates at FULL res through
    // the same rtt (one extra blit vs the ?halfpost=0 boot-inline graph; visually the full-res deck).
    // The textureNeedsUpdate re-arm is the ONCE-PER-FRAME dedupe trigger (autoUpdate=false, see
    // build_output): the FIRST consumer pass this frame renders the rtt, later consumers sample it.
    if (cloud_rtt) {
      cloud_rtt.setResolutionScale(half_res_post.enabled ? half_res_post.cloud_scale : 1)
      cloud_rtt.textureNeedsUpdate = true
    }
    if (hdr_rtt) hdr_rtt.textureNeedsUpdate = true
    // S-43 SHARPEN: pull the live RCAS strength from the window knob (a no-op when unchanged). Off ⇒ skip.
    if (sharpen_amount != null && typeof window !== 'undefined') {
      const s = /** @type {any} */ (window).__sharpen
      if (s && typeof s.sharpness === 'number') u_sharpness.value = s.sharpness
    }
    // S-43 GODRAYS: refresh the coupled sun each frame — direction + radiance (already color×intensity
    // combined, see atmosphere.js) — the SAME uniforms sky/clouds/froxels share, so shafts never disagree
    // with the rest of the atmosphere. Optional chain: no-ops until the deferred shadow-map mount builds
    // god_rays, and tolerates a bare-bones atmo test double missing sun_direction/sun_radiance.
    god_rays?.update({
      sun_direction: atmo.sun_direction?.value?.toArray(),
      sun_color: atmo.sun_radiance?.value?.toArray(),
    })
    // Refresh the output effect's uniforms (motion blur: capture this frame's view-projection for the
    // NEXT frame's reprojection). Runs after the reconstruction uniforms are copied above so it can
    // read them for the current frame. update() copies u_proj_inv/u_cam_world just above. [ENG camera-
    // feel] `speed` forwards the player's run-speed trigger (0 default ⇒ untouched for any caller that
    // doesn't thread it).
    output_effect?.update(active_camera, speed)
    lens_water.update()
    if (underwater?.just_exited?.()) lens_water.splash()
    if (!lens_warm_pending) select_lens_output()
  }

  return {
    pipeline,
    update,
    try_mount_godrays,
    render_frame: () => {
      pipeline.render()
      if (!lens_warm_pending) return
      lens_warm_pending = false
      select_lens_output()
    },
    // [D221 depthStencil-format fix, 2026-07-12] Async-warm the scene-pass pipelines (terrain / water /
    // far-field / entity GLB — all MeshStandardNodeMaterial) against the PASS's OWN render target, whose
    // depth attachment is real (this pass renders every frame). PassNode.compileAsync binds that target +
    // MRT before compiling, so the pipeline descriptor carries the pass's depth format. A BARE
    // renderer.compileAsync(scene, camera) instead compiles against the renderer's framebuffer target
    // (AgX tone-mapping ⇒ needsFrameBufferTarget), which the outputColorTransform=false pipeline NEVER
    // renders into ⇒ its depth texture is never GPU-initialised ⇒ getCurrentDepthStencilFormat → undefined
    // ⇒ "Async render pipeline creation failed … depthStencil.format undefined" (the reported boot flood).
    compile: (/** @type {*} */ renderer) => scene_pass.compileAsync(renderer),
    bloom_node: () => bloom_node,
    /** @returns {import('three').RenderTarget | null} the low_freq LDR target for auto-exposure metering. */
    meter_target: () => meter_rt,
    underwater: underwater ?? null,
    dispose() {
      bloom_node?.dispose?.()
      cloud_rtt?.renderTarget?.dispose?.()
      god_rays?.dispose?.()
      lens_water.dispose()
      vfx_overlay.dispose()
      highlight_overlay.dispose()
      scene_pass.dispose?.()
    },
  }
}
