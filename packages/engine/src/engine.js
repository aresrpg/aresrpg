// Public facade (§3.1) — FROZEN SHAPE, M0 implementation. This is the ONLY entry point
// downstream code (the demo app, and eventually packages/frontend's World tab) imports.
//
// M0 wiring: renderer (reversed-Z/fallback/device-loss) + frame_loop (fixed-step sim + rAF
// render) + a fly camera + the RENDER↔CORE SEAM (create_terrain_renderer from WS3/WS4) loaded
// synchronously with the 7×7 test island (§brief — worker pool wiring exists and is unit-tested,
// but M0 doesn't route the demo through it yet; that's M1's streaming ring manager).

import { Euler, Vector3 } from 'three'

import { LOAD_RADIUS_CHUNKS, TIER_LOAD_RADIUS, MASTER_SEED, WORLD_HEIGHT } from './config/world_config.js'
import { get_block_by_name } from './config/block_registry.js'
import { compute_underwater_state, water_surface_plane } from './render/lighting/underwater.js'
import { create_camera_shake } from './render/lighting/camera_shake.js'
import { create_fly_camera } from './core/fly_camera.js'
import { create_frame_loop } from './core/frame_loop.js'
import { create_cpu_probe, create_hitch_probe, url_flag_on, url_switch_on } from './core/hitch_probe.js'
import { adopt_async_resource, flush_live_callbacks } from './core/async_lifecycle.js'
import { create_governor } from './core/quality/governor.js'
import { detect_starting_tier } from './core/quality/detect.js'
import { TIER_ORDER, get_tier } from './core/quality/tiers.js'
import { create_renderer } from './core/renderer.js'
import { load_synthetic_chunks } from './core/island_loader.js'
import { create_ring_manager, world_to_chunk_coord, VERTICAL_CHUNKS } from './core/ring_manager.js'
import { create_worker_pool, default_worker_count, mesh_worker_count } from './workers/pool.js'
import { MSG_FAR_SECTION_REQUEST, MSG_GEN_CONFIG } from './workers/rpc.js'
import { create_terrain_renderer } from './render/pool_renderer.js'
import { dispose_terrain } from './render/dispose_terrain.js'
// D167-B: the tactical fight-board's feathered-occlusion uniforms (world geometry between the camera and
// a mounted board dissolves with a soft feather). Created once here, threaded into every terrain-class
// material, exposed via get_board_occlusion for the tactical facade to arm/disarm. Inert until armed.
import { create_board_occlusion } from './tactical/board_occlusion.js'
import { create_far_field } from './render/far_field.js'
// [C1 SLICED COMPILE] frame-budgeted warm for late-arriving GLB pipelines (entities/avatars/cosmetics):
// ≤1 rig renders epsilon-scaled per frame so its scene+shadow pipelines compile through the REAL render
// path (the only warm that works — see the D221/D1 notes below), never as a first-visible-use sync stall.
import {
  clear_active_pipeline_warm_queue,
  create_pipeline_warm_queue,
  set_active_pipeline_warm_queue,
} from './render/pipeline_warm_queue.js'
import { create_materialization_floor } from './render/materialization_floor.js'
import { create_reveal_front } from './render/reveal_front.js'
import { create_far_streamer, DEFAULT_FAR_RADIUS_M } from './lod/far_streamer.js'
// ENG-20: the WebGL fallback boot path (a minimal three-core heightmap renderer, NO TSL) + the pure
// backend-selection gate. When WebGPU is unavailable (or ?force_webgl=1) create_engine forks to
// create_webgl_fallback INSTEAD of the WebGPU stack below — see the fork at the top of create_engine.
import { create_webgl_fallback, webgpu_only_stubs } from './render/webgl_fallback.js'
import { pick_renderer_backend } from './core/quality/backend.js'
// ENG-18 WORLD BORDER: the mana-barrier renderer (the visible wall) + the pure border MATH (bounds
// soft-clamp + proximity signal). The engine arms the barrier from the zone bounds (fixed mode auto-arms
// on boot; the dapp can also call set_zone_bounds directly) and funnels every camera move through the
// clamp so nothing leaves the zone.
import { create_mana_barrier } from './render/mana_barrier.js'
import { configure_water_optics, configure_water_night_floor, sky_day_factor } from './render/water_material.js'
import { configure_night_lighting } from './render/lighting/sky_light_coupling.js'
import { create_mood_driver } from './render/biome_mood.js'
import { create_ambience } from './render/ambience.js'
import { create_waterfall_system } from './render/waterfall_sheet.js'
import { set_far_textures } from './lod/colors.js'
import { find_open_spawn } from './player/spawn.js'
import { world_surface_y, world_biome_at, world_fall_spans, set_gen_config } from './gen/world_gen.js'
import { DEFAULT_WORLD_GEN_CONFIG, validate_world_gen_config } from './config/world_gen_config.js'
import { border_proximity, clamp_to_bounds, is_valid_bounds } from './core/zone_border.js'
import { SEA_LEVEL } from './config/world_config.js'

// Config-first world selection (BIOMES plan Phase 0). Re-exported from the engine's public entry so
// the frontend embed can resolve `?biome=` → a world recipe and pass it to create_engine, without
// reaching past the package's `.` export. DEFAULT_WORLD_GEN_CONFIG re-exports the local import binding.
export { WORLD_CONFIGS, WORLD_NAMES, world_config_for_biome } from './config/worlds/index.js'
// HUD MINIMAP TAP (frontend Cube-World minimap): the pure per-column {height, map-colour} probe — analytic,
// no chunk residency, colour from the far-LOD `get_map_color` SSOT. Re-exported from the `.` entry so the
// dapp reaches it beside create_engine (the exports map is frozen this lane; engine.js is the one home).
// world_region_at: the dominant sub-biome REGION name probe (per-region zone music `${world}:${region}`).
export { world_minimap_column, world_region_at } from './gen/world_gen.js'
export { DEFAULT_WORLD_GEN_CONFIG }

// S-17a ON-CHAIN WORLD BINDING SEAMS — re-exported from the engine's `.` entry so the app reaches them
// alongside create_engine (the package.json exports map is frozen this lane; engine.js is the one home).
// Y-oracle (§4), deterministic board-from-anchor (§7), gather glow/affordance feed (§5/§6), phase-out
// visibility registry (§7), pure compass/zone view (§5). Detail + the portable derivation: src/binding/.
export {
  ground_height,
  board_spec_for_anchor,
  board_seed_from_anchor,
  voids_from_shape_mask,
  create_gather_feed,
  create_entity_visibility,
  zone_state_view,
  world_from_template,
  mob_group_placement,
  mob_roam_offset,
  mob_aging_fraction,
  resolve_headgear,
} from './binding/index.js'

/** [D206] REAL voxel chunks loaded beyond the playable fence (at least 2) — the world doesn't
 *  visually end at the barrier; the LOD shell starts past these. */
const BORDER_MARGIN_CHUNKS = 2

/** [D194/D210] the border box = the EXACT chunk extent around the floor-divided centre chunk — the
 *  single source the fence/clamp/wall derive from (chunk truth; never mid-terrain).
 *  @param {[number, number]} zone_origin @param {number} zone_size_m
 *  @returns {{ min_x: number, min_z: number, max_x: number, max_z: number }} */
export function zone_bounds_for(zone_origin, zone_size_m) {
  const half = Math.ceil(zone_size_m / 2 / 32)
  const ccx = Math.floor(zone_origin[0] / 32)
  const ccz = Math.floor(zone_origin[1] / 32)
  return {
    min_x: (ccx - half) * 32,
    min_z: (ccz - half) * 32,
    max_x: (ccx + half + 1) * 32,
    max_z: (ccz + half + 1) * 32,
  }
}

// GPU-upload byte budget is no longer a fixed constant here: the ring's drain_uploads() computes it
// ADAPTIVELY from pending depth (UPLOAD_BUDGET_STEPS × DENSE_CHUNK_BYTES in world_config) so uploads
// keep pace with the adaptive mesh rate — idle ring ~3 chunks/frame, deep backlog up to 10. (2026-07-03)

/** Reused scratch for the per-frame camera-forward read (getWorldDirection) — feeds the ring's
 *  forward-bias priority without allocating a Vector3 every frame. */
const cam_forward = new Vector3()

/** ENG-13: the water block id, resolved once — the underwater detection samples the resident store for
 *  this id at the camera eye each frame. */
const WATER_BLOCK_ID = /** @type {number} */ (get_block_by_name('water')?.id)

/** FIRST-LOAD analytic ground: the solid block id sample_block_analytic returns below the generator's
 *  analytic surface for a not-yet-streamed chunk (any solid id works — the controller only reads its
 *  solidity class; stone is the neutral subsurface pick). Resolved once. */
const ANALYTIC_GROUND_ID = /** @type {number} */ (get_block_by_name('stone')?.id ?? 1)

/** @typedef {import('./core/quality/tiers.js').TierName} TierName */

/**
 * @typedef {object} EngineOptions
 * @property {HTMLCanvasElement} canvas target canvas — engine owns its GPU device/context
 * @property {string} [seed] world seed; defaults to the hardcoded master seed (§10.5)
 * @property {TierName} [tier] initial quality tier; omit to run adapter+benchmark autodetect (§5.2)
 * @property {number} [load_radius] horizontal streaming view radius in chunks. Omit to use the
 *   canonical LOAD_RADIUS_CHUNKS (world_config — the SINGLE SOURCE OF TRUTH for view distance).
 *   BENCH-ONLY override (demo `?load_radius=N`) so the D33 A/B sweep can compare r5/6/7/8 against
 *   the shipped default without re-editing source; the fog wall auto-tracks it (ring.fog_far_ceiling_m
 *   → renderer.set_fog_far_ceiling). Never set from real product code.
 * @property {number} [synthetic_chunks] BENCH-ONLY hook (§7/§8): when set, replaces the 7×7 test
 *   island with exactly this many ring/grid-laid-out test chunks (see core/island_loader.js
 *   `load_synthetic_chunks`) — drives bench/synthetic-2000.spec.js's ≥4.6k bundled-draw scenario.
 *   Never set this from real product code; it exists only for demo/main.js's `?synthetic_chunks=N`
 *   query-param passthrough.
 * @property {number} [zone_size_m] [D183] fixed-mode ONLY: zone size in meters (default 600, D205). The app's
 *   logged-out login backdrop passes a small value (e.g. 96) for a fast lite boot; chunk work scales
 *   quadratically, so 96 m ≈ a tenth of the default boot.
 * @property {[number, number]} [zone_origin] fixed-mode ONLY: world-space [x, z] METERS the resident
 *   zone is centred on (default [0, 0]). Ignored in streaming mode.
 * @property {boolean} [force_webgl] ENG-20: force the minimal WebGL fallback path (a colored heightmap
 *   of basic blocks, no TSL/post/atmosphere) even when WebGPU is available — the demo's `?force_webgl=1`
 *   test lever. Auto-detection (navigator.gpu absent → webgl) applies regardless of this flag.
 */

/**
 * @typedef {object} EngineStats
 * @property {number} fps rolling frames-per-second
 * @property {number} frame_ms_p50
 * @property {number} frame_ms_p75
 * @property {number} frame_ms_p99
 * @property {number} draw_calls
 * @property {number} quad_count total live quads across uploaded chunks
 * @property {TierName} tier current active tier (post-governor)
 * @property {number} render_scale current dynamic render-resolution scale
 * @property {number} time_of_day DAY-NIGHT: the sky's live cycle phase in [0,1) (0 pre-boot/no sky) — the
 *   §7 HUD feed for the day-night dial; also the ENGINE→UI readback a GUI panel polls to resync a local
 *   tod value after a DIRECT set_time_of_day call bypasses it (demo main.js STALE-GUI fix, 2026-07-19).
 * @property {number} chunk_queue_depth pending gen+mesh jobs
 * @property {number} far_section_count resident far-shell sections rendered to the horizon (NG-LOD
 *   phase B); 0 when the far shell is inactive (synthetic bench path)
 * @property {number} far_section_bytes total resident far-shell geometry bytes (memory readout)
 * @property {number} [border_proximity] ENG-18: distance-based world-border proximity 0→1 (0 far inside,
 *   1 at/past the wall). The dapp drives its spatial-audio boundary hum off this (the engine ships no
 *   audio). 0 when no border is armed.
 * @property {number} vram_estimate_bytes
 * @property {[number, number, number]} camera_position world-space camera position, rounded to
 *   integer meters (UX readout — demo HUD "xyz" line)
 * @property {[number, number]} camera_yaw_pitch [yaw, pitch] in radians, 2 dp
 * @property {'webgl' | 'webgpu'} renderer_backend ENG-20: which renderer is live — 'webgpu' (the full
 *   TSL stack) or 'webgl' (the minimal heightmap fallback booted when WebGPU is unavailable).
 */

/** @typedef {'tier_change'|'chunk_loaded'|'chunk_unloaded'|'device_lost'|'device_restored'|'stats'|'boot_error'|'load_progress'} EngineEvent */

