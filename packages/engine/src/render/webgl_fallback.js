// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-20 — WEBGL FALLBACK RENDERER. 2026-07-05.
// ============================================================================================
// SPEC: a WebGL fallback that is only a
// height map of basic blocks, no specific lightning or post processing.
//
// THE FROZEN FLOOR (the spec above — do NOT gold-plate):
//   • the world is a HEIGHTMAP OF BLOCKS: one box per world column at its surface height, coloured by
//     the surface block's PALETTE colour (block_registry map_color) via flat vertex colours. Columns
//     are merged into ONE BufferGeometry per 32×32 tile for draw-call sanity (no instancing beyond).
//   • NO lighting model, NO post, NO atmosphere, NO fog, NO shadows, NO TSL ANYWHERE — this module
//     imports three CORE only ('three', not 'three/webgpu'). The material is MeshBasicMaterial (unlit) —
//     there is NO light in the scene at all. Face FORM reads via a STATIC per-face brightness factor
//     baked into the vertex colour at build time (top brightest, side walls dimmer per axis — the
//     classic voxel look), which is pure vertex data, not a runtime lighting model. Sky = a flat clear
//     colour (renderer.setClearColor). MeshBasicMaterial is listed first because it's the
//     literal "no specific lightning" — and it dodges the muddy grazing-angle darkening a Lambert
//     hemisphere gives long side walls.
//   • same CAMERA/CONTROLLER surface as the WebGPU path: set_camera_position/orientation/fov apply to
//     the same three camera the fly/walk demo drives; sample_block reads the heightmap (stand on
//     surface y) so the demo's walk-mode collision works unchanged.
//   • same PUBLIC EngineApi SHAPE: get_stats() returns honest minimal stats + renderer_backend:'webgl';
//     the WebGPU-only features (tactical board / cave / far shell / underwater / atmosphere / time-of-
//     day) are no-op stubs that console.warn ONCE each (see WARN_ONCE below for the exact list).
//   • FIXED-WORLD mode: the heightmap covers the 300 m zone at full resolution + a COARSE ring beyond
//     (4×4-block cells) for a cheap static horizon. Streaming mode covers a fixed box around spawn.
//
// This is a SEPARATE boot path from core/renderer.js (which is WebGPURenderer + the whole TSL stack).
// engine.js forks to create_webgl_fallback() when the backend is 'webgl' and NEVER touches the WebGPU
// renderer in that path — so a machine with no navigator.gpu (or ?force_webgl=1) gets trivial geometry
// and a solid clear colour, nothing else.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  WebGLRenderer,
} from 'three'

import { CHUNK_SIZE } from '../config/world_config.js'
import { create_gen_context } from '../gen/column_gen.js'
import { get_block_by_id } from '../config/block_registry.js'
import { extract_heightmap, surface_column } from '../gen/heightmap.js'

import { park_node_material_objects, prepare_webgl_scene_object } from './webgl_scene_fallback.js'

export { park_node_material_objects, prepare_webgl_scene_object } from './webgl_scene_fallback.js'
const ZONE_SIZE_METERS = 600 // [D210] fixed_world is deleted; the floor keeps its own span constant (matches the default border box)

/** @typedef {import('../core/quality/tiers.js').TierName} TierName */
/** @typedef {import('../gen/heightmap.js').HeightmapGrid} HeightmapGrid */

/** Sky clear colour — a flat clean daytime blue (NO atmosphere/gradient shader per the floor: this is
 *  the single background colour renderer.setClearColor paints behind the blocks). */
const SKY_CLEAR = 0x8fb8e6

/** How many blocks each column box extrudes DOWNWARD from its surface (the visible skirt / side walls).
 *  A finite skirt (not down to y=0) keeps the geometry light while still giving every column solid side
 *  faces so height steps read as blocky cliffs. The bottom face is never emitted (never seen). */
const SKIRT_DEPTH = 8

/** STATIC per-face brightness (the fake-AO / directional read baked into vertex colours — NOT a light).
 *  Top faces full, ±X walls a touch dimmer, ±Z walls dimmest — the standard Minecraft-style face shade
 *  that lets blocky form read with an UNLIT MeshBasicMaterial (no light in the scene). Pure data. */
const FACE_SHADE = { top: 1.0, x: 0.78, z: 0.62 }

/** Coarse horizon ring: cell edge in blocks (4×4-block cells) and how far the ring extends beyond the
 *  full-res zone, in METERS. A cheap static low-detail band so the horizon isn't a hard void edge. */
const COARSE_CELL = 4
const COARSE_RING_M = 512

/** Streaming-mode fallback footprint: a fixed full-res box (in blocks) centred on the spawn column, plus
 *  the same coarse ring. The fallback does NOT stream (spec: "only a height map") — it lays a
 *  generous static field once so walking around spawn stays on real ground. */
const STREAMING_FIELD_M = 512

/** Camera projection — matches core/renderer.js's defaults (fov 70, near 0.1) so the demo poses frame
 *  the same way; a modest far plane (the fallback world is bounded, no km-scale far shell). */
const CAM_FOV = 70
const CAM_NEAR = 0.1
const CAM_FAR = 4000

/** WebGPU-only feature stubs — each warns ONCE (the first call) then no-ops, so the demo/dapp wiring
 *  that calls them under WebGPU degrades cleanly here instead of throwing. Documented set:
 *  tactical board, cave scene, far shell, underwater immersion, atmosphere/god-rays, time-of-day. */
const WARNED = new Set()
/** @param {string} feature */
function warn_once(feature) {
  if (WARNED.has(feature)) return
  WARNED.add(feature)
  console.warn(`[webgl-fallback] "${feature}" is a WebGPU-only feature — no-op in the WebGL fallback.`)
}

/**
 * @typedef {object} WebglFallbackOptions
 * @property {HTMLCanvasElement} canvas the render canvas (the fallback owns its WebGL context).
 * @property {string} seed world seed — the heightmap is extracted deterministically from it.

 *   around spawn. Both lay a coarse horizon ring; neither streams (per spec).
 * @property {[number, number]} zone_origin world-space [x, z] METERS the field is centred on.
 * @property {(frame:{start_ms:number,render_start_ms:number,render_end_ms:number,end_ms:number,frame_ms:number})=>void} [on_frame]
 */

/**
 * @typedef {object} WebglFallback the minimal renderer handle engine.js drives in the webgl path. It
 *   mirrors the slice of core/renderer.js + the frame loop the engine needs, plus the EngineApi
 *   surface the demo calls. All heavy WebGPU-only methods are no-op warn-once stubs.
 * @property {() => void} start begins the render loop (rAF; the fallback has no fixed-step sim).
 * @property {() => void} stop halts the render loop.
 * @property {(position: [number, number, number]) => void} set_camera_position
 * @property {(yaw: number, pitch: number) => void} set_camera_orientation
 * @property {(fov_degrees: number) => void} set_camera_fov
 * @property {(x: number, y: number, z: number) => number} sample_block heightmap collision oracle.
 * @property {(o: import('three').Object3D) => void} add_to_scene
 * @property {(o: import('three').Object3D) => void} remove_from_scene
 * @property {() => Scene} get_scene
 * @property {() => PerspectiveCamera} get_camera
 * @property {() => { min_x: number, min_z: number, max_x: number, max_z: number } | null} get_zone_bounds
 * @property {() => import('../engine.js').EngineStats} get_stats includes renderer_backend:'webgl'.
 * @property {() => void} dispose
 */

/**
 * Boots the minimal WebGL fallback: a heightmap-of-blocks world (unlit MeshBasicMaterial, static
 * per-face-shaded vertex colours), a flat sky clear colour, NO lights. Synchronous heavy lifting
 * (heightmap extract + mesh build) runs here so the caller can await
 * a resolved promise; the geometry is trivial (a few hundred draw calls) so this is milliseconds.
 * @param {WebglFallbackOptions} options
 * @returns {Promise<WebglFallback>}
 */