/**
 * @typedef {object} EngineApi
 * @property {() => void} start begins the frame loop (rAF render + fixed-timestep sim)
 * @property {() => void} stop halts the frame loop; GPU resources remain allocated
 * @property {(tier: TierName) => void} set_tier manual tier override (disables auto-governor
 *   until `set_tier(undefined)` or a future `enable_auto_tier()` call — see engine.js WS1 impl)
 * @property {(phase: number) => void} set_time_of_day phase in [0,1), 0 = dawn (§6.1)
 * @property {() => number} day_factor live day/night light level (1 daylight → 0 below horizon) — the frontend gather props read it to darken at night (one lighting home)
 * @property {(cfg?: { moon_mul?: number, ambient_night_floor?: number, water_night_floor?: number }) => void} configure_night_lighting live-retune the whole night look — moon-key + ambient-floor (terrain) + water reflection floor — ONE call
 * @property {(position: [number, number, number]) => void} set_camera_position world-space meters
 * @property {(yaw: number, pitch: number) => void} set_camera_orientation radians
 * @property {(magnitude: number) => void} shake_camera [D248] fire a decaying impact camera shake (0.10 light / 0.20 std / 0.5+ crit); no-op at rest.
 * @property {(on: boolean) => void} set_motion_blur_enabled [D251-2] runtime toggle for the camera-rotation blur (dapp kills it in fights); no-op if uncreated.
 * @property {(fov_degrees: number) => void} set_camera_fov vertical field-of-view in degrees; the
 *   walk-mode shoulder camera widens this dynamically with speed (dapp feel). No-op pre-boot.
 * @property {(speed: number) => void} set_camera_speed [ENG camera-feel] horizontal player ground speed
 *   (m/s) — the same value the app feeds the shoulder camera's speed-FOV; forwarded to the post stack's
 *   motion-blur run-speed trigger (vignette blur while running). Safe pre-boot (cached, applied on boot).
 * @property {(x: number, y: number, z: number) => number} sample_block block id at a WORLD-space
 *   voxel coordinate, read from the resident chunk store (ring_manager.block_id_at). 0 (air) when
 *   out of bounds, unstreamed, or in the synthetic bench path. This is the CHARACTER CONTROLLER's
 *   collision query surface (ENG-8) — fast, allocation-free; the player never reaches an unstreamed
 *   chunk since the ring loads around them.
 * @property {(x: number, y: number, z: number) => number} sample_block_analytic [FIRST-LOAD] like
 *   sample_block, but a NOT-yet-streamed chunk falls back to the generator's ANALYTIC surface as solid
 *   ground (solid below world_surface_y, air above) instead of air — so the player can walk at t≈0
 *   while the world streams in. Resident chunks return voxel truth (caves stay caves). The app's roam
 *   sampler composes this; voxel truth takes over as chunks land (under-map rescue nets the handoff).
 * @property {(x: number, z: number) => boolean} is_column_resident true when the chunk containing this
 *   column's generated ground is resident and collision-ready. Generated/store resident is sufficient;
 *   unrelated sky/bedrock layers and GPU upload are deliberately not part of physics readiness.
 * @property {(object3d: import('three').Object3D) => void} add_to_scene adds an Object3D (the player
 *   avatar GLB, ENG-8) to the render scene. Additive to the terrain scene; caller owns the object.
 * @property {(object3d: import('three').Object3D) => void} remove_from_scene removes a previously
 *   added Object3D from the scene.
 * @property {() => import('three').Scene | null} get_scene the live render scene (null pre-boot) —
 *   for advanced avatar wiring (shadow flags). Prefer add_to_scene/remove_from_scene.
 * @property {() => import('three').PerspectiveCamera | null} get_camera the live render camera (null
 *   pre-boot). ENG-16 tactical board reads it for picking rays + float billboarding; it is NOT in the
 *   scene graph (renderer owns it standalone), so get_scene() cannot reach it. Read-only.
 * @property {() => import('./render/pool_renderer.js').TerrainRenderer | null} get_terrain_renderer
 *   the RENDER↔CORE seam (upload_chunk/remove_chunk), null pre-boot. D141: a standalone chunk set (the
 *   cave dungeon room) uploads meshed chunks straight into this pool, bypassing the streaming ring.
 * @property {() => import('./render/atmosphere.js').Atmosphere | null} get_atmosphere the NG2-ATMO
 *   handle, null pre-boot or when tier/degradation left it off. D141: the cave room feeds its records to
 *   atmo.set_resident_provider so ceiling holes cast froxel god-ray shafts. Read-only.
 * @property {(params: Partial<import('./render/sky_hillaire/atmosphere_params.js').AtmosphereParams>) => void} set_atmosphere_params
 *   [C9] retune the physical (Hillaire) atmosphere live — Earth defaults now; the biome/world mood system
 *   feeds alternate sets (Mars-class, tiny-planet) later. No-op at LOW tier (the analytic-sky ladder rung).
 * @property {() => import('./tactical/board_occlusion.js').BoardOcclusionUniforms} get_board_occlusion
 *   D167-B: the tactical fight-board feathered-occlusion uniforms (set_bounds / set_active). Non-null
 *   even pre-boot (created eagerly). The tactical facade arms it on board mount, disarms on unmount; the
 *   terrain materials read it each frame (inert until armed → zero cost with no board).
 * @property {(scale: number) => void} set_render_scale manual render-resolution scale, clamped to
 *   [0.5, 1.0]. 1.0 = native (the default). This is the MANUAL RELIEF LEVER for fill-bound
 *   frames (native 5K on the Studio is ~14.7 Mpx) until the M3 governor drives it automatically. It
 *   scales the renderer's pixel ratio through three's `setSize` path, so it respects renderer.js's
 *   single-owner resize law (no direct canvas.width/height mutation, no depth/swapchain desync).
 * @property {(paused: boolean) => void} set_streaming_paused [D213] freeze/resume the overworld ring
 *   (cave scenes pause it — only the room generates; resident chunks stay warm for the exit).
 * @property {(near_m: number, far_m: number) => void} set_far_fog [D213] retune the aerial fog RANGE band.
 * @property {(scale: number) => void} set_fog_scale [D213-B] master scene-fog gate (0 = no aerial fog —
 *   enclosed scenes; the height term is range-immune so set_far_fog alone cannot silence it).
 * @property {() => 'streaming'} get_world_mode [D210] always 'streaming' — ONE world model (compat shim)
 *   (the demo default, camera-centred lazy ring) or 'fixed' (the D142 fixed 300 m zone — fully resident,
 *   no streaming during play). The dapp reads this to know whether to show a boot loading screen.
 * @property {() => { min_x: number, min_z: number, max_x: number, max_z: number } | null} get_zone_bounds
 *   ENG-19 fixed mode: the world-space METER extents of the resident zone (the ENG-18 border soft-clamps
 *   the player inside these). An explicit set_zone_bounds wins; else the fixed orchestrator's; else null.
 * @property {(bounds: { min_x: number, min_z: number, max_x: number, max_z: number }) => void} set_zone_bounds
 *   ENG-18 WORLD BORDER: arm/re-arm the border for a zone — the camera soft-clamps inside these extents
 *   and the translucent mana barrier draws their perimeter. Ignores a malformed box. Any world_mode; fixed
 *   mode ALSO auto-arms from its own bounds on boot. The dapp calls this to place the boundary.
 * @property {() => void} clear_zone_bounds ENG-18: tear the border down (no clamp, no wall).
 * @property {(text: string | null) => void} set_border_banner ENG-18: the floating holo-text repeated
 *   along the wall at eye level. The dapp passes the ALREADY-COMPOSED, i18n-resolved string (the engine
 *   ships zero i18n — same contract as the tactical board floats). null clears the banners.
 * @property {() => EngineStats} get_stats snapshot of current perf/scene counters (§7 HUD feed)
 * @property {() => { drawn: number, marked: number, mismatches: { cx: number, cz: number, mask: number }[] }} _far_mask_debug
 * @property {() => { ids: string[], queue_depth: number, near_ring_m: number }} _far_debug TEMP DEBUG
 *   (2026-07-04 far-pop diagnosis): resident far-section ids + queue depth for frame-to-frame diffing.
 *   TEST-ONLY (night_watch traverse oracle, 2026-07-04): cross-checks the far residency mask against the
 *   columns terrain_renderer is actually DRAWING. For every drawn column it reads the mask byte via
 *   far_field._mask_value_at; a drawn column whose mask ≠ 255 (inside the window) is a MISMATCH — the far
 *   shell would draw over drawn near terrain there (the traveled-session "sheet"). `drawn` = drawn-column
 *   count, `marked` = mask bytes set to 255 in the window, `mismatches` = the offending columns (empty =
 *   pixel-clean mask). Returns all-zero when far shell is off or pre-boot.
 * @property {() => void} dispose releases GPU device, terminates worker pools, detaches listeners
 * @property {(event: EngineEvent, callback: (payload: unknown) => void) => () => void} on
 *   subscribes to an engine event; returns an unsubscribe function. `'boot_error'` fires with the
 *   thrown Error if async init (adapter request, device create, shader compile, …) rejects —
 *   §10.1 capability-gate surface; `start()` never lets that rejection go unhandled (see below).
 */

/**
 * Creates the AresRPG voxel engine instance bound to a canvas. This is the ONLY factory —
 * every other module in this package is implementation detail reached through the returned
 * api surface (or, pre-M4, through direct imports for testing individual workstreams).
 *
 * Async internals (renderer init, adapter detect) are kicked off synchronously and awaited
 * lazily by `start()` — `create_engine` itself stays synchronous per the frozen signature.
 *
 * @param {EngineOptions} options
 * @returns {EngineApi}
 */