export async function create_webgl_fallback({ canvas, seed, zone_origin, on_frame }) {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(SKY_CLEAR, 1)
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2))

  const scene = new Scene()
  // NO light in the scene (spec: "no specific lightning"). The material is unlit
  // MeshBasicMaterial; face form reads from the STATIC per-face brightness baked into vertex colours
  // (FACE_SHADE) at build time — the classic voxel look with zero runtime lighting.

  const camera = new PerspectiveCamera(CAM_FOV, aspect_of(canvas), CAM_NEAR, CAM_FAR)
  camera.position.set(0, 0, 0)

  // ---- Camera pose state (fly_camera parity: set_position/orientation apply each frame) ------------
  let [px, pz] = zone_origin
  let py = 0
  let yaw = 0
  let pitch = 0
  const euler = new Euler(0, 0, 0, 'YXZ')
  const quat = new Quaternion()

  // ---- Heightmap + collision context --------------------------------------------------------------
  const gen = create_gen_context(seed)
  // The full-res field: the 300 m zone in fixed mode, else a static box around spawn. cell_size 1.
  const field_m = ZONE_SIZE_METERS // [D210] one model — the floor spans the border box
  const half = Math.floor(field_m / 2)
  const min_x = Math.floor(zone_origin[0]) - half
  const min_z = Math.floor(zone_origin[1]) - half
  const fine = extract_heightmap({ gen, origin_x: min_x, origin_z: min_z, cols: field_m, rows: field_m, cell_size: 1 })

  // Build the world geometry: full-res zone (merged per 32-block tile) + the coarse horizon ring.
  const meshes = build_world_meshes(fine)
  const coarse_meshes = build_coarse_ring(gen, zone_origin, field_m)
  let draw_calls = 0
  let quad_count = 0
  for (const m of [...meshes, ...coarse_meshes]) {
    scene.add(m)
    draw_calls += 1
    quad_count += (m.geometry.getAttribute('position').count / 6) | 0 // 6 verts/quad (2 tris, non-indexed)
  }

  // Zone bounds (fixed mode only — the ENG-18 border reads these; streaming has no bounded zone).
  const zone_bounds = {
    min_x: zone_origin[0] - ZONE_SIZE_METERS / 2,
    min_z: zone_origin[1] - ZONE_SIZE_METERS / 2,
    max_x: zone_origin[0] + ZONE_SIZE_METERS / 2,
    max_z: zone_origin[1] + ZONE_SIZE_METERS / 2,
  }

  // ---- Single-owner resize (parity with renderer.js: setSize reallocates the drawing buffer) -------
  function apply_size() {
    const width = canvas.clientWidth || canvas.width || 1
    const height = canvas.clientHeight || canvas.height || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  apply_size()
  const resize_observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply_size) : null
  resize_observer?.observe(canvas)

  // ---- Frame loop (rAF render only; fps/frame-ms rolling window for honest get_stats) --------------
  let raf = 0
  let running = false
  let last_t = 0
  const visibility_document = typeof document === 'undefined' ? null : document
  /** @type {number[]} */
  const frame_ms = []
  const FRAME_WINDOW = 120
  const document_hidden = () =>
    visibility_document?.hidden === true || visibility_document?.visibilityState === 'hidden'

  function schedule_frame() {
    if (!running || document_hidden() || raf !== 0) return
    raf = requestAnimationFrame(render_frame)
  }

  function on_visibility_change() {
    if (!running) return
    if (document_hidden()) {
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
      return
    }
    last_t = 0
    schedule_frame()
  }

  /** @param {number} now */
  function render_frame(now) {
    raf = 0
    if (!running || document_hidden()) return
    const elapsed_frame_ms = last_t ? now - last_t : 0
    if (last_t) push_frame_ms(frame_ms, elapsed_frame_ms, FRAME_WINDOW)
    last_t = now
    const cpu_frame_start = on_frame ? performance.now() : 0
    // Apply the current camera pose (idempotent, matches fly_camera.apply()).
    camera.position.set(px, py, pz)
    euler.set(pitch, yaw, 0)
    quat.setFromEuler(euler)
    camera.quaternion.copy(quat)
    const cpu_render_start = on_frame ? performance.now() : 0
    try {
      renderer.render(scene, camera)
    } catch (error) {
      // SELF-HEAL (belt to add_to_scene's suspenders): a node-material object ATTACHED AFTER its root was
      // added (per-frame VFX mounts) still reaches the compile and throws. Park every node-material object
      // now and keep the loop alive — the world must never die over an unrenderable cosmetic. A throw with
      // NOTHING to park is a genuine renderer fault → stay loud (rethrow; the loop halts as before).
      const parked = park_node_material_objects(scene)
      if (parked === 0) throw error
      warn_once('TSL/node-material scene objects (parked — unrenderable on the classic renderer)')
    }
    if (on_frame) {
      const end_ms = performance.now()
      on_frame({
        start_ms: cpu_frame_start,
        render_start_ms: cpu_render_start,
        render_end_ms: end_ms,
        end_ms,
        frame_ms: elapsed_frame_ms,
      })
    }
    schedule_frame()
  }

  return {
    start() {
      if (running) return
      running = true
      last_t = 0
      visibility_document?.addEventListener('visibilitychange', on_visibility_change)
      schedule_frame()
    },
    stop() {
      running = false
      visibility_document?.removeEventListener('visibilitychange', on_visibility_change)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    },
    set_camera_position(position) {
      ;[px, py, pz] = position
    },
    set_camera_orientation(new_yaw, new_pitch) {
      yaw = new_yaw
      pitch = new_pitch
    },
    set_camera_fov(fov_degrees) {
      if (typeof fov_degrees !== 'number' || !Number.isFinite(fov_degrees) || camera.fov === fov_degrees) return
      camera.fov = fov_degrees
      camera.updateProjectionMatrix()
    },
    sample_block(x, y, z) {
      return sample_heightmap_collision(gen, x, y, z)
    },
    add_to_scene(object3d) {
      // Park any node-material subtree on the hidden layer BEFORE the first render sees it (the classic
      // renderer cannot compile three/webgpu NodeMaterials — the resolveIncludes crash class). The app's
      // WebGPU-only cosmetics (auras / VFX quads / overlays) thus degrade to invisible here, per the floor.
      prepare_webgl_scene_object(object3d, {
        on_node_material: () =>
          warn_once('TSL/node-material scene objects (parked — unrenderable on the classic renderer)'),
      })
      scene.add(object3d)
    },
    remove_from_scene(object3d) {
      scene.remove(object3d)
    },
    get_scene() {
      return scene
    },
    get_camera() {
      return camera
    },
    get_zone_bounds() {
      return zone_bounds
    },
    get_stats() {
      const stats = frame_stats(frame_ms)
      return {
        fps: stats.fps,
        frame_ms_p50: stats.p50,
        frame_ms_p75: stats.p75,
        frame_ms_p99: stats.p99,
        draw_calls,
        quad_count,
        tier: /** @type {TierName} */ ('low'), // honest: the fallback is the lowest visual rung
        render_scale: 1,
        time_of_day: 0, // no physical sky/sun here (day_factor() is pinned to 1 too) — completes the shape
        chunk_queue_depth: 0, // no streaming in the fallback
        far_section_count: 0,
        far_section_bytes: 0,
        vram_estimate_bytes: 0,
        renderer_backend: /** @type {'webgl'} */ ('webgl'),
        camera_position: /** @type {[number, number, number]} */ ([
          Math.round(camera.position.x),
          Math.round(camera.position.y),
          Math.round(camera.position.z),
        ]),
        camera_yaw_pitch: /** @type {[number, number]} */ ([Number(yaw.toFixed(2)), Number(pitch.toFixed(2))]),
      }
    },
    dispose() {
      running = false
      visibility_document?.removeEventListener('visibilitychange', on_visibility_change)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      resize_observer?.disconnect()
      for (const m of scene.children) if (m instanceof Mesh) m.geometry.dispose()
      renderer.dispose()
    },
  }
}

// =================================================================================================
// WebGPU-only feature stubs — engine.js wires these onto the returned api so the frozen EngineApi
// shape is complete in the webgl path. They warn ONCE then no-op. Exported so engine.js composes them
// without duplicating the warn-once logic (single home for the stub set).
// =================================================================================================

/** The no-op warn-once stubs for the features the WebGPU stack owns exclusively. engine.js spreads
 *  these into the webgl-path api object so the frozen EngineApi shape is complete without duplicating
 *  the warn-once logic. Typed as the exact EngineApi members it supplies so the spread contributes
 *  typed members (no cast needed at the call site). `get_world_mode` is overridden by engine.js with
 *  the real world_mode; it lives here so the bag is a complete facade standalone.
 *  @returns {Pick<import('../engine.js').EngineApi, 'set_time_of_day' | 'day_factor' | 'configure_night_lighting' | 'set_atmosphere_params' | 'set_tier' | 'set_render_scale' | 'get_terrain_renderer' | 'get_atmosphere' | 'get_board_occlusion' | 'get_world_mode'>} */
export function webgpu_only_stubs() {
  return {
    set_time_of_day() {
      warn_once('time-of-day / day-night')
    },
    // No physical sky/sun on the WebGL fallback ⇒ always full day (the gather props simply don't night-dim here —
    // an honest low-end degradation; the frontend reads engine.day_factor?.() ?? 1 either way).
    day_factor() {
      return 1
    },
    configure_night_lighting() {
      warn_once('night-lighting dials (moon/ambient/water floor)')
    },
    set_atmosphere_params() {
      warn_once('physical atmosphere params (Hillaire sky)')
    },
    set_tier() {
      warn_once('quality tiers')
    },
    set_render_scale() {
      warn_once('dynamic render scale')
    },
    get_terrain_renderer() {
      warn_once('terrain renderer seam (cave room)')
      return null
    },
    get_atmosphere() {
      warn_once('atmosphere / god-rays (cave room)')
      return null
    },
    get_board_occlusion() {
      // D167-B: the WebGL fallback has no TSL terrain, so board occlusion is a no-op here. Return an
      // inert handle with the same shape so the tactical facade can arm/disarm it harmlessly (the
      // fallback still renders the board geometry itself — it just never dissolves occluders).
      return /** @type {*} */ ({
        active: { value: 0 },
        center: { value: null },
        radius: { value: 1 },
        set_active() {},
        set_bounds() {},
      })
    },
    get_world_mode() {
      // Not really WebGPU-only — engine.js overrides this with the real world_mode; kept here so the
      // stub bag is a complete facade if used standalone.
      return 'streaming'
    },
  }
}