export function create_engine({
  canvas,
  seed = MASTER_SEED,
  // Config-first world selection (BIOMES plan Phase 0): the ENTIRE gen recipe (seed + climate fields +
  // splines + density + sky). Defaults to today's world. The frontend resolves `?biome=` → one of the
  // WORLD_CONFIGS and passes it here; `world_config.seed` supersedes the legacy `seed` param for gen.
  world_config = DEFAULT_WORLD_GEN_CONFIG,
  tier,
  synthetic_chunks,
  // [S-85] The near full-voxel ring radius is now TIER-DRIVEN (world_config.TIER_LOAD_RADIUS): the
  // boot tier picks LOW 4 / MEDIUM 7 / HIGH 8. Captured RAW here so the body can tell an explicit
  // caller override (the demo `?load_radius=N` A/B bench, or spectate's r4 diorama — both still win)
  // from the default; the real value is resolved below (once the boot tier is known — it's async when
  // auto-detected). Falls back to the world recipe's `lod` block, then LOAD_RADIUS_CHUNKS.
  load_radius: load_radius_arg,

  zone_origin = [0, 0],
  // [D183] LITE BOOT for a lightweight login-card backdrop: a smaller fixed zone (e.g.
  // 96) boots in a fraction of the 300 m default (chunk count scales quadratically: 96 m ≈ 1/10th the
  // work). The app's logged-out backdrop passes this; login swaps to a full-size engine instance.
  zone_size_m = 600, // [D205/D210] playable side — defines the BORDER BOX ONLY (the world streams around the player; the fence is what makes it finite)
  force_webgl = false,
}) {
  if (!canvas) throw new TypeError('create_engine: options.canvas is required')
  if (tier !== undefined && !TIER_ORDER.includes(tier)) {
    throw new TypeError(`create_engine: unknown tier "${tier}" — expected one of ${TIER_ORDER.join(', ')}`)
  }
  // ENGINE_AAA_PLAN C4: procedural trees are now the DEFAULT (trees.procedural true). `?proctrees` stays as
  // the escape/kill-flag A/B: `?proctrees=0` forces procedural OFF (a rock-only world — the perf isolation),
  // any other value forces it ON. Injected HERE (page context) so it reaches BOTH main-thread gen
  // (set_gen_config below) and the gen worker payload (posted below); absent ⇒ the recipe's own
  // trees.procedural (DEFAULT true). NOTE: the escape yields no legacy trees — the schematic stamps are retired.
  if (typeof location !== 'undefined') {
    const url_params = new URLSearchParams(location.search)
    const proctrees_param = url_params.get('proctrees')
    if (proctrees_param !== null) {
      world_config = { ...world_config, trees: { ...world_config.trees, procedural: proctrees_param !== '0' } }
    }
    // GEN_VERSION 9 bake-then-stamp escape/A-B: `?baketrees=N` overrides trees.baked_variants (0 = the old
    // every-tree-unique per-column synthesis; DEFAULT recipe ships 32). Same page-context injection as
    // ?proctrees so main-thread gen and the gen/far workers derive the SAME world. Validated below.
    const baketrees_param = url_params.get('baketrees')
    if (baketrees_param !== null) {
      world_config = { ...world_config, trees: { ...world_config.trees, baked_variants: Number(baketrees_param) } }
    }
  }
  // Config-first world selection: validate the recipe up front and REFUSE loudly on an invalid one — a
  // bad admin/URL config must fail fast, never silently generate a broken world (§3, no-silent-failure).
  const gen_validation = validate_world_gen_config(world_config)
  if (!gen_validation.ok) {
    throw new TypeError(`create_engine: invalid world_config — ${gen_validation.errors.join('; ')}`)
  }
  // Thread the recipe into MAIN-THREAD gen (world_surface_y: spawn scan, atmosphere fog height, border
  // wall probes) so the main thread and the gen workers (wired via the pool init_message below) derive
  // the SAME world. `gen_seed` also seeds the far-shell + webgl paths so every gen surface is coherent.
  set_gen_config(world_config)
  // FIVE-WORLDS: thread the recipe's per-config WATER OPTICS into the render-side water material (visual-
  // only, no gen surface). Default recipe == the live constants ⇒ byte-identical DEFAULT water.
  configure_water_optics(world_config.water)
  // NIGHT LIGHTING (moonlit terrain reads pitch-black — a per-world TASTE dial). Thread the
  // recipe's optional `night` block (moon_mul / ambient_night_floor / water_night_floor) into BOTH the terrain
  // coupling and the water reflection floor — ONE config home (`world_config.night`) for the whole night look,
  // even though each self-contained module owns its own dial. Absent ⇒ the shipped default consts ("Night
  // Look A": moon_mul 0.26 / ambient_night_floor 0.5 / water_night_floor 0.17).
  configure_night_lighting(world_config.night)
  configure_water_night_floor(world_config.night)
  // FIVE-WORLDS: point the LOD far-shell colour derivation at the world's texture palette so the horizon
  // reads the SAME per-biome bake as the near atlas (below). Absent ⇒ the default average (parity).
  set_far_textures(world_config.textures)
  const gen_seed = world_config.seed
  // §P1 CONFIG-FIRST LOD: far-shell outer reach from the recipe's `lod` block (render-only), fallback
  // to the constant for pre-P1 blobs. Feeds create_far_streamer + the aerial fog far band below.
  const far_radius_m = world_config.lod?.far_radius_m ?? DEFAULT_FAR_RADIUS_M

  // ENG-20 WEBGL FALLBACK FORK. Pick the backend BEFORE building the WebGPU stack: when WebGPU is
  // unavailable (navigator.gpu absent) or the demo forces it (?force_webgl=1), boot the minimal three-
  // core heightmap renderer (render/webgl_fallback.js) INSTEAD — a colored heightmap of basic blocks,
  // no lighting model / post / atmosphere / TSL. The WebGPU path below is left entirely untouched. The
  // synthetic bench path is WebGPU-only (it drives the pool/mesh render), so it never forks here.
  const backend =
    synthetic_chunks === undefined
      ? pick_renderer_backend({
          navigator_gpu: typeof navigator !== 'undefined' ? navigator.gpu : undefined,
          force_webgl,
        })
      : 'webgpu'
  const engine_search = typeof location === 'undefined' ? '' : location.search
  if (backend === 'webgl') {
    return create_webgl_engine({ canvas, seed: gen_seed, zone_origin, search: engine_search })
  }
  const hitch_enabled = url_flag_on('hitch', engine_search)
  const hitch_probe = create_hitch_probe({ search: engine_search })
  const cpu_probe = create_cpu_probe({ search: engine_search })
  const on_worker_message = hitch_enabled
    ? cpu_probe
      ? (/** @type {unknown} */ payload) => {
          hitch_probe.worker_message(payload)
          cpu_probe.worker_message(payload)
        }
      : hitch_probe.worker_message
    : cpu_probe?.worker_message
  const aerialturn_enabled = url_switch_on('aerialturn', engine_search)
  const gpu_cull_enabled = url_switch_on('gpucull', engine_search)
  const mesh_slice_enabled = url_switch_on('mesh_slice', engine_search)
  const lod_refine_enabled = !url_flag_on('no_lod_refine', engine_search)
  // ENG-19: FIXED MODE pins the ring to the zone centre with a load_radius sized to cover the whole
  // ZONE_SIZE_METERS zone (the demo's `?load_radius=N` bench override is ignored — the zone size is the
  // authority, not the streaming view-distance lever). Synthetic bench path stays streaming (ring null).
  void seed // superseded by world_config.seed (gen_seed) for all gen/far/webgl surfaces; kept for API back-compat.

  /** @type {Map<EngineEvent, Set<(payload: unknown) => void>>} */
  const listeners = new Map()
  /** @param {EngineEvent} event @param {unknown} payload */
  function emit(event, payload) {
    if (disposed) return
    for (const callback of listeners.get(event) ?? []) callback(payload)
  }

  let ready = null
  let disposed = false
  let run_requested = false
  /** D167-B: the tactical feathered-occlusion uniforms — created eagerly (pure uniform objects, no GPU)
   *  so they can be threaded into the terrain materials at boot and toggled by the tactical facade via
   *  get_board_occlusion(). `active` defaults 0 ⇒ every material's fade term folds to a no-op until a
   *  board is mounted (zero cost off). */
  const board_occlusion = create_board_occlusion()
  /** Current manual render-resolution scale in [0.5, 1.0] (default native). Applied to the renderer
   *  pixel ratio via set_render_scale; surfaced on get_stats().render_scale. The M3 governor will
   *  drive this later — for now it's a manual fill-relief lever. */
  let render_scale = 1
  /** @type {import('./core/renderer.js').RendererHandle} */
  let renderer_handle
  /** [C1] the sliced-compile warm queue — created with the renderer, registered module-wide for the GLB
   *  factories (mob_model / character_avatar / worn_cosmetics), ticked once per rendered frame. */
  let pipeline_warm_queue = /** @type {ReturnType<typeof create_pipeline_warm_queue> | null} */ (null)
  /** @type {import('./render/pool_renderer.js').TerrainRenderer} */
  let terrain_renderer
  /** @type {import('./core/frame_loop.js').FrameLoop} */
  let frame_loop
  /** @type {ReturnType<typeof create_governor>} */
  let governor
  /** @type {ReturnType<typeof create_fly_camera>} */
  let fly_camera
  /** [B5] biome-mood crossfader — created only under ?mood=1 (else stays null ⇒ flag-off byte-identity). */
  let mood_driver = /** @type {ReturnType<typeof create_mood_driver> | null} */ (null)
  /** [S-AMBIENCE] per-environment ambient particle director — DEFAULT ON (medium/high draw; LOW is
   *  budget-0 in tiers.js ⇒ off for free). ?ambience=0 escapes (falls/skycouple/sunfollow convention).
   *  Independent of the STILL-disabled legacy weather field at atmosphere.js:726 (TORMENTOR gate — a
   *  different create_particles() instance, never scene-mounted; this flip does not resurrect it). */
  let ambience = /** @type {ReturnType<typeof create_ambience> | null} */ (null)
  /** [B4] waterfall sheet/spray/foam overlay — DEFAULT ON (null under ?falls=0 or no `location` ⇒ off byte-identity). */
  let falls = /** @type {ReturnType<typeof create_waterfall_system> | null} */ (null)
  /** [D185] true once ANY consumer calls set_camera_position/orientation — gates the boot self-rescue. */
  let camera_externally_driven = false
  /** [ENG camera-feel] the last horizontal player ground speed (m/s) pushed via set_camera_speed —
   *  forwarded to render_frame each tick for the motion-blur run-speed trigger. 0 = no run contribution. */
  let live_camera_speed = 0
  /** [D248] triggered impact camera shake — a decaying, non-accumulating offset applied around render. */
  const camera_shake = create_camera_shake()
  /** [D196 — the silent pre-boot no-op class, twice tonight (D177 set_time_of_day, add_to_scene)]:
   *  api calls that need the renderer QUEUE until boot instead of vanishing through optional chaining.
   *  Flushed (in call order) right after init() resolves; nulled afterwards so the guard costs nothing
   *  steady-state. @type {Array<() => void> | null} */
  let pre_boot_queue = []
  /** [D210] one-shot boot signals for the STREAMING world (replaces the fixed orchestrator's). */
  let focus_ready_emitted = false
  let boot_done_emitted = false
  /** [S3 PERF_MOBILE_PLAN 2026-07-14] true once the D221 pipeline pre-warm has SETTLED. Gates the far
   *  streamer (far pipelines must be warm before the first far section renders — the first-LOD sync
   *  compile dies here) and emits the 'visual_ready' load_progress phase. NB the boot veil deliberately
   *  does NOT key on this: the P0-item-14 rule melts it on column-ready (earlier), so the
   *  warm's residual main-thread window stays visible until C1's sliced compile absorbs it — LOW-tier
   *  boots (spectate/mobile) already shrink it via fewer/cheaper pipelines + DPR 1. */
  let prewarm_settled = false
  /** [D213] cto's cave perf seam: while a standalone scene (cave room) owns the view, the overworld
   *  ring must not stream underground chunks around the teleported camera. */
  let streaming_paused = false
  // [S-85] Placeholder view radius: an explicit caller arg wins, else the boot tier's TIER_LOAD_RADIUS
  // (known synchronously when `tier` is passed — the frontend/demo case), else the world recipe / const.
  // init() rewrites this + ring_total below once an AUTO-detected tier resolves (async).
  let load_radius =
    load_radius_arg ??
    (tier && TIER_LOAD_RADIUS[tier]) ??
    world_config.lod?.full_voxel_radius_chunks ??
    LOAD_RADIUS_CHUNKS
  /** Full-ring chunk count for progress totals ((2r+1)² columns × vertical). Tracks the RESOLVED
   *  load_radius (tier-driven, S-85) so boot 'done' fires at the real ring size, not the stale constant. */
  let ring_total = (2 * load_radius + 1) ** 2 * VERTICAL_CHUNKS
  /** Defer `fn` if the renderer isn't up yet (returns true when deferred). @param {() => void} fn */
  function defer_until_boot(fn) {
    if (disposed) return true
    if (renderer_handle) return false
    pre_boot_queue?.push(fn)
    return true
  }
  /** @type {import('./workers/pool.js').WorkerPool | null} */
  let gen_pool = null
  /** @type {import('./workers/pool.js').WorkerPool | null} */
  let mesh_pool = null
  /** @type {import('./core/ring_manager.js').RingManager | null} */
  let ring_manager = null
  /** @type {import('./render/far_field.js').FarField | null} */
  let far_field = null
  /** [FIRST-LOAD] the brand holo "materialization floor" (analytic-height grid over not-yet-drawn columns;
   *  streaming path only). @type {ReturnType<typeof create_materialization_floor> | null} */
  let materialization_floor = null
  /** [FIRST-LOAD] the radial reveal-front uniforms, created eagerly (pure uniforms, no GPU) so they thread
   *  into every terrain material at boot; engine.js drives the radius each frame off the ring fill. */
  const reveal_front = create_reveal_front()
  /** @type {import('./workers/pool.js').WorkerPool | null} */
  let far_pool = null
  /** @type {import('./lod/far_streamer.js').FarStreamer | null} */
  let far_streamer = null
  /** ENG-19: the fixed-world boot orchestrator (null in streaming/synthetic mode). Owns the boot pump
   *  (full-throttle zone residency + static far ring + progress events) and the post-boot dormancy. */
  /** ENG-19: guards the ONE-TIME static residency-mask paint in fixed mode (set after boot; the drawn-
   *  column set is frozen so the mask never needs a per-frame rebuild). */
  /** ENG-18: the mana-barrier renderer (the visible border wall; built in init once the scene exists).
   *  @type {import('./render/mana_barrier.js').ManaBarrier | null} */
  let mana_barrier = null
  /** ENG-18: the ACTIVE zone bounds the camera soft-clamps inside + the barrier draws (null = no border).
   *  In fixed mode this is auto-set from fixed_world on boot; the dapp/demo may also set it explicitly via
   *  set_zone_bounds. @type {import('./core/zone_border.js').ZoneBounds | null} */
  let zone_bounds = null
  /** ENG-18: current border proximity 0→1 (distance-based, for the dapp's spatial-audio hum). Recomputed
   *  each frame from the camera position; surfaced on get_stats().border_proximity. */
  let border_prox = 0
  /** ENG-18: guards the fixed-mode ONE-TIME auto-arm of the border from the zone bounds after boot. */
  let border_auto_armed = false
  /** ENG-13 underwater hysteresis memory — the submerged flag persists across frames so the waterline
   *  dead-band can hold state (no flicker as the eye grazes y == surface). */
  let was_submerged = false

  /** ENG-18: (re)arm the barrier + clamp bounds for a zone (or clear when null). Rebuilds the wall mesh
   *  anchored at the zone ground level (fixed mode probes the resident zone-centre surface; falls back to
   *  sea level). @param {import('./core/zone_border.js').ZoneBounds | null} bounds */
  function arm_border(bounds) {
    zone_bounds = bounds
    if (!bounds) {
      border_prox = 0
      mana_barrier?.set_bounds(null)
      return
    }
    // anchor Y: scan the zone-centre column top-down for the surface (resident in fixed mode); sea level
    // is the valley-floor fallback when the centre isn't resident yet.
    const mid_x = Math.round((bounds.min_x + bounds.max_x) / 2)
    const mid_z = Math.round((bounds.min_z + bounds.max_z) / 2)
    let base_y = SEA_LEVEL
    if (ring_manager) {
      for (let y = 320; y >= 1; y -= 1) {
        if (ring_manager.block_id_at(mid_x, y, mid_z) !== 0) {
          base_y = y
          break
        }
      }
    }
    // [D168-B] Ensures the border sits at ground level via a per-point terrain sampler so the wall FOLLOWS
    // the land along the whole perimeter (one center probe made it float mid-cliff on hills).
    // [D210] the wall's terrain-following probes THE GENERATOR's analytic surface (world_surface_y —
    // pure noise math, no chunk residency): the border arms on frame 1 and hugs the real land even
    // where nothing is streamed yet. (Supersedes the D197 resident-probe + inward clamp — the
    // residency dependency was why the wall could only arm after a full fixed boot.)
    const ground_at = /** @param {number} x @param {number} z */ (x, z) => world_surface_y(Math.round(x), Math.round(z))
    mana_barrier?.set_bounds(bounds, base_y, ground_at)
  }

  async function init() {
    const { tier_name } = tier ? { tier_name: tier } : await detect_starting_tier()
    // dispose() may win while AUTO tier detection is pending. Do not begin GPU allocation for a dead scene.
    if (disposed) return
    // [TTP-init] boot breakdown — every init step below runs BEFORE frame_loop.start(), so ALL of it is on
    // the critical path to the first streamed chunk (focus_ready). Marks let "fastest time to
    // play" be measured, not guessed (renderer vs terrain+ring vs the far-shell/LOD quality layer).
    const __t0 = performance.now()
    let __tr = __t0
    let __tg = __t0

    // [S-85] Now the boot tier is known (it was async for AUTO detect), size the streaming ring to it —
    // unless an explicit load_radius arg pinned it (bench / spectate diorama). Rewrites ring_total so the
    // load-progress bar totals the real ring. The ring manager (built below) reads this radius at construct;
    // a mid-session tier swap keeps the boot radius (no live re-stream) — render_scale still switches live.
    if (load_radius_arg === undefined) {
      load_radius = TIER_LOAD_RADIUS[tier_name] ?? load_radius
      ring_total = (2 * load_radius + 1) ** 2 * VERTICAL_CHUNKS
    }

    /** [D181 P0] Routes to the ENG-20 heightmap fallback to avoid a fully dark screen when disconnected.
     * Shared by BOTH failure shapes: (a) init SUCCEEDS on webgl2 (D155 — probe passed, backend floored),
     * (b) init THROWS (degraded browser: navigator.gpu present but requestAdapter() → null — Chrome
     * silently drops WebGPU for a session after GPU-process churn; three's WebGPUBackend.init throws
     * and the old path emitted boot_error + a BLACK canvas — a dark blank tab).
     * @param {string} why */
    const route_to_webgl_floor = (why) => {
      if (disposed) return
      console.warn(`[voxel] ${why} — rerouting to the WebGL heightmap fallback (D155/D181)`)
      hitch_probe.dispose()
      // The replacement owns a fresh probe. Release the WebGPU probe's observer/global span sink first so
      // scene spans cannot accumulate forever in an orphan that will never receive another frame sample.
      cpu_probe?.dispose()
      // [C1] the warm queue dies with its renderer (pipelines die with the device); unregister so GLB
      // factories fall back to immediate resolves on the WebGL floor (its simple materials need no warm).
      if (pipeline_warm_queue) {
        pipeline_warm_queue.dispose()
        clear_active_pipeline_warm_queue(pipeline_warm_queue)
        pipeline_warm_queue = null
      }
      renderer_handle?.dispose?.()
      renderer_handle = /** @type {*} */ (null)
      // neutralize the outer ready.then(frame_loop.start) chain (no-op FrameLoop shape)
      frame_loop = /** @type {*} */ ({ start() {}, stop() {}, is_running: () => false, get_frame_stats: () => null })
      // FRESH CANVAS (D155 P1): a failed/disposed WebGPU init can leave the canvas context lost.
      const fresh_canvas = /** @type {HTMLCanvasElement} */ (canvas.cloneNode(false))
      canvas.replaceWith(fresh_canvas)
      const fallback = create_webgl_engine({ canvas: fresh_canvas, seed: gen_seed, zone_origin, search: engine_search })
      // PRESERVE THE EMITTER (D155 P1): keep the dapp's original on/emit; bridge fallback events in.
      const original_on = api.on
      Object.assign(api, fallback)
      api.on = original_on
      for (const ev of /** @type {const} */ ([
        'tier_change',
        'chunk_loaded',
        'chunk_unloaded',
        'device_lost',
        'device_restored',
        'stats',
        'boot_error',
        'load_progress',
      ])) {
        fallback.on(ev, (/** @type {unknown} */ payload) => emit(ev, payload))
      }
      fallback.start()
    }

    let created_renderer
    try {
      created_renderer = await create_renderer({
        canvas,
        tier: tier_name, // gates the NG2-ATMO pass budgets (clouds/froxels/godrays) per §5.1
        seed: gen_seed, // per-world night sky (galaxy orientation / planets / star density — night_sky.js)
        on_device_lost: (info) => emit('device_lost', info),
        on_device_restore: (ok) => emit('device_restored', ok), // witness-r4 — the app can now say so, not just log it
        hillaire_rebuild_on_rotate: aerialturn_enabled,
        on_hillaire_aerial: hitch_enabled ? hitch_probe.aerial_dispatched : undefined,
      })
    } catch (error) {
      // A rejected renderer promise can settle after dispose. The dead engine must neither boot a fallback
      // nor emit a late error into listeners owned by the released scene.
      if (disposed) return
      route_to_webgl_floor(`WebGPU init threw (${error instanceof Error ? error.message : error})`)
      return
    }
    if (
      !adopt_async_resource(
        created_renderer,
        () => disposed,
        (handle) => (renderer_handle = handle)
      )
    )
      return

    // [2026-07-05 P0 D155 — REALITY CHECK ON THE ACTUAL BACKEND] The ENG-20 fork above routes on the
    // navigator.gpu PROBE, but three's WebGPURenderer can still fail adapter/device init (embed
    // canvas reuse, remount races, driver denial) and silently fall back to its internal WebGL2
    // backend. The pool renderer is indirect-draw + compute END TO END (quad_pool setIndirect,
    // gpu_cull createIndirectStorageAttribute) — none of it exists on WebGL2, so continuing here
    // threw mid-mesh and the boot pump died ("stuck carving the terrain" — a boot stall). If the
    // constructed renderer is NOT actually WebGPU: dispose it and HOT-SWAP this api's implementation
    // to the ENG-20 heightmap fallback (same object identity — the caller's reference keeps working;
    // create_engine returns sync so a plain return here would be swallowed). Probe optimistic, route
    // by reality.
    if (renderer_handle.backend !== 'webgpu') {
      route_to_webgl_floor(`WebGPU probe passed but the renderer initialized on '${renderer_handle.backend}'`)
      return
    }
    hitch_probe.watch_renderer(renderer_handle.renderer)
    // [C1] arm the sliced-compile warm queue on the live scene; the module registry hands it to the
    // GLB factories (mob_model/character_avatar/worn_cosmetics) so a late-loading rig's pipelines are
    // frame-budget warmed BEFORE its real mount instead of sync-compiling at first visibility.
    pipeline_warm_queue = create_pipeline_warm_queue({
      scene: renderer_handle.scene,
      request_shadow_update: renderer_handle.request_shadow_render,
    })
    set_active_pipeline_warm_queue(pipeline_warm_queue)
    __tr = performance.now() // [TTP-init] renderer (WebGPU + sky/atmosphere/post) is up
    fly_camera = create_fly_camera(renderer_handle.camera)
    // BENCH-ONLY hook (§7, same spirit as demo/main.js's `window.__engine` + `?synthetic_chunks`):
    // expose the scene so the W11 bench spec can A/B the shadow-cache (flip the sun's
    // shadow.autoUpdate at runtime) and screenshot shadow-follow without new public api surface.
    // Guarded on `window` so it's a no-op under node/tests.
    if (typeof window !== 'undefined') /** @type {any} */ (window).__ares_scene__ = renderer_handle.scene
    // BENCH/TUNING hook (same spirit): expose the atmosphere + post handles so acceptance specs +
    // every knob (grade/clouds/froxels/godrays/shaft uniforms) can be live-tuned from the console.
    if (typeof window !== 'undefined') {
      // (single cast var — two consecutive `(window).x =` lines would ASI-glue into a call)
      const w = /** @type {any} */ (window)
      w.__atmo = renderer_handle.atmo
      w.__hillaire = renderer_handle.hillaire // [C9] the physical sky (default at MEDIUM/HIGH; null only at LOW / analytic override)
      w.__post = renderer_handle.post
      // ENG-13: expose the underwater pass so the acceptance spec can A/B it (`.active.value`,
      // `.warp_amp.value`) so the immersion can be live-tuned from the console.
      w.__underwater = renderer_handle.underwater
    }

    // [B5] BIOME MOOD CROSSFADER (ENGINE_AAA_PLAN §2 P2, behind ?mood=1): a CPU driver that crossfades
    // the ALREADY-LIVE atmosphere uniforms (grade/fog/cloud/particle) toward the camera biome's mood
    // preset over ~4 s — per-biome AAA identity at ~zero GPU cost. Created ONLY under the flag, so with
    // it off nothing runs and the shipped ATMO_CONFIG stands byte-identical (frozen-MEDIUM law). Ticked
    // in the frame loop below; exposed as window.__mood for the acceptance capture.
    const mood_enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mood') === '1'
    if (mood_enabled && renderer_handle.atmo) {
      mood_driver = create_mood_driver({
        atmo: renderer_handle.atmo,
        sample_biome: world_biome_at,
        tier: tier_name,
      })
      if (typeof window !== 'undefined') /** @type {any} */ (window).__mood = mood_driver
    }

    // [S-AMBIENCE] per-environment ambient particles (snow in the mountains, leaf-fall under canopy, sand
    // wisps in the desert, bubbles underwater). DEFAULT ON since 2026-07-12 — the TORMENTOR arc-shell
    // defect was particles.js's square sprite alpha, fixed by the round soft-edge crop (sprite_falloff;
    // unit-tested + a flat shell-test at every framing); gauntlet passed, owner flip. ?ambience=0 is the
    // escape hatch (the falls/skycouple/sunfollow house convention — a trailing =0 kills a default-on
    // system, byte-identical release; no `location` — node/tests — also stays off). LOW's
    // weather_particle_count is 0 in tiers.js, so the director constructs there too but every field's
    // base_count is 0 ⇒ zero draws, zero extra cost — no tier check needed, the tier table already
    // carries it. The SEPARATE legacy weather field at atmosphere.js:726 (its own create_particles()
    // instance, never scene-mounted) is untouched by this flip — still owner-disabled, not resurrected.
    // Ticked in the frame loop; disposed below.
    const ambience_enabled =
      typeof location !== 'undefined' && new URLSearchParams(location.search).get('ambience') !== '0'
    if (ambience_enabled) {
      ambience = create_ambience({
        scene: renderer_handle.scene,
        renderer: renderer_handle.renderer,
        weather_particle_count: get_tier(tier_name).weather_particle_count,
        sample_biome: world_biome_at,
        block_at: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
          ring_manager?.block_id_at(x, y, z) ?? 0,
      })
      if (typeof window !== 'undefined') /** @type {any} */ (window).__ambience = ambience
    }

    terrain_renderer = create_terrain_renderer({
      renderer: renderer_handle.renderer,
      scene: renderer_handle.scene,
      camera: renderer_handle.camera,
      tier: tier_name,
      // D167-B: thread the tactical feathered-occlusion uniforms into every terrain-class material so a
      // mounted fight board can dissolve occluders between the camera and the arena. Inert until armed.
      board_occlusion,
      // [FIRST-LOAD] the radial materialization-front uniforms — inert (radius=SENTINEL) until the frame
      // loop drives them off the ring fill; folds to a no-op once the reveal completes.
      reveal_front,
      gpu_cull: gpu_cull_enabled,
      on_gpu_cull: hitch_enabled ? hitch_probe.gpu_culled : undefined,
      on_chunk_uploaded: hitch_enabled ? hitch_probe.chunk_uploaded : undefined,
      // FIVE-WORLDS: the world's per-biome texture palette (config.textures) — baked into the atlas here.
      textures: world_config.textures,
    })
    // Aim the water glint + the foliage per-plane dispersion (round-3 tune) at the REAL boot sun now,
    // not each material's build-time default guess — set_time_of_day re-aims on every tod tick, but the
    // acceptance pose never advances tod, so without this the grass would disperse against the wrong sun.
    terrain_renderer.set_sun_direction?.(renderer_handle.sky.sun_direction.value)
    // ENG-18 WORLD BORDER: build the mana-barrier renderer over the scene (nothing draws until a zone is
    // armed via arm_border — fixed mode auto-arms on boot; the dapp calls set_zone_bounds). Tier-gated
    // inside (low → plain translucent wall, no rune scroll).
    mana_barrier = create_mana_barrier({ scene: renderer_handle.scene, tier: tier_name })
    if (typeof window !== 'undefined') /** @type {any} */ (window).__mana_barrier = mana_barrier

    // [B4] WATERFALL OVERLAY (ENGINE_AAA_PLAN §4.2): flowing sheets + spray + basin foam over the voxel
    // water. DEFAULT ON since 2026-07-11 (?falls=0 = escape hatch) — the A/B capture proved the sheet
    // read (white flowing water vs the old "stepped glass blocks" look) at +0.1 ms p50 / +0 draw calls,
    // and the C4 decoration-only precedent applies: pure render overlay, zero gen/mesh change, so no
    // golden re-bless. With ?falls=0 (or no `location` — node/tests) nothing runs and the voxel water
    // stands byte-identical (frozen water_material law). Fed FallSpans by the main-thread hydrology twin
    // (world_fall_spans, memoized column profiles); the ring hooks below register/unregister per-column
    // groups with residency.
    const falls_enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('falls') !== '0'
    if (falls_enabled) {
      falls = create_waterfall_system({ scene: renderer_handle.scene, tier: tier_name, get_spans: world_fall_spans })
      if (typeof window !== 'undefined') /** @type {any} */ (window).__falls = falls
      // NIGHT DIM: aim the falls' sky day/night level at the REAL boot sun now (they default to full-day; a
      // boot at night would else show glowing whitewater). set_time_of_day re-aims on every tod tick.
      falls.set_sky_dim(renderer_handle.sky.sun_direction.value.y)
    }
    // BENCH-ONLY hook (same spirit as __ares_scene__ above): expose the terrain renderer so the
    // pool exit-gate harness can read pool_stats() (per-class slot utilization + fragmentation +
    // dropped-upload counters). Guarded on `window`, so a no-op under node/tests.
    if (typeof window !== 'undefined') /** @type {any} */ (window).__terrain_renderer = terrain_renderer

    governor = create_governor({
      initial_tier: tier_name,
      set_tier: (next_tier) => emit('tier_change', next_tier),
      // [M3] the dynamic-resolution governor drives the swapchain pixel scale (high/medium only) to
      // hold ≥120fps under fill pressure and restore native at rest — the single fill lever, automatic.
      set_render_scale: (scale) => api.set_render_scale(scale),
    })

    // [S-85] Apply the BOOT tier's render-scale NOW — the same fill lever set_tier rides live (low 0.66 /
    // medium|high 1.0). The other boot-time dials (atlas texel size, load radius, leaf fins, grass sway,
    // motion blur, foliage shadows) already bake from tier_name above; render-scale was the one tier field
    // that used to wait for a later manual set_tier, so a LOW boot rendered at full resolution until (and
    // unless) the app poked the slider. Now a LOW boot IS a reduced-resolution potato at construction.
    api.set_render_scale(get_tier(tier_name).render_scale_max)

    // BENCH synthetic path: keep the synchronous grid load (bench/synthetic-2000.spec.js measures
    // the render/bundle path at a fixed chunk COUNT — no streaming). Real product path: the M1
    // streaming ring manager over the gen worker pool. engine.start() returns immediately either
    // way; the ring streams the world in around the camera over the following seconds (no boot
    // freeze). §3.2.
    const is_synthetic = synthetic_chunks !== undefined
    if (is_synthetic) {
      const { chunks_loaded } = load_synthetic_chunks({
        terrain_renderer,
        chunk_count: /** @type {number} */ (synthetic_chunks),
      })
      for (let i = 0; i < chunks_loaded; i += 1) {
        if (disposed) return
        emit('chunk_loaded', null)
      }
      if (disposed) return
    } else {
      gen_pool = create_worker_pool({
        // Vite worker detection needs `new URL(...)` written directly inside `new Worker(...)` in THIS
        // file (pool.js's own `new Worker(worker_url)` couldn't see it — see pool.js's create_worker doc).
        create_worker: () => new Worker(new URL('./gen/gen_worker.js', import.meta.url), { type: 'module' }),
        // Gen pool sizing (§3.2): max(2, cores-4) — leave headroom for the main thread (render) and the
        // mesh pool. Backpressure the local job queue so a camera warp can't buffer thousands of stale
        // requests inside the pool.
        worker_count: default_worker_count(),
        max_queue_depth: 256,
        // Config-first handshake (BIOMES Phase 0): every gen worker receives the SELECTED world recipe
        // ONCE at spawn, before any chunk request, so all workers + the main thread generate one world.
        init_message: { type: MSG_GEN_CONFIG, payload: world_config },
        on_message: on_worker_message,
      })
      // NEAR-MESH POOL (§3.2): moves mesh_chunk (76-510 ms per dense chunk) OFF the render thread — the
      // ring dispatches serialized chunk+rim jobs here (mesh_dispatch.js) instead of meshing inline, which
      // was the walking-stall root (idle→moving fps cliff). Sized by mesh_worker_count() — DECOUPLED from
      // the gen cap (2026-07-11): mesh workers hold no gen graph (~0.7 MB heap), so the balloon memory cap
      // that pins gen/far to 2 never applied — they'd been throttled to 2 only for sharing default_worker_
      // count(). At mesh=2 the near-ring mesh backlog stalled the r5 walk at the loaded-chunk edge; cores−4
      // (cap 6) drains it. The ring's max_mesh_in_flight ceiling still meters dispatch so this pool's queue
      // never floods with soon-stale jobs during a fly.
      mesh_pool = create_worker_pool({
        create_worker: () => new Worker(new URL('./mesh/mesh_worker.js', import.meta.url), { type: 'module' }),
        worker_count: mesh_worker_count(),
        max_queue_depth: 256,
        on_message: on_worker_message,
      })
      ring_manager = create_ring_manager({
        pool: gen_pool,
        mesh_pool,
        terrain_renderer,
        // Horizontal view radius in chunks — the canonical LOAD_RADIUS_CHUNKS from world_config
        // (config-first law; demo `?load_radius=N` overrides it for the D33 A/B sweep only). D33 raised
        // the shipped default 5→6 (loaded edge 160→192 m, fog wall 112→144 m) — the largest radius that
        // passed every gate in the r5/6/7/8 bench (bench/d33_radius.spec.js). The earlier "5 is the M1
        // sweet spot" verdict predated the NG-MEGA quad pool + one-mesh/frame pacing, which removed the
        // per-chunk InstancedMesh/material churn behind those old GC spikes — the sweep confirms steady
        // frame-time is now flat across r5→r8, so view distance is bounded only by cold-boot drain time.
        // The fog ceiling + solid pool capacity + shadow span all track this radius (world_config +
        // pool_renderer + renderer). (r7 clears all but the cold-drain budget — a safe owner bump.)
        load_radius,
        // D164: the tier's terrain_displacement flag gates the RICH leaf sprite clusters (2 pairs/surface
        // leaf) vs the cheap single-X fallback (LOW). Occupancy/collision are tier-independent 1 m
        // cubes; this only tunes the render-side canopy density. Governor tier changes don't re-mesh live
        // chunks, so a mid-session tier bump applies to newly-streamed chunks — acceptable (the shipped
        // start tier is the common case; a full re-mesh on tier change is out of scope here).
        render_fins: get_tier(tier_name).terrain_displacement,
        // ADAPTIVE MESH PACING (2026-07-03, replaces the old hard 1-mesh/frame cap): the meshes/frame
        // ceiling now scales with the pending backlog (MESH_PACING_STEPS in world_config) under a
        // wall-clock budget (MESH_BUDGET_MS) — the config defaults, not overridden here. Rationale: the
        // old 1/frame cap made a cold r5 disc take ~13.5 s to detail and post-flight recovery ~20 s (the
        // "took ages" defect); gen delivers the whole disc in ~3 s, so mesh was the wall. The
        // deep-backlog steps (4/frame ≥128, 8/frame ≥512) drain a fresh region in seconds while the
        // budget keeps any single frame inside the 60 fps envelope (the count is the ceiling, the ms
        // slice is the real governor). A quiet ring stays at 1/frame — steady-flight cost is unchanged.
        // [B4] ring hook: thread the coord to the waterfall overlay (no-op under ?falls=0 — falls===null).
        // Falls are a column property, so the system refcounts per (cx,cz) across the 12 cy loads/unloads.
        on_chunk_loaded: (coord) => {
          emit('chunk_loaded', null)
          falls?.note_load(coord)
        },
        on_chunk_unloaded: (coord) => {
          emit('chunk_unloaded', null)
          falls?.note_unload(coord)
        },
        mesh_slice: mesh_slice_enabled,
        on_chunk_meshed: hitch_enabled ? hitch_probe.chunk_meshed : undefined,
        on_mesh_integration: hitch_enabled ? hitch_probe.mesh_integration : undefined,
        // ENG-19 FIXED MODE: the boot pump drives the ring at FULL THROTTLE behind the dapp's loading
        // screen — nobody is watching frames, so the streaming-mode frame-time protections (the closed-
        // loop governor + the per-frame mesh count/deadline that keep flight at 60 fps) are pure boot-time
        // cost we do NOT want. Override them for a fast cold fill of the ~1.5k-chunk zone:
        //  • frame_governor_ms: 0 — no throttle (the pump feeds recent_frame_ms=0, which would otherwise
        //    trip the boot-window governor to 1 mesh/tick and kneecap the ≤10 s target);
        //  • mesh_pacing_steps [[0, 64]] — mesh up to 64 chunks/tick (the wall-clock slice is the real
        //    cap), draining gen's delivery each tick instead of the streaming 8/tick ceiling;
        //  • mesh_budget_ms 12 — a fat main-thread mesh slice per tick (the loading screen tolerates it),
        //    so mesh keeps full pace with the gen worker pool instead of being the wall.
      })
      // ENG-10: hand voxel_sun (built inside the renderer's atmosphere, before ring_manager existed)
      // its resident-chunk iterator so it can CPU-build the coarse sun-occupancy volume for the froxel
      // shafts. No-op when the tier has no froxels (atmo.voxel_sun === null) or the stack degraded.
      __tg = performance.now() // [TTP-init] terrain renderer + gen/mesh pools + ring manager ready to stream
      renderer_handle.atmo?.set_resident_provider?.(ring_manager.for_each_resident)
      // [FIRST-LOAD] the brand holo "materialization floor" — a gold-scanline grid hugging the analytic
      // surface over columns the near ring hasn't drawn yet, so the player sees walkable ground weaving in
      // from frame 1 (under the boot veil) and it dies with zero cost once the neighborhood is covered.
      // Streaming path only (synthetic/webgl never reach here); world_surface_y is the pure analytic oracle.
      materialization_floor = create_materialization_floor({
        scene: renderer_handle.scene,
        surface_height: world_surface_y,
      })
      // NG-LOD PHASE B — FAR SHELL. The far-field renderer + its streamer render terrain to the
      // horizon (km scale) as flat-shaded DH-style colored boxes BEHIND the near voxel ring, with the
      // near ring holding absolute streaming priority (the streamer only builds on an idle budget once
      // ring_manager.queue_depth() hits 0). This is what answers "view distance is near / no infinite
      // LOD" — the near-ring fog wall dies and the far shell fills the distance under aerial haze.
      // FAR SHELL default ON (the emergency gate is retired). The overlap render is now paired with an
      // EXACT per-chunk RESIDENCY MASK (far_field.set_resident_mask, wired in the frame loop below), so
      // the coarse shell is discarded over every RESIDENT near column and shown only in not-yet-loaded
      // gaps + beyond the ring — live-verified: ZERO far-shell pixels over resident chunks both settled
      // and after movement, gapless boot coverage, continuous ocean band. `?far=0` disables it for
      // isolation/debugging.
      // [THE FAR LOD SHIPS EVERYWHERE] The shell ships on EVERY tier,
      // mobile included — a low-tier far-off gate was built and REVERTED same-hour on that call.
      // Low-end affordability comes from budget/trace work (PERF_MOBILE_PLAN C-wave), never amputation.
      const far_enabled = typeof location === 'undefined' || new URLSearchParams(location.search).get('far') !== '0'
      // [house switchboard] `?farvoxel=N` overrides the far-shell BLOCKY-LOD ceiling at boot (default =
      // the safe shipped FAR_VOXEL_MAX_LEVEL=2 ⇒ blocky to ~512 m). N≥3 voxelizes the distant mountains
      // (trailer/close-radius shots) but the far-shell geometry can reach ~98% of the 64 MB far-mem cap,
      // so it's opt-in + warns. Clamped [0,3]; undefined ⇒ the worker's build_far_mesh default cap.
      const far_voxel_max = read_farvoxel_override()
      // [house switchboard] `?farterrace=1` mounts the TERRACE far band (S-27 round 2): levels above the
      // blocky-voxel ceiling up to L3 mesh as y-quantized, greedy-XZ-merged contour terraces (planes with
      // 2 m layers — the voxel impression without variant A's 8 m mega-blocks). `?terracem=N` tunes the
      // layer height (m). Compose with ?farvoxel: the band is (voxel_max, 3] — e.g. ?farvoxel=1&farterrace=1
      // terraces L2+L3; ?farvoxel=3 wins at L3 (real blocks) leaving no terrace band. Absent ⇒ no terrace.
      const far_terrace = read_farterrace_override()
      // [B3 FAR-TREE IMPOSTORS] `?impostors=1` mounts the forest-to-horizon billboard layer + tells the far
      // worker to derive per-section procedural-tree instances (the §3.6 seam). Absent ⇒ far shell only
      // (byte-identical). Meaningful with ?proctrees=1 (else resolve_placement_at grows no procedural trees).
      const impostors_enabled =
        typeof location !== 'undefined' && new URLSearchParams(location.search).get('impostors') === '1'
      far_field = far_enabled
        ? create_far_field({
            scene: renderer_handle.scene,
            impostors: impostors_enabled,
            on_lod_dispose: hitch_enabled ? hitch_probe.lod_disposed : undefined,
            on_chunk_uploaded: hitch_enabled ? hitch_probe.chunk_uploaded : undefined,
          })
        : null
      // Far sun-diffuse tracks the analytic sky's sun so the shell's shading matches the horizon.
      far_field?.set_sun_direction(renderer_handle.sky.sun_direction.value)
      // Dedicated far-section worker pool — the section downsample is ~550 ms cold for an L4 (measured),
      // so it MUST run off the render thread or the cold horizon fill tanks frame-time. A small pool
      // (a couple of workers) keeps the horizon filling briskly without contending the gen pool.
      if (far_field) {
        far_pool = create_worker_pool({
          create_worker: () => new Worker(new URL('./lod/far_section_worker.js', import.meta.url), { type: 'module' }),
          worker_count: default_far_worker_count(),
          max_queue_depth: 512,
          // SSOT: the far shell must gen from the SAME world config as the near ring (surface snow/rock,
          // strata banding, biome pins, splines) — not just the seed. Without this the far worker built the
          // DEFAULT recipe (grass surface) while the near ring painted the world's real surface, so a
          // non-default world (Everest) showed a green-vs-white far/near seam (caught live). Delivered as
          // the pool's one-shot init, exactly like the near gen pool's MSG_GEN_CONFIG.
          init_message: { type: MSG_GEN_CONFIG, payload: world_config },
          on_message: on_worker_message,
        })
        far_streamer = create_far_streamer({
          far_field,
          // Seed is a FALLBACK only — the far worker builds its gen context from the init MSG_GEN_CONFIG
          // above (the full recipe), matching the near ring's surface/strata/biomes. Kept for the bare
          // (no-init) submit_build path + tests.
          seed: gen_seed,
          far_radius_m,
          refine_lod: lod_refine_enabled,
          on_lod_promotion: hitch_enabled ? hitch_probe.lod_promoted : undefined,
          submit_build: (level, sx, sz) =>
            /** @type {Promise<import('./lod/far_mesher.js').FarMesh>} */ (
              /** @type {import('./workers/pool.js').WorkerPool} */ (far_pool).submit(MSG_FAR_SECTION_REQUEST, {
                level,
                sx,
                sz,
                seed: gen_seed,
                voxel_max: far_voxel_max,
                terrace_max: far_terrace?.max,
                terrace_layer_m: far_terrace?.layer_m,
                impostors: impostors_enabled,
              })
            ),
        })
        // FOG HANDOFF: push the fog band OUT to the far-shell boundary (kills the ~168 m near-ring wall).
        // Fog now dissolves near detail → far shell across the whole horizon, and the far shell → sky at
        // the very edge, instead of a grey wall just past the streamed near ring. near = 200 m keeps the
        // close painterly detail crisp; far = the far-shell reach.
        renderer_handle.set_far_fog(200, far_radius_m)
      }
    }
    console.info(
      `[TTP-init] renderer ${Math.round(__tr - __t0)}ms · terrain+ring ${Math.round(__tg - __tr)}ms · ` +
        `far/LOD ${Math.round(performance.now() - __tg)}ms · total-to-first-frame ${Math.round(performance.now() - __t0)}ms`
    )

    frame_loop = create_frame_loop({
      on_sim_step: () => {},
      on_render: (/** @type {number} */ _alpha, /** @type {number} */ frame_dt_seconds) => {
        const cpu_frame_start = cpu_probe ? performance.now() : 0
        // Attribute the interval that just ended BEFORE doing/resetting any work for this callback.
        hitch_probe.frame(frame_dt_seconds * 1000, performance.now())
        fly_camera.apply()
        // Advance the far shell's fade-dither clock so section cross-fades animate at real time.
        far_field?.tick(frame_dt_seconds)
        // [B5] crossfade the atmosphere mood toward the camera's current biome (no-op unless ?mood=1
        // created the driver). Pure uniform writes over an already-live stack — ~zero GPU cost.
        mood_driver?.tick(frame_dt_seconds, renderer_handle.camera.position.x, renderer_handle.camera.position.z)
        // Drive the stream + hand the meshed-chunk backlog to the GPU ONCE per rendered frame (NOT
        // per sim step — the fixed-timestep accumulator can fire on_sim_step several times after a
        // slow frame, which would stack meshing/upload work and spike frame time). One pump per rAF
        // paces gen requests, main-thread meshing (time-sliced inside update), and GPU uploads
        // (byte-budgeted) against the real frame cadence, keeping the streaming frame cost bounded.
        // Runs BEFORE frustum culling + render so freshly-streamed chunks show this same frame.
        // Push the current sun shadow box to the terrain renderer BEFORE draining uploads, so a chunk
        // uploaded this frame is scored (for shadow invalidation) against where the shadow box sits.
        terrain_renderer.set_shadow_box(...renderer_handle.shadow_box())
        // [D210] The world has no separate "fixed map" concept — it always generates around the
        // player. ONE world model: the ring streams around the
        // camera/player everywhere (radius LOAD_RADIUS_CHUNKS ≈ the <200-block spec); the
        // border bounds are the only thing making the world finite.
        if (ring_manager && !streaming_paused) {
          // Forward-bias priority: the flat camera facing (y dropped) so the ring resolves the columns
          // the player flies toward first. getWorldDirection returns the world-space -Z forward.
          renderer_handle.camera.getWorldDirection(cam_forward)
          // frame_dt_seconds is the time since the last rAF = the PREVIOUS frame's duration — the exact
          // closed-loop signal the ring's frame governor throttles on (× 1000 → ms).
          ring_manager.update(camera_chunk(), [cam_forward.x, 0, cam_forward.z], frame_dt_seconds * 1000)
          // Adaptive upload budget (scales with pending depth + frame governor inside the ring).
          ring_manager.drain_uploads()
          // [FIRST-LOAD] drive the radial reveal front + the materialization floor off the LIVE ring fill.
          // The disc fills around the camera (the ring centre), so the front tracks the camera XZ; both
          // self-guard once complete (reveal folds to a no-op, floor stops all work) ⇒ trivial steady cost.
          const cam_p = renderer_handle.camera.position
          const rendered_cols = ring_manager.rendered_column_count()
          reveal_front.set_center(cam_p.x, cam_p.z)
          reveal_front.drive(rendered_cols, ring_manager.loaded_radius_blocks(), frame_dt_seconds)
          materialization_floor?.update(cam_p.x, cam_p.z, rendered_cols, frame_dt_seconds)
        }
        // FAR SHELL: advance the horizon stream. It runs on its OWN worker pool (can't starve the near
        // gen pool), so it covers coarse-first from frame 0 — no empty band (by design).
        //
        // near_radius is ALWAYS 0 → the far shell keeps FULL-DISC coverage at every moment, and the
        // per-chunk residency mask below is the SINGLE occlusion authority (discards the shell only over
        // columns the near ring is actually DRAWING). The old `streaming ? 0 : loaded_radius` toggle keyed
        // this on queue_depth() — which oscillates 0↔>0 continuously as a WALKING player's frontier feeds
        // new chunks in. Each flip moved the far near-radius 0↔224 m, which PRUNED then REBUILT every far
        // section straddling the near-ring boundary (measured: L2/L3 sections `3,0,0`, `2,x,y` vanishing
        // at q=0 and reappearing at q>0 — a "LOD jumpy, appearing then disappearing under my
        // feet" defect. Dropping the toggle removes that second, coarser occlusion fighting the mask: the inner
        // ring stays resident (a handful of small L1–L3 sections, well under the 64 MiB cap — this is
        // exactly the boot-time coverage, now never rescinded), the mask hides it over drawn near terrain,
        // and no far section is ever pruned+rebuilt by a transient queue blip. 2026-07-04.
        // [TTP] Loads the chunk under the player first; quality (lights/sky/textures/LOD) streams in after.
        // Defer the far-shell/LOD horizon stream until the near neighborhood is resident (focus_ready).
        // During boot the blur veil covers the screen, so the km-scale horizon is UNSEEN anyway — holding
        // this stream keeps the main thread (far submit + far-mesh upload) and the far worker pool on the
        // SPAWN chunk instead of the distant mountains. The far shell fills in the instant the veil melts:
        // it INITIALIZES later, never degrades once loaded (the standing far-mask/sky invariant holds).
        // [S3] …AND the pre-warm settled: far-shell pipelines compile inside the warm (behind the veil),
        // never synchronously at the first section's first render. Costs ~1s of later horizon, kills the freeze.
        if (far_streamer && ring_manager && focus_ready_emitted && prewarm_settled) {
          const p = renderer_handle.camera.position
          far_streamer.update({
            camera_xz: [p.x, p.z],
            near_radius_m: 0,
          })
          // POKE-THROUGH / OVERLAY FIX: hide the far shell over near columns the renderer is actually
          // DRAWING (the coarse far heightfield averages high in dips and pokes through the detailed near
          // ring). An EXACT per-chunk mask (not a radius — a static square voids unloaded chunks inside it
          // and misses loaded ones outside during movement), rebuilt each frame + centred on the camera
          // chunk. Fed for_each_rendered_column (UPLOADED columns), NOT for_each_resident (store =
          // generated, which runs ahead of the byte-budgeted upload): masking on generated-not-yet-drawn
          // columns over-discarded the far shell over them → the "far sheet + only a slit of voxels"
          // holes during a stream/teleport. Rendered-column masking keeps the far shell covering those
          // columns until their geometry is actually on the GPU. 2026-07-03.
          const [cam_cx, , cam_cz] = camera_chunk()
          far_field?.set_resident_mask(ring_manager.for_each_rendered_column, cam_cx, cam_cz)
          // [B3] Feed the near ring's live radius so far-tree impostors radial-fade OUT as the ring's real
          // voxel trees stream in at the seam (the cross-fade hand-off; no-op without ?impostors=1).
          far_field?.set_near_radius(ring_manager.loaded_radius_blocks())
        }
        // ENG-18/D210 WORLD BORDER: armed IMMEDIATELY on the first frame — the wall's terrain-following
        // now probes THE GENERATOR (deterministic, no residency needed), so it never waits on chunks.
        if (!border_auto_armed && zone_size_m > 0) {
          arm_border(zone_bounds_for(zone_origin, zone_size_m))
          border_auto_armed = true
        }
        // [D210] the boot playability signals, streaming-side: nearest-first residency around the
        // camera ⇒ the first 25 columns ARE the player's neighborhood. focus_ready ≈ walkable;
        // done = the full ring radius resident (parity for old listeners; ~seconds, not the old 33 s).
        if (ring_manager && !boot_done_emitted) {
          const resident = ring_manager.resident_count()
          if (!focus_ready_emitted && resident >= 25 * VERTICAL_CHUNKS) {
            focus_ready_emitted = true
            emit('load_progress', { phase: 'focus_ready', loaded: resident, total: ring_total })
            // [D221 — a mid-walk ~0.9s FREEZE, trace-convicted]: two back-to-back 409+487ms
            // frames with an EMPTY chunk queue = first-use GPU PIPELINE COMPILATION (a material class
            // entering view compiles its shader on the main thread mid-walk). PRE-WARM here: compile
            // every pipeline reachable from the current scene while the loading shade still covers
            // the screen — the stall moves into boot where nobody feels it. Warm by driving ONE
            // composite render through the live depth-1 path; never call PassNode.compileAsync here:
            // it holds the scene-pass render target globally across awaits, so an interleaved live frame
            // samples and writes that same `depth` texture. Only the degraded path (post null) falls back
            // to the renderer's bare async scene compile.
            const rh = renderer_handle
            // [D221-FAR 2026-07-14] The warm compiles pipelines REACHABLE FROM THE SCENE — but the far
            // shell's materials only enter the scene when its first section uploads (post-focus_ready,
            // far_field.js upload_section), so they missed every warm and compiled SYNCHRONOUSLY at
            // first horizon appearance: a multi-second "freezes when the LOD loads" defect. Mount
            // degenerate warm meshes for the compile's duration, release once it settles.
            const release_far_warmers = far_field?.mount_pipeline_warmers()
            // [B4] Waterfall sheet/spray/foam materials also arrive only with streamed columns. Mount one
            // exact live-material instance of every tier-reachable variant into the same veiled scene warm.
            const release_fall_warmers = falls?.mount_pipeline_warmers()
            // [C1] batch every ALREADY-QUEUED late-GLB warm (an avatar/mob whose load resolved during
            // boot) into this same veiled warm frame — the batch is free behind the veil; anything
            // arriving later drains sliced (≤1/frame) through the frame-loop tick above.
            pipeline_warm_queue?.flush_all()
            // [S3] settle → 'visual_ready': every reachable pipeline is compiled; the far streamer gate
            // above opens here. (The boot veil keys on column-ready per the P0-item-14 rule —
            // see prewarm_settled's docblock.)
            const settle_visual = () => {
              prewarm_settled = true
              emit('load_progress', { phase: 'visual_ready', loaded: resident, total: ring_total })
            }
            // Start from a resolved promise so a synchronous render error becomes a rejected warm instead
            // of escaping the frame loop. The mounted variants remain reachable until the warm settles.
            Promise.resolve()
              .then(() =>
                rh?.post?.render_frame ? rh.post.render_frame() : rh?.renderer?.compileAsync?.(rh.scene, rh.camera)
              )
              .then(() =>
                console.info('[voxel] D221 pipeline pre-warm complete (first-use compile stalls moved into boot)')
              )
              .catch((error) => console.warn('[voxel] D221 pre-warm failed (world stays playable):', error))
              .finally(() => {
                release_far_warmers?.()
                release_fall_warmers?.()
                settle_visual()
              })
          }
          if (resident >= ring_total && ring_manager.queue_depth() === 0) {
            boot_done_emitted = true
            emit('load_progress', { phase: 'done', loaded: resident, total: ring_total })
            // [FIRST-LOAD] the world is fully resident — the holo floor is long dead; free it for good (belt).
            materialization_floor?.dispose()
            materialization_floor = null
            // [D185] self-rescue: nobody drove the camera by terrain-done → repose to a vista.
            if (!camera_externally_driven) {
              camera_externally_driven = true
              try {
                const sample = /** @param {number} x @param {number} y @param {number} z */ (x, y, z) =>
                  ring_manager ? ring_manager.block_id_at(x, y, z) : 0
                const open = find_open_spawn(sample, zone_origin[0], zone_origin[1]) ?? [
                  zone_origin[0],
                  200,
                  zone_origin[1],
                ]
                fly_camera?.set_position([open[0], open[1] + 14, open[2] - 16])
                fly_camera?.set_orientation(0, -0.45)
                console.info(
                  `[voxel] no consumer drove the camera — self-rescued to a vista at [${open.join(', ')}] (D185)`
                )
              } catch (error) {
                console.warn('[voxel] D185 self-rescue FAILED (camera stays at boot default):', error)
              }
            }
          }
        }
        if (zone_bounds) {
          const p = renderer_handle.camera.position
          border_prox = border_proximity(p.x, p.z, zone_bounds)
          mana_barrier?.update(renderer_handle.camera, frame_dt_seconds)
        }
        // [C1] sliced pipeline warm: release last frame's warm rig (its pipelines are now cached,
        // resolving the factory awaits) and mount at most ONE pending rig for THIS frame's render.
        // Before sync_shadow so a mounted caster's shadow request lands in the same frame's shadow pass.
        pipeline_warm_queue?.tick()
        terrain_renderer.update(renderer_handle.camera, ring_manager?.queue_depth() ?? 0)
        // W11 T1/T2 + shadow perf: keep the sun shadow box centered on the camera (light-azimuth
        // texel-snapped, on chunk-boundary crossings) and re-render the cached shadow map ONLY when the
        // box moved or a chunk INSIDE the shadow box changed — the SCOPED shadow_epoch (not upload_epoch)
        // ignores chunks streaming in/out beyond the box during flight, and terrain-change re-renders are
        // DEBOUNCED while the queue is non-empty (flushed immediately once it drains). shadow_epoch() =
        // scoped terrain-dirty signal; queue_depth() = stream-active.
        renderer_handle.sync_shadow(
          renderer_handle.camera,
          terrain_renderer.shadow_epoch(),
          ring_manager?.queue_depth() ?? 0
        )
        // ENG-13 UNDERWATER: sample the resident store at the camera eye → submerged flag (hysteresis)
        // + depth, pushed to the post stack BEFORE the frame renders so THIS frame shows the immersion.
        // One bounded column walk on the CPU; a no-op in the synthetic bench path (no ring → null).
        let submerged_now = false
        if (ring_manager) {
          const eye = renderer_handle.camera.position
          const surface_y = water_surface_plane(ring_manager.block_id_at, eye.x, eye.y, eye.z, WATER_BLOCK_ID)
          const { submerged, depth } = compute_underwater_state(eye.y, surface_y, was_submerged)
          was_submerged = submerged
          submerged_now = submerged
          renderer_handle.update_underwater({ submerged, depth, dt: frame_dt_seconds })
        }
        // [S-AMBIENCE] advance the per-environment ambient particle field (biome/canopy/underwater kind
        // select + crossfade + the shared wind gust). Null only under ?ambience=0 (else DEFAULT ON). Fed
        // the underwater flag so submerging swaps the field to rising bubbles with an entry burst.
        ambience?.tick(frame_dt_seconds, renderer_handle.camera.position, { submerged: submerged_now })
        // NG2-ATMO: render through the atmosphere post stack (scene pass → clouds → froxel fog →
        // god rays → AgX → grade) — the drop-in replacement for the old bare renderer.render().
        // Also advances the cloud weather clock + froxel grid compute (atmosphere.js SPEC §I).
        // [D248] impact shake: offset the camera for THIS frame only, then restore after render so the
        // shake never drifts the rig's base pose (non-accumulating; a no-op dance while idle).
        const restore_shake = camera_shake.apply(renderer_handle.camera, frame_dt_seconds)
        const cpu_render_start = cpu_probe ? performance.now() : 0
        renderer_handle.render_frame(frame_dt_seconds, live_camera_speed)
        const cpu_render_end = cpu_probe ? performance.now() : 0
        restore_shake?.()
        // [M3] feed the RAW frame duration (not the 120-frame p50) so the governor's EMA reacts to a
        // sustained load within a few frames — the dynamic-resolution policy owns the fast/slow pacing.
        // SETTLED gate: the governor may only resize the swapchain when the
        // neighborhood is loaded AND the near ring is drained (or streaming is paused — a cave/fight), so a
        // setPixelRatio realloc never lands mid async-pipeline-compile of a streaming material (terrain /
        // water / far-field / GLB) — the "depthStencil.format undefined" flash this caused. Boot's slow
        // streaming frames are NOT fill pressure; freezing the policy through them is both safer and correct.
        const near_settled = (ring_manager?.queue_depth() ?? 0) === 0
        governor.record_frame(frame_dt_seconds * 1000, focus_ready_emitted && (near_settled || streaming_paused))
        if (cpu_probe) {
          cpu_probe.frame({
            start_ms: cpu_frame_start,
            render_start_ms: cpu_render_start,
            render_end_ms: cpu_render_end,
            end_ms: performance.now(),
            frame_ms: frame_dt_seconds * 1000,
          })
        }
      },
    })
  }

  /** Current camera chunk coordinate from the live three camera position. @returns {[number,number,number]} */
  function camera_chunk() {
    const p = renderer_handle.camera.position
    return world_to_chunk_coord([p.x, p.y, p.z])
  }

  /** @type {EngineApi} */
  const api = {
    start() {
      if (disposed) throw new Error('engine.js: start() after dispose()')
      run_requested = true
      ready ??= init()
      // §10.1 capability gate: a real async init failure (no WebGPU adapter, device lost during
      // create, shader compile failure, …) must surface as a 'boot_error' event, never an
      // unhandled promise rejection + silent blank canvas.
      ready
        .then(() => {
          // A scene may be released while tier/renderer boot is pending. init() disposes a renderer that lands
          // late; queued API callbacks belong to the dead scene and must never run against a replacement.
          if (disposed) {
            pre_boot_queue = null
            return
          }
          // [D196] flush every queued pre-boot api call (in order) now the renderer exists.
          const queued = pre_boot_queue ?? []
          pre_boot_queue = null
          flush_live_callbacks(queued, () => disposed)
          if (!disposed && run_requested) frame_loop.start()
        })
        .catch(
          /** @param {unknown} error */ (error) => {
            if (!disposed) emit('boot_error', error)
          }
        )
    },
    stop() {
      run_requested = false
      frame_loop?.stop()
    },
    set_tier(next_tier) {
      if (!TIER_ORDER.includes(next_tier)) throw new TypeError(`engine.js: unknown tier "${next_tier}"`)
      governor?.set_tier(next_tier)
      // [D220-B] Resolution changes apply immediately — each rung carries a pixel
      // scale (the tier table's render_scale_max — authored for the dynamic governor, never applied):
      // low 0.66 / medium 1.0 / high 1.0. The single biggest fill lever finally rides the
      // ladder; the manual slider (set_render_scale) stays live as the user override afterward.
      api.set_render_scale(get_tier(next_tier).render_scale_max)
    },
    set_time_of_day(phase) {
      // [D196 / D177 root class] pre-boot tod calls QUEUE instead of silently vanishing.
      if (defer_until_boot(() => api.set_time_of_day(phase))) return
      // NG-LOD phase B wired the analytic sky node (renderer.sky) as the scene background + fog hue,
      // so tod is now real: advance the sky (updates its sun_direction) and re-point the far shell's
      // sun so its flat-shade tracks the sky. Degrades silently pre-boot (sky not built yet). Clouds +
      // the full day-night rig (CSM, ambient re-grade) remain NG2 (render/sky/day_night.js).
      if (typeof phase !== 'number' || !Number.isFinite(phase)) return
      const sky = renderer_handle?.sky
      if (!sky) return
      sky.set_time_of_day(phase)
      far_field?.set_sun_direction(sky.sun_direction.value)
      // NG2-C water: aim the sun-road glint at the SAME sun (otherwise it stays frozen at the
      // material's build-time noon — a dusk glint pointing at the wrong sun).
      terrain_renderer?.set_sun_direction?.(sky.sun_direction.value)
      // NIGHT DIM the unlit waterfall overlay off the same sun elevation (falls kept glowing at
      // night like the near water). No-op under ?falls=0 (falls===null).
      falls?.set_sky_dim(sky.sun_direction.value.y)
      // NG2-ATMO (SPEC §J): re-derive the cloud/fog sun radiance from the new sun (dusk reddening),
      // re-bake the drifted cloud-shadow map, and re-tint the linear fog band to the new horizon.
      renderer_handle.atmo?.on_time_of_day()
      renderer_handle.refresh_fog?.()
    },
    /**
     * The live day/night light level — 1 across daylight, 0 below the horizon — the SAME sky_day_factor the near
     * water reflection and the waterfall overlay consume. The ONE home the frontend gather props read to darken at
     * night (gather_synth.gather_night_tint). O(1) render read (get_stats stays the HUD feed). 1 pre-boot / no sky.
     * @returns {number}
     */
    day_factor() {
      const y = renderer_handle?.sky?.sun_direction?.value?.y
      return typeof y === 'number' ? sky_day_factor(y) : 1
    },
    /**
     * Live-retune the WHOLE night look — terrain + water — from ONE call (a taste pick, shipped
     * default = "Night Look A"). `moon_mul` lifts the directional moonlight key (silhouettes/tops read);
     * `ambient_night_floor` the flat terrain ambient; `water_night_floor` the water reflection's night floor
     * (bare 0 sank night water to pure black). Null/omitted keeps the current values; each dial's own recolour
     * (couple_lighting / water_sky_dim_factor) picks the change up on the next tod tick (nudge set_time_of_day
     * to force one). @param {{moon_mul?:number, ambient_night_floor?:number, water_night_floor?:number}} [cfg]
     */
    configure_night_lighting(cfg) {
      configure_night_lighting(cfg)
      configure_water_night_floor(cfg)
    },
    set_atmosphere_params(params) {
      // [C9] live-retune the physical atmosphere (Rayleigh/Mie/ozone/exposure/…) — the S-72 per-world
      // parameter sets + the B5 mood crossfade feed. Queues pre-boot; a no-op at LOW (analytic sky rung).
      if (defer_until_boot(() => api.set_atmosphere_params(params))) return
      renderer_handle?.hillaire?.set_atmosphere_params(params)
    },
    set_camera_position(position) {
      // ENG-18 WORLD BORDER: every camera move (fly OR the walk shoulder-cam pose) funnels through here,
      // so this is the single home for the soft-clamp — a sprint/teleport at the wall STOPS at the plane
      // with no tunnel-through and no jitter (idempotent hard floor + a soft lead-in; see zone_border).
      // No-op (unchanged position) when no border is armed.
      camera_externally_driven = true // [D185] a consumer drives the camera — the boot self-rescue stands down
      const clamped = zone_bounds ? clamp_to_bounds(position, zone_bounds).position : position
      fly_camera?.set_position(clamped)
    },
    set_camera_orientation(yaw, pitch) {
      camera_externally_driven = true // [D185]
      fly_camera?.set_orientation(yaw, pitch)
    },
    set_camera_fov(fov_degrees) {
      const camera = renderer_handle?.camera
      if (!camera || typeof fov_degrees !== 'number' || !Number.isFinite(fov_degrees)) return
      if (camera.fov === fov_degrees) return
      camera.fov = fov_degrees
      camera.updateProjectionMatrix()
    },
    set_camera_speed(speed) {
      // [ENG camera-feel] the app's per-frame horizontal ground speed (m/s) — the SAME value it feeds
      // the shoulder camera's speed-FOV (camera_rig.js). Forwarded to render_frame → the post stack's
      // motion-blur run-speed trigger. No-op (stays 0) on a bad value; safe pre-boot (just cached).
      live_camera_speed = typeof speed === 'number' && Number.isFinite(speed) ? speed : 0
    },
    shake_camera(magnitude) {
      // [D248] fire the impact shake (0.10 light / 0.20 std / 0.5+ crit); the app calls this on a
      // cast-impact hit. No-op before boot (nothing renders yet) — the driver just idles.
      camera_shake.trigger(magnitude)
    },
    set_motion_blur_enabled(on) {
      // [D251-2] owner: NO motion blur in fights. The dapp calls this OFF on fight enter, ON on exit.
      // No-op before boot / when the blur wasn't created (low tier or ?blur=0).
      renderer_handle?.set_motion_blur_enabled?.(on)
    },
    sample_block(x, y, z) {
      // Real streaming path: read the resident chunk store. Synthetic bench path has no ring → air.
      return ring_manager?.block_id_at(x, y, z) ?? 0
    },
    sample_block_analytic(x, y, z) {
      // [FIRST-LOAD] Provides a basic walkable voxel plane so the player can move while the world is still loading.
      // Residency-aware collision oracle: when the containing chunk IS resident, voxel truth wins (incl.
      // 0 for a real cave/overhang — caves stay caves). When it is NOT streamed yet, the generator's
      // ANALYTIC surface stands in as solid ground (solid below world_surface_y, air above) so the player
      // has walkable ground at t≈0 and the physics/input gate opens immediately, instead of falling
      // through unstreamed void. world_surface_y is pure gen math (no residency — set_gen_config ran at
      // create), so this answers correctly even before init() resolves. As chunks land, block_id_or_null
      // returns the real voxel and truth takes over (a ≤2-block y snap; the under-map rescue is the net).
      const v = ring_manager?.block_id_or_null(x, y, z)
      if (v !== null && v !== undefined) return v
      const iy = Math.floor(y)
      if (iy < 0 || iy >= WORLD_HEIGHT) return 0
      return iy < world_surface_y(Math.floor(x), Math.floor(z)) ? ANALYTIC_GROUND_ID : 0
    },
    is_column_resident(x, z) {
      const ground_y = world_surface_y(Math.floor(x), Math.floor(z)) - 1
      return ring_manager?.chunk_resident(x, ground_y, z) ?? false
    },
    add_to_scene(object3d) {
      // [D196] pre-boot calls QUEUE (this method silently ate a consumer's mesh tonight)
      if (
        defer_until_boot(() => {
          renderer_handle?.scene.add(object3d)
        })
      )
        return
      renderer_handle?.scene.add(object3d)
    },
    remove_from_scene(object3d) {
      if (defer_until_boot(() => renderer_handle?.scene.remove(object3d))) return
      renderer_handle?.scene.remove(object3d)
    },
    get_scene() {
      return renderer_handle?.scene ?? null
    },
    get_camera() {
      // ENG-16: the live render camera (null pre-boot). The tactical board needs it to build picking
      // rays (analytic y-plane pick) + billboard floats to the view; it is NOT parented under the
      // scene (renderer.js owns it standalone), so get_scene() can't reach it. Read-only accessor.
      return renderer_handle?.camera ?? null
    },
    get_terrain_renderer() {
      // D141 (cave room): the RENDER↔CORE seam (upload_chunk/remove_chunk), null pre-boot. A STANDALONE
      // chunk set (the cave dungeon room — scene/cave_scene.js) uploads its meshed chunks straight into
      // this pool, the SAME seam load_synthetic_chunks uses, without going through the streaming ring
      // (the ring owns outdoor world gen; the room is a self-contained set). Read-only accessor.
      return terrain_renderer ?? null
    },
    get_board_occlusion() {
      // D167-B: the tactical feathered-occlusion uniforms (set_bounds / set_active). The tactical facade
      // arms this when a fight board mounts and disarms on unmount; the terrain materials read it every
      // frame. Available immediately (created eagerly, no GPU) — non-null even pre-boot, so the facade
      // never races the renderer. On the WebGL fallback the terrain materials ignore it (no TSL); the
      // facade still calls it harmlessly.
      return board_occlusion
    },
    get_atmosphere() {
      // D141 (cave room): the NG2-ATMO handle (froxel god-ray voxel-sun provider), null pre-boot or
      // when the tier/degradation gate left it off. The cave room feeds set_resident_provider its own
      // records so the ceiling holes cast shafts (the pass reads {cx,cy,cz,ids}). Read-only accessor.
      return renderer_handle?.atmo ?? null
    },
    set_render_scale(scale) {
      // Clamp to the public lever range; 1.0 = native (default), 0.5 = quarter-fragment relief.
      render_scale = Math.max(0.5, Math.min(1, scale))
      // Effective pixel ratio = renderer.js's own dpr cap (2) × the scale. setPixelRatio re-runs
      // setSize internally (three.webgpu.js:59017 → setSize(w, h, false)), which reallocates the
      // swapchain color + depth attachments in lockstep — the SAME single-owner path renderer.js's
      // apply_size uses — so this never desyncs them (the black-screen resize bug) and survives a
      // later ResizeObserver/device-loss re-size (pixelRatio persists on the renderer across setSize).
      const base_dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2)
      renderer_handle?.renderer.setPixelRatio(base_dpr * render_scale)
    },
    set_streaming_paused(paused) {
      // [D213] Cave interiors should generate only that room, not the terrain around it — the cave
      // scene calls set_streaming_paused(true) on enter / false on exit — the overworld ring freezes
      // (no gen/mesh/upload around the underground camera); resident chunks stay warm for the return.
      streaming_paused = !!paused
    },
    set_far_fog(near_m, far_m) {
      // [D213] retune the aerial fog band (range term only — see set_fog_scale for the master gate).
      if (defer_until_boot(() => api.set_far_fog(near_m, far_m))) return
      renderer_handle?.set_far_fog?.(near_m, far_m)
    },
    set_fog_scale(scale) {
      // [D213-B the cave wash root] master scene-fog gate: the HEIGHT fog term is range-immune by
      // design (max, not multiply), so enclosed scenes disable ALL aerial fog here (0) and restore 1
      // on exit. Queues pre-boot like every scene api.
      if (defer_until_boot(() => api.set_fog_scale(scale))) return
      renderer_handle?.set_fog_scale?.(scale)
    },
    get_world_mode() {
      return /** @type {const} */ ('streaming') // [D210] the fixed/streaming split is dead — one model
    },
    get_zone_bounds() {
      // ENG-19 fixed mode: the resident zone's world-space meter extents (the ENG-18 border clamps the
      // player inside these). An explicit set_zone_bounds (ENG-18, dapp/streaming) wins; else the fixed
      // orchestrator's bounds; else null (streaming/unbounded or pre-boot).
      return zone_bounds ?? (zone_size_m > 0 ? zone_bounds_for(zone_origin, zone_size_m) : null)
    },
    set_zone_bounds(bounds) {
      // ENG-18 WORLD BORDER: arm (or re-arm) the border for a zone — the camera soft-clamps inside these
      // and the mana barrier draws its perimeter. Rejects a malformed box (leaves the current border). The
      // dapp calls this (any world_mode); fixed mode ALSO auto-arms from its own bounds on boot.
      if (!is_valid_bounds(bounds)) return
      border_auto_armed = true // an explicit set takes over from the fixed-mode auto-arm
      arm_border(/** @type {import('./core/zone_border.js').ZoneBounds} */ (bounds))
    },
    clear_zone_bounds() {
      // ENG-18: tear down the border (no clamp, no wall). The dapp calls this leaving a bounded zone.
      border_auto_armed = true
      arm_border(null)
    },
    set_border_banner(text) {
      // ENG-18: the floating holo-text repeated along the wall at eye level (the dapp passes the already-
      // composed, i18n-resolved string — the engine ships zero i18n). null clears the banners.
      mana_barrier?.set_banner(typeof text === 'string' ? text : null)
    },
    get_stats() {
      const frame_stats = frame_loop?.get_frame_stats() ?? { fps: 0, p50: 0, p75: 0, p99: 0 }
      const render_stats = terrain_renderer?.get_stats() ?? { draw_calls: 0, quads: 0 }
      // Camera pose readout (UX): read the three camera directly — fly_camera.apply() makes
      // it authoritative each frame. Euler 'YXZ' inverts apply()'s Euler(pitch, yaw, 0, 'YXZ')
      // exactly (demo clamps pitch inside ±90°, so no gimbal ambiguity): .y = yaw, .x = pitch.
      const camera = renderer_handle?.camera
      const orientation = camera ? new Euler().setFromQuaternion(camera.quaternion, 'YXZ') : null
      return {
        fps: frame_stats.fps,
        frame_ms_p50: frame_stats.p50,
        frame_ms_p75: frame_stats.p75,
        frame_ms_p99: frame_stats.p99,
        draw_calls: render_stats.draw_calls,
        quad_count: render_stats.quads,
        tier: governor?.get_current_tier() ?? tier ?? 'medium',
        render_scale,
        // DAY-NIGHT: the sky's live cycle phase in [0,1) — the §7 HUD feed for the day-night dial. The sky
        // node owns the clock uniform; the frontend cycle driver advances it via set_time_of_day. 0 pre-boot.
        time_of_day: renderer_handle?.sky?.time_of_day?.value ?? 0,
        chunk_queue_depth: ring_manager?.queue_depth() ?? 0,
        // ENG-14 TEMP (2026-07-04): governor trip rate + mesh throughput for the ULTRA drain probe.
        stream_debug: ring_manager?._stream_debug?.() ?? null,
        // Resident chunk records in the ring store (all-air INCLUDED — honest streaming-drain readout
        // for the throughput probe; render_stats.chunk_count below is uploaded solid chunks only).
        resident_chunks: ring_manager?.resident_count() ?? 0,
        far_section_count: far_streamer?.section_count() ?? 0,
        far_section_bytes: far_streamer?.bytes() ?? 0,
        far_impostor_count: far_field?.impostor_count() ?? 0, // [B3] resident far-tree billboards (0 without ?impostors=1)
        near_ring_m: ring_manager?.loaded_radius_blocks() ?? 0,
        // ENG-18 WORLD BORDER: distance-based border proximity 0→1 (0 = far inside, 1 = at/past the wall).
        // The dapp drives its spatial-audio hum loop off this (the engine ships no audio). 0 when unarmed.
        border_proximity: border_prox,
        vram_estimate_bytes: 0,
        camera_position: /** @type {[number, number, number]} */ (
          camera
            ? [Math.round(camera.position.x), Math.round(camera.position.y), Math.round(camera.position.z)]
            : [0, 0, 0]
        ),
        camera_yaw_pitch: /** @type {[number, number]} */ (
          orientation ? [Number(orientation.y.toFixed(2)), Number(orientation.x.toFixed(2))] : [0, 0]
        ),
        // ENG-20: this is the full WebGPU stack (the fork above returns a 'webgl' engine when WebGPU
        // is unavailable). Honest backend readout for the demo HUD + acceptance.
        renderer_backend: /** @type {'webgpu'} */ ('webgpu'),
      }
    },
    _far_mask_debug() {
      // TEST-ONLY (night_watch, 2026-07-04): the deterministic "sheet" oracle. The frame loop feeds
      // far_field.set_resident_mask(ring_manager.for_each_rendered_column, …) every frame; here we replay
      // the SAME drawn-column set against the mask it produced and flag any drawn column the mask didn't
      // mark 255 (= the far shell would poke over drawn near terrain there). Empty mismatches ⇒ the mask
      // covers every drawn column ⇒ no sheet. Divergence between `drawn` and `marked` localises drift.
      const mismatches = /** @type {{ cx: number, cz: number, mask: number }[]} */ ([])
      let drawn = 0
      let marked = 0
      if (far_field && ring_manager) {
        const ff = far_field
        ring_manager.for_each_rendered_column(({ cx, cz }) => {
          drawn += 1
          const mask = ff._mask_value_at(cx, cz)
          if (mask === 255) marked += 1
          else mismatches.push({ cx, cz, mask }) // drawn but not masked (mask 0 in-window, or -1 outside)
        })
      }
      return { drawn, marked, mismatches }
    },
    _far_debug() {
      // TEMP (2026-07-04 far-pop diagnosis): resident far-section ids + queue depth + near radius, so
      // the capture rig can diff ids frame-to-frame (appear-then-vanish = a pop) and correlate to the
      // queue_depth-driven near_radius flip.
      return {
        ids: far_field ? /** @type {any} */ (far_field)._debug_ids() : [],
        queue_depth: ring_manager?.queue_depth() ?? 0,
        near_ring_m: ring_manager?.loaded_radius_blocks() ?? 0,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      run_requested = false
      // Drop closures that capture the released scene immediately. A pending init's settled handler also
      // checks disposed, so neither this queue nor the frame loop can resurrect after teardown.
      pre_boot_queue = null
      frame_loop?.stop()
      hitch_probe.dispose()
      cpu_probe?.dispose()
      // [C1] resolve any in-flight GLB warms (consumers must never hang on a dead engine) + unregister
      // (conditional clear: a tier-swap replacement session may already have registered ITS queue).
      if (pipeline_warm_queue) {
        pipeline_warm_queue.dispose()
        clear_active_pipeline_warm_queue(pipeline_warm_queue)
        pipeline_warm_queue = null
      }
      ambience?.dispose() // [S-AMBIENCE] two-phase free of every pooled ambient particle field
      mana_barrier?.dispose() // ENG-18: free the wall geometry/material + banner sprites
      falls?.dispose() // [B4] free every resident waterfall group + the shared sheet material
      materialization_floor?.dispose() // [FIRST-LOAD] free the holo-grid geometry/material
      far_streamer?.dispose()
      far_field?.dispose()
      far_pool?.dispose()
      ring_manager?.dispose()
      gen_pool?.dispose()
      mesh_pool?.dispose()
      // [perf-③ #1] Free the terrain renderer's fixed pools + CPU ArrayBuffers and release the
      // window.__terrain_renderer hook BEFORE the device teardown below — else the whole stale
      // renderer stays rooted across scene swaps / tier reboots (~299 MB retained).
      dispose_terrain(terrain_renderer, typeof window !== 'undefined' ? /** @type {any} */ (window) : undefined)
      terrain_renderer = null
      renderer_handle?.dispose()
    },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(callback)
      return () => listeners.get(event)?.delete(callback)
    },
  }
  return api
}