// =================================================================================================
// Heightmap → geometry. One MERGED BufferGeometry per 32×32 world tile: every column in the tile
// contributes its TOP quad + up to 4 SIDE quads (only where the neighbour is lower, so interior
// shared walls are skipped) as flat-coloured vertices. No index buffer (non-indexed tris keep the
// builder dead-simple and the vertex count is small). Colours are the block's map_color.
// =================================================================================================

/**
 * Builds the full-resolution world meshes — one Mesh per 32×32 tile of the fine grid. Tiling keeps
 * each geometry small (draw-call sanity) without any instancing machinery.
 * @param {HeightmapGrid} grid the cell_size-1 field.
 * @returns {Mesh[]}
 */
function build_world_meshes(grid) {
  /** @type {Mesh[]} */
  const meshes = []
  // DoubleSide: the fallback's geometry is trivial (a few hundred draws), so we don't rely on precise
  // per-face winding for back-face culling — DoubleSide guarantees no see-through on any wall regardless
  // of winding, which is the robust choice for a fallback. ONE shared material across all tiles.
  const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
  for (let tz = 0; tz < grid.rows; tz += CHUNK_SIZE) {
    for (let tx = 0; tx < grid.cols; tx += CHUNK_SIZE) {
      const tile_cols = Math.min(CHUNK_SIZE, grid.cols - tx)
      const tile_rows = Math.min(CHUNK_SIZE, grid.rows - tz)
      const geometry = build_tile_geometry(grid, tx, tz, tile_cols, tile_rows)
      if (geometry) meshes.push(new Mesh(geometry, material))
    }
  }
  return meshes
}

/**
 * Builds ONE tile's merged geometry from the fine grid, over the cell rectangle [tx, tx+w) × [tz, tz+h).
 * Emits per column: a TOP quad at surface_y+1 (the block's top face) and, per cardinal neighbour that
 * sits lower (or the tile/world edge), the exposed SIDE quad down to the neighbour height (or a skirt).
 * @param {HeightmapGrid} grid
 * @param {number} tx tile origin col @param {number} tz tile origin row
 * @param {number} w cells along X @param {number} h cells along Z
 * @returns {BufferGeometry | null} null if the tile emitted no geometry (0 cells).
 */
function build_tile_geometry(grid, tx, tz, w, h) {
  /** @type {number[]} */
  const positions = []
  /** @type {number[]} */
  const colors = []
  const s = grid.cell_size

  for (let lz = 0; lz < h; lz += 1) {
    for (let lx = 0; lx < w; lx += 1) {
      const col = tx + lx
      const row = tz + lz
      const i = row * grid.cols + col
      const sy = grid.surface_y[i]
      const wx = grid.origin_x + col * s
      const wz = grid.origin_z + row * s
      const [r, g, b] = color_of(grid.block_id[i])
      const top = sy + 1 // top face sits ON TOP of the surface block

      // TOP face (always visible from above) — full brightness.
      push_quad(
        positions,
        colors,
        [wx, top, wz],
        [wx + s, top, wz],
        [wx + s, top, wz + s],
        [wx, top, wz + s],
        r,
        g,
        b,
        FACE_SHADE.top
      )

      // SIDE faces: only toward a LOWER neighbour (or the edge), down to that neighbour's top (a step),
      // floored by a skirt so edges of the field still show a wall. Interior equal/higher walls skip.
      side_face(positions, colors, grid, col - 1, row, wx, wz, s, top, r, g, b, 'nx')
      side_face(positions, colors, grid, col + 1, row, wx, wz, s, top, r, g, b, 'px')
      side_face(positions, colors, grid, col, row - 1, wx, wz, s, top, r, g, b, 'nz')
      side_face(positions, colors, grid, col, row + 1, wx, wz, s, top, r, g, b, 'pz')
    }
  }

  if (positions.length === 0) return null
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  return geometry
}

/**
 * Emits ONE side quad for a column toward one cardinal neighbour, IF that neighbour is lower (or the
 * grid edge). The wall spans from this column's top down to max(neighbour_top, top − SKIRT_DEPTH), and
 * carries the static per-axis face shade (±X dimmer, ±Z dimmest) so form reads with the unlit material.
 * @param {number[]} positions @param {number[]} colors
 * @param {HeightmapGrid} grid
 * @param {number} ncol neighbour col @param {number} nrow neighbour row
 * @param {number} wx column world x (SW corner) @param {number} wz column world z (SW corner)
 * @param {number} s cell size @param {number} top this column's top world-y
 * @param {number} r @param {number} g @param {number} b flat colour
 * @param {'nx'|'px'|'nz'|'pz'} dir which face
 */
function side_face(positions, colors, grid, ncol, nrow, wx, wz, s, top, r, g, b, dir) {
  let neighbour_top
  if (ncol < 0 || ncol >= grid.cols || nrow < 0 || nrow >= grid.rows) {
    neighbour_top = top - SKIRT_DEPTH // field edge — drop a skirt so the border isn't a floating slab
  } else {
    neighbour_top = grid.surface_y[nrow * grid.cols + ncol] + 1
  }
  const bottom = Math.max(neighbour_top, top - SKIRT_DEPTH)
  if (bottom >= top) return // neighbour is equal/higher — this wall is hidden

  // Quad corners wound CCW seen from outside the column. Shade: ±X walls FACE_SHADE.x, ±Z walls .z.
  if (dir === 'nx') {
    push_quad(
      positions,
      colors,
      [wx, top, wz + s],
      [wx, top, wz],
      [wx, bottom, wz],
      [wx, bottom, wz + s],
      r,
      g,
      b,
      FACE_SHADE.x
    )
  } else if (dir === 'px') {
    push_quad(
      positions,
      colors,
      [wx + s, top, wz],
      [wx + s, top, wz + s],
      [wx + s, bottom, wz + s],
      [wx + s, bottom, wz],
      r,
      g,
      b,
      FACE_SHADE.x
    )
  } else if (dir === 'nz') {
    push_quad(
      positions,
      colors,
      [wx, top, wz],
      [wx + s, top, wz],
      [wx + s, bottom, wz],
      [wx, bottom, wz],
      r,
      g,
      b,
      FACE_SHADE.z
    )
  } else {
    push_quad(
      positions,
      colors,
      [wx + s, top, wz + s],
      [wx, top, wz + s],
      [wx, bottom, wz + s],
      [wx + s, bottom, wz + s],
      r,
      g,
      b,
      FACE_SHADE.z
    )
  }
}