/**
 * ENG-20 — the WEBGL-FALLBACK engine. Wraps create_webgl_fallback (a minimal three-core heightmap
 * renderer, NO TSL/post/atmosphere) into the FROZEN EngineApi shape so downstream (the demo, the dapp
 * World tab) drives it identically to the WebGPU engine. It exposes the real camera/collision/scene
 * surface + honest get_stats (renderer_backend:'webgl'), and no-op warn-once stubs for the WebGPU-only
 * features (tactical board / cave / far shell / atmosphere / time-of-day — webgpu_only_stubs).
 *
 * Kept synchronous to honour create_engine's contract: the fallback boots on start() (fire-and-forget,
 * awaited internally) and a boot failure surfaces as a 'boot_error' event, never an unhandled rejection.
 * @param {{ canvas: HTMLCanvasElement, seed: string, zone_origin: [number, number], search?: string }} opts
 * @returns {EngineApi}
 */
function create_webgl_engine({ canvas, seed, zone_origin, search = '' }) {
  /** @type {Map<EngineEvent, Set<(payload: unknown) => void>>} */
  const listeners = new Map()
  /** @param {EngineEvent} event @param {unknown} payload */
  const emit = (event, payload) => {
    if (disposed) return
    for (const cb of listeners.get(event) ?? []) cb(payload)
  }

  /** @type {import('./render/webgl_fallback.js').WebglFallback | null} */
  let fb = null
  /** @type {Promise<import('./render/webgl_fallback.js').WebglFallback> | null} */
  let ready = null
  let disposed = false
  let started = false
  const cpu_probe = create_cpu_probe({ search })
  // Pending pose pushed before the fallback resolves (start() is async). The demo drives the pose every
  // frame, so this just seeds the very first frames; once fb exists the setters delegate straight through.
  /** @type {{ pos: [number, number, number] | null, yaw: number, pitch: number, fov: number | null }} */
  const pending = { pos: null, yaw: 0, pitch: 0, fov: null }
  /** @type {import('three').Object3D[]} */
  const pending_scene_adds = []

  function boot() {
    return create_webgl_fallback({
      canvas,
      seed,
      zone_origin,
      on_frame: cpu_probe
        ? (frame) => {
            cpu_probe.frame(frame)
          }
        : undefined,
    }).then((handle) => {
      if (
        !adopt_async_resource(
          handle,
          () => disposed,
          (value) => (fb = value)
        )
      ) {
        pending_scene_adds.length = 0
        return handle
      }
      if (pending.pos) handle.set_camera_position(pending.pos)
      handle.set_camera_orientation(pending.yaw, pending.pitch)
      if (pending.fov != null) handle.set_camera_fov(pending.fov)
      for (const o of pending_scene_adds) {
        if (disposed) break
        handle.add_to_scene(o)
      }
      pending_scene_adds.length = 0
      return handle
    })
  }

  // The literal below + the spread stubs together provide the FULL EngineApi surface: set_time_of_day/
  // set_tier/set_render_scale/get_terrain_renderer/get_atmosphere come from `stubs` (typed via
  // webgpu_only_stubs' Pick<EngineApi,…> return), everything else is defined here. get_world_mode is
  // redefined below to return the real mode (overriding the stub's placeholder).
  const stubs = webgpu_only_stubs()

  return {
    ...stubs,
    start() {
      if (disposed) throw new Error('engine.js: start() after dispose()')
      started = true
      const boot_ready = (ready ??= boot())
      boot_ready
        .then(() => {
          if (!disposed && started) fb?.start()
        })
        .catch(
          /** @param {unknown} e */ (e) => {
            if (!disposed) emit('boot_error', e)
          }
        )
    },
    stop() {
      started = false
      fb?.stop()
    },
    set_camera_position(position) {
      if (disposed) return
      if (fb) fb.set_camera_position(position)
      else pending.pos = position
    },
    set_camera_orientation(yaw, pitch) {
      if (disposed) return
      if (fb) fb.set_camera_orientation(yaw, pitch)
      else {
        pending.yaw = yaw
        pending.pitch = pitch
      }
    },
    set_camera_fov(fov_degrees) {
      if (disposed) return
      if (fb) fb.set_camera_fov(fov_degrees)
      else pending.fov = fov_degrees
    },
    shake_camera() {
      // [D248] the impact shake is a cinematic-camera cue — a no-op in the webgl heightmap fallback.
    },
    set_motion_blur_enabled() {
      // [D251-2] no motion-blur pass in the webgl heightmap fallback — a no-op.
    },
    set_camera_speed() {
      // [ENG camera-feel] no post stack / motion blur in the webgl heightmap fallback — a no-op.
    },
    sample_block(x, y, z) {
      return fb?.sample_block(x, y, z) ?? 0
    },
    sample_block_analytic(x, y, z) {
      // [FIRST-LOAD] the WebGL floor is a fully-resident static heightmap (no streaming), so there's no
      // unstreamed-chunk case — voxel truth is always available; just delegate to the resident sample.
      return fb?.sample_block(x, y, z) ?? 0
    },
    is_column_resident() {
      // The fallback builds one static heightmap rather than a streamed ring. Once its handle exists, every
      // column exposed through sample_block is resident; before then no collision oracle is ready.
      return fb !== null
    },
    add_to_scene(object3d) {
      if (disposed) return
      if (fb) fb.add_to_scene(object3d)
      else pending_scene_adds.push(object3d)
    },
    remove_from_scene(object3d) {
      if (disposed) return
      fb?.remove_from_scene(object3d)
    },
    get_scene() {
      return fb?.get_scene() ?? null
    },
    get_camera() {
      return fb?.get_camera() ?? null
    },
    set_streaming_paused() {
      // [D213] no-op on the WebGL floor — its static heightmap never streams.
    },
    set_far_fog() {
      // [D213] no-op on the WebGL floor — it has no aerial fog band.
    },
    set_fog_scale() {
      // [D213-B] no-op on the WebGL floor.
    },
    get_world_mode() {
      return /** @type {const} */ ('streaming') // [D210] the fixed/streaming split is dead — one model
    },
    get_zone_bounds() {
      return fb?.get_zone_bounds() ?? null
    },
    // ENG-18 WORLD BORDER: the mana barrier is a TSL shader (WebGPU-only), so the minimal WebGL fallback
    // draws no wall — but the API must exist so the dapp's border wiring is a harmless no-op here. The
    // fallback's own get_zone_bounds still reports the fixed zone; a dapp wanting physics on this path
    // would clamp itself. (Scope: the fallback is a "you at least see the world" tier.)
    set_zone_bounds() {},
    clear_zone_bounds() {},
    set_border_banner() {},
    get_stats() {
      return (
        fb?.get_stats() ?? {
          fps: 0,
          frame_ms_p50: 0,
          frame_ms_p75: 0,
          frame_ms_p99: 0,
          draw_calls: 0,
          quad_count: 0,
          tier: 'low',
          render_scale: 1,
          chunk_queue_depth: 0,
          far_section_count: 0,
          far_section_bytes: 0,
          vram_estimate_bytes: 0,
          renderer_backend: 'webgl',
          border_proximity: 0,
          camera_position: [0, 0, 0],
          camera_yaw_pitch: [0, 0],
        }
      )
    },
    _far_mask_debug() {
      return { drawn: 0, marked: 0, mismatches: [] }
    },
    _far_debug() {
      return { ids: [], queue_depth: 0, near_ring_m: 0 }
    },
    dispose() {
      if (disposed) return
      disposed = true
      started = false
      pending.pos = null
      pending.fov = null
      pending_scene_adds.length = 0
      cpu_probe?.dispose()
      const handle = fb
      fb = null
      handle?.dispose()
    },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(callback)
      return () => listeners.get(event)?.delete(callback)
    },
  }
}