/**
 * Builds the COARSE horizon ring: 4×4-block cells covering an annulus from the full-res field edge out
 * to COARSE_RING_M beyond it, as ONE merged geometry (top face + a one-cell skirt per cell so big steps
 * don't show sky slivers — a cheap static low-detail band). Skips cells inside the full-res field.
 * @param {import('../gen/column_gen.js').GenContext} gen
 * @param {[number, number]} zone_origin
 * @param {number} field_m the full-res field edge in blocks (its half-extent is field_m/2).
 * @returns {Mesh[]}
 */
function build_coarse_ring(gen, zone_origin, field_m) {
  const inner_half = Math.floor(field_m / 2)
  const outer_half = inner_half + COARSE_RING_M
  // Snap the coarse grid origin to a COARSE_CELL boundary so cells tile cleanly.
  const origin_x = Math.floor((zone_origin[0] - outer_half) / COARSE_CELL) * COARSE_CELL
  const origin_z = Math.floor((zone_origin[1] - outer_half) / COARSE_CELL) * COARSE_CELL
  const span = outer_half * 2
  const cells = Math.ceil(span / COARSE_CELL)
  const grid = extract_heightmap({ gen, origin_x, origin_z, cols: cells, rows: cells, cell_size: COARSE_CELL })

  /** @type {number[]} */
  const positions = []
  /** @type {number[]} */
  const colors = []
  const inner_min_x = zone_origin[0] - inner_half
  const inner_max_x = zone_origin[0] + inner_half
  const inner_min_z = zone_origin[1] - inner_half
  const inner_max_z = zone_origin[1] + inner_half

  for (let row = 0; row < grid.rows; row += 1) {
    const wz = origin_z + row * COARSE_CELL
    for (let col = 0; col < grid.cols; col += 1) {
      const wx = origin_x + col * COARSE_CELL
      // Skip cells fully inside the full-res field (avoid double geometry / z-fight at the seam).
      if (wx + COARSE_CELL > inner_min_x && wx < inner_max_x && wz + COARSE_CELL > inner_min_z && wz < inner_max_z) {
        continue
      }
      const i = row * grid.cols + col
      const top = grid.surface_y[i] + 1
      const [r, g, b] = color_of(grid.block_id[i])
      // TOP face (full brightness). Distant cells drop a short skirt on all 4 sides so a big step to a
      // lower neighbour cell doesn't show a sky sliver through the horizon carpet (cheap, still static).
      push_quad(
        positions,
        colors,
        [wx, top, wz],
        [wx + COARSE_CELL, top, wz],
        [wx + COARSE_CELL, top, wz + COARSE_CELL],
        [wx, top, wz + COARSE_CELL],
        r,
        g,
        b,
        FACE_SHADE.top
      )
      const skirt = top - COARSE_CELL // a one-cell skirt closes inter-cell gaps at the horizon
      push_quad(
        positions,
        colors, // −X
        [wx, top, wz + COARSE_CELL],
        [wx, top, wz],
        [wx, skirt, wz],
        [wx, skirt, wz + COARSE_CELL],
        r,
        g,
        b,
        FACE_SHADE.x
      )
      push_quad(
        positions,
        colors, // +X
        [wx + COARSE_CELL, top, wz],
        [wx + COARSE_CELL, top, wz + COARSE_CELL],
        [wx + COARSE_CELL, skirt, wz + COARSE_CELL],
        [wx + COARSE_CELL, skirt, wz],
        r,
        g,
        b,
        FACE_SHADE.x
      )
      push_quad(
        positions,
        colors, // −Z
        [wx, top, wz],
        [wx + COARSE_CELL, top, wz],
        [wx + COARSE_CELL, skirt, wz],
        [wx, skirt, wz],
        r,
        g,
        b,
        FACE_SHADE.z
      )
      push_quad(
        positions,
        colors, // +Z
        [wx + COARSE_CELL, top, wz + COARSE_CELL],
        [wx, top, wz + COARSE_CELL],
        [wx, skirt, wz + COARSE_CELL],
        [wx + COARSE_CELL, skirt, wz + COARSE_CELL],
        r,
        g,
        b,
        FACE_SHADE.z
      )
    }
  }

  if (positions.length === 0) return []
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  return [new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }))]
}

/**
 * Pushes ONE quad (two CCW triangles) into the flat position/color arrays. Corners a,b,c,d in winding
 * order; the quad is split a-b-c + a-c-d. All four verts share the flat colour × the static face shade
 * (the baked directional read — no light node). No normals emitted (MeshBasicMaterial is unlit).
 * @param {number[]} positions @param {number[]} colors
 * @param {[number,number,number]} a @param {[number,number,number]} b
 * @param {[number,number,number]} c @param {[number,number,number]} d
 * @param {number} r @param {number} g @param {number} b_ colour 0..1
 * @param {number} shade static per-face brightness (FACE_SHADE.top / .x / .z)
 */
function push_quad(positions, colors, a, b, c, d, r, g, b_, shade) {
  for (const v of [a, b, c, a, c, d]) {
    positions.push(v[0], v[1], v[2])
    colors.push(r * shade, g * shade, b_ * shade)
  }
}

/** Scratch Color for map_color → linear RGB conversion (three renders in linear space; a hex map_color
 *  is sRGB, so convertSRGBToLinear keeps the palette looking right). Cached per block id. */
const _color = new Color()
/** @type {Map<number, [number, number, number]>} */
const COLOR_CACHE = new Map()
/** Linear RGB (0..1) for a block id's map_color, cached. @param {number} block_id @returns {[number,number,number]} */
function color_of(block_id) {
  const hit = COLOR_CACHE.get(block_id)
  if (hit) return hit
  const hex = get_block_by_id(block_id)?.map_color ?? '#808080'
  _color.set(hex).convertSRGBToLinear()
  /** @type {[number, number, number]} */
  const rgb = [_color.r, _color.g, _color.b]
  COLOR_CACHE.set(block_id, rgb)
  return rgb
}

// =================================================================================================
// Collision — the heightmap IS the collision. sample_block returns a solid block below the column's
// surface and air above, so the demo's walk-mode controller (which scans top-down for ground with
// headroom) lands the player on the surface exactly like the WebGPU path.
// =================================================================================================

/**
 * Block id at a world voxel from the heightmap (solid at/below surface, air above). This makes the
 * demo's find_open_spawn/ground_surface_y scan work unchanged: the topmost solid is at surface_y, the
 * cells above are air (headroom), so the player stands on the surface.
 * @param {import('../gen/column_gen.js').GenContext} gen
 * @param {number} x @param {number} y @param {number} z world voxel coords (floored to a column)
 * @returns {number} block id (0 = air)
 */
export function sample_heightmap_collision(gen, x, y, z) {
  const { surface_y, ground_block_id } = surface_column(gen, Math.floor(x), Math.floor(z))
  return y <= surface_y ? ground_block_id : 0
}

/** @param {HTMLCanvasElement} canvas @returns {number} */
function aspect_of(canvas) {
  const w = canvas.clientWidth || canvas.width || 1
  const h = canvas.clientHeight || canvas.height || 1
  return w / h
}

// ---- Rolling frame-time window (honest fps / percentiles in get_stats, no streaming machinery) -----

/** @param {number[]} window @param {number} ms @param {number} cap */
function push_frame_ms(window, ms, cap) {
  window.push(ms)
  if (window.length > cap) window.shift()
}

/** @param {number[]} window @returns {{ fps: number, p50: number, p75: number, p99: number }} */
function frame_stats(window) {
  if (window.length === 0) return { fps: 0, p50: 0, p75: 0, p99: 0 }
  const sorted = [...window].sort((a, b) => a - b)
  const pct = (/** @type {number} */ p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const p50 = pct(0.5)
  return { fps: p50 > 0 ? 1000 / p50 : 0, p50, p75: pct(0.75), p99: pct(0.99) }
}