/** Far-section worker count — ONE far worker, memory-bound. Each far worker IS a full gen-graph REALM
 *  committing ~450 MB renderer RSS at the boot burst (measured slope, dev AND prod — same class as a gen
 *  worker), so the heavy budget is gen+far, never mesh (mesh realms are ~0.7 MB heap — see
 *  mesh_worker_count). [Walk-soak 2026-07-11] far=2 was TRIED and REVERTED: a headed MEDIUM demo soak
 *  (gen=2 + mesh=6 + far=2) drove the RENDERER process to 1.8 GB at boot-settle → 2.35 GB peak while the
 *  far shell kept streaming — dangerously close to the ~2.5 GB "Aw Snap" tab ceiling, vs a ~1.6 GB safe
 *  plateau. Dropping far back to 1 removes that heavy realm; the near ring (the thing walkability depends
 *  on) keeps frame priority via the streamer's queue-drained dispatch gate regardless, so a single far
 *  worker only slows the HORIZON fill, not the walk. Measured ladder (MEDIUM r7 demo boot): 12g+12m+3f ≈
 *  5.3 GB dead · 6g+6m+2f ≈ 2.6 GB dead · 2g+2m+1f ≈ 2.1 GB alive. The [SAB-wave audit] in pool.js
 *  explains why sharing gen tables cannot raise gen/far past this churn-RSS ceiling. @returns {number} */
function default_far_worker_count() {
  return 1
}

/** Reads the `?farvoxel=N` boot flag (house switchboard) — the far-shell BLOCKY-LOD ceiling override.
 *  Returns undefined (⇒ the worker uses build_far_mesh's safe default cap = FAR_VOXEL_MAX_LEVEL) when the
 *  flag is absent or no DOM location. Present ⇒ clamped to [0,3]; N≥3 logs a one-line memory-risk warning
 *  (the far-shell geometry can reach ~98% of the 64 MB far-mem cap — trailer/close-radius shots only).
 *  @returns {number | undefined} */
function read_farvoxel_override() {
  if (typeof location === 'undefined') return undefined
  const raw = new URLSearchParams(location.search).get('farvoxel')
  if (raw === null) return undefined
  const n = Math.max(0, Math.min(3, Number.parseInt(raw, 10) || 0))
  if (n >= 3) {
    console.warn(
      `[far] ?farvoxel=${n}: blocky far-LOD raised to L${n} — far-shell geometry can reach ~98% of the 64 MB far-mem cap; trailer/close-radius use only.`
    )
  }
  return n
}

/** Reads the `?farterrace=1` boot flag (house switchboard) — the TERRACE far band (S-27 round 2). ON ⇒
 *  the band (voxel ceiling, L3] meshes as y-quantized greedy-merged contour terraces; `?terracem=N`
 *  overrides the layer height in meters (clamped [1,8]; undefined ⇒ the mesher default TERRACE_LAYER_M).
 *  @returns {{ max: number, layer_m: number | undefined } | undefined} */
function read_farterrace_override() {
  if (typeof location === 'undefined') return undefined
  const params = new URLSearchParams(location.search)
  if (params.get('farterrace') !== '1') return undefined
  const raw = Number.parseInt(params.get('terracem') ?? '', 10)
  return { max: 3, layer_m: Number.isFinite(raw) ? Math.max(1, Math.min(8, raw)) : undefined }
}
