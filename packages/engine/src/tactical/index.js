// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — TACTICAL BOARD FACADE (the one dapp-facing surface).
//
// Assembles the five tactical modules (geometry / picking / highlights / camera / entities) into ONE
// BoardHandle that satisfies BOTH specs the ticket is law under:
//   • the §7 engine API contract (eng16-tactical-study.md): cell_at_ray / set_cell_state /
//     clear_states / camera_rig / teardown, cell_size default 2, floor-snap picking, shape_mask.
//   • the SEALED v1.1 dapp contract (board_api_contract.md): board.build (RETURNS A PROMISE — async
//     mount) / teardown / highlight(layer,cells,on) / entity_upsert / entity_remove / entity_move
//     (resolves on arrival) / entity_beat (resolves at IMPACT FRAME) / camera_lock(anchor)+release /
//     on('cell_click'|'cell_hover'|'entity_hover').
//
// The engine owns pixels; the dapp owns truth — every cell set comes from the dapp's overlay_intents,
// the engine paints WHAT it's told, never WHY. Board is WORLD-AXIS-ALIGNED, Cell {x,y} = +x east / +y
// north from the board origin. Idempotent re-calls (build/upsert on a reconcile storm) are cheap. The
// factory takes the engine handle (create_engine's return) + a canvas for input; a single rAF here
// drives the camera-rig pose AND the entity tick so beats/walks/floats animate on the same clock.
// 2026-07-04.

import { Matrix4, Vector3 } from 'three'

import { ground_surface_y } from '../player/spawn.js'

import { build_board_geometry, DEFAULT_CELL_SIZE, CELL_OBSTACLE, CELL_HOLE, CELL_VOID } from './board.js'
import { create_board_picking, cell_from_raycaster } from './board_picking.js'
import { create_board_highlights } from './board_highlights.js'
import { create_board_camera } from './board_camera.js'
import { create_board_entities } from './board_entities.js'
import { project_board_screen } from './board_occlusion.js'

// TEAM PALETTE (ally/enemy) — re-exported at the tactical facade so the dapp adapter reads the SAME ally/
// enemy hexes the seat-glow channels + entity outline use (single source; see board_highlights TEAM_COLORS).
export { GLYPH_TICK_FLARE, TEAM_COLORS } from './board_highlights.js'

/**
 * @typedef {object} BoardHandle
 * // ── §7 contract ──
 * @property {(input: { ndc: { x: number, y: number } } | { raycaster: import('three').Raycaster }) => ({ x: number, y: number } | null)} cell_at_ray
 * @property {(cells: { x: number, y: number }[], state: string) => void} set_cell_state
 * @property {(kind?: string) => void} clear_states
 * @property {{ activate: () => void, deactivate: () => void, set_azimuth: (r: number) => void, dolly_to: (d: number) => void }} camera_rig
 * @property {() => void} teardown
 * // ── v1.1 dapp contract ──
 * @property {(spec: { grid_w: number, grid_h: number, obstacles?: { x: number, y: number }[], holes?: { x: number, y: number }[], voids?: { x: number, y: number }[], anchor?: { origin?: { x: number, y: number, z: number } } }) => Promise<void>} build
 *   [D231] voids = cells OUTSIDE the board's deterministic shape (render nothing, unpickable) — squares are forbidden; the move-module grid authors the shape.
 *   [D238] flat?: boolean — true = dead-flat board at origin.y (skips terrain following; cave boards MUST pass this).
 *   [WORLD FOOTPRINT CLEAR] clear_footprint?: boolean — WORLD boards only (open terrain, no gen-carve): arms the
 *     render-side AABB clear of terrain/grass poking through the flat board. Cave boards MUST omit it (carved rooms).
 * @property {(layer: string, cells: { x: number, y: number }[], on: boolean) => void} highlight
 * @property {(cells: { x: number, y: number }[], opts?: { color?: number, peak?: number }) => void} pulse_cells [D242] scale-pop emphasis on cells (wrong-placement cue)
 * @property {(cell: { x: number, y: number }) => void} flash_cell [D242] your-turn ground flash on one cell
 * @property {(cells?: { x: number, y: number }[]) => void} flash [D242] broad turn-start flash (whole footprint default)
 * @property {(cells: { x: number, y: number }[], opts?: { origin?: {x:number,y:number}, speed?: number, color?: number, peak?: number }) => void} ripple [D257] AoE ripple — staggered per-cell pop from an origin
 * @property {(spec: { id: string, kind?: string, glb_variant?: string, hair_url?: string, colors?: unknown, scale?: number, cell: { x: number, y: number }, facing?: string, facing_yaw?: number, outline?: number, worn?: { head: unknown, back: unknown } | null }) => void} entity_upsert
 * @property {(id: string) => void} entity_remove
 * @property {(id: string, opts?: { r?: number, g?: number, b?: number, peak?: number }) => void} flash_entity [D257] hit-flash the struck entity
 * @property {(magnitude: number) => void} shake [D257] impact camera shake proxy
 * @property {(id: string, waypoints: { x: number, y: number }[], opts?: { cells_per_second?: number, gait?: 'walk' | 'run', loco_time_scale?: number }) => Promise<void>} entity_move [D303] gait: the caller's walk/run pick — the engine resolves clip + timeScale (no foot-slide)
 * @property {(id: string, opts: { anim: string, float?: { text: string, kind?: string }, face?: { x: number, y: number } }) => Promise<void> & { done?: Promise<void>, duration_ms?: number }} entity_beat
 * @property {(id: string, float: { text: string, kind?: string }) => void} float a standalone floating number over an entity (no reaction anim)
 *   resolves at the clip's IMPACT frame (unchanged W4 contract); the SAME promise also carries `.done` (resolves
 *   at the beat's natural end) + `.duration_ms` (the resolved clip length) — [fight-feel 2026-07-12] additive,
 *   for a caller that must wait for the swing to actually FINISH before firing something downstream (never
 *   required; every existing caller keeps reading the impact-resolve exactly as before).
 * @property {(id: string) => ({ x: number, z: number } | null)} render_position_of [entity-anchor] an
 *   entity's CURRENT interpolated world XZ (the walk tween's live transform), or null if untracked
 * @property {(id: string) => (number | null)} entity_height_of the entity avatar's
 *   measured rest-pose height (blocks), or null if untracked — head-anchored overlays read this, never a constant
 * @property {(id: string, world_xz: { x: number, z: number }, team?: number) => void} set_entity_anchor
 *   [entity-anchor] create/reposition the "cell under a fighter" LIVE follow marker — call every frame
 *   with the entity's CURRENT render XZ (render_position_of), never its logical destination cell.
 *   `team` (0 = ally, else enemy) picks the marker's color ONCE at first creation for this id
 * @property {(id: string) => void} clear_entity_anchor [entity-anchor] remove an entity's follow marker (death/remove)
 * @property {(anchor?: { origin?: { x: number, y: number, z: number } }) => void} camera_lock
 * @property {() => void} camera_release
 * @property {(event: 'cell_click' | 'cell_hover' | 'entity_hover', cb: (payload: unknown) => void) => (() => void)} on
 * @property {() => object | null} _descriptor TEST/BENCH — current board descriptor (origin/mask/…) or null
 */

/**
 * Creates a tactical board bound to an engine + canvas. Nothing is mounted until build() resolves.
 * @param {object} args
 * @param {import('../engine.js').EngineApi} args.engine the engine handle (scene + camera seam)
 * @param {HTMLCanvasElement} args.canvas the render canvas (pointer input + client→NDC)
 * @param {{ x: number, y: number, z: number }} [args.default_origin] the cave-designated board origin
 *   (the game path resolves this at gen time; the demo/bench passes it here). Cell (0,0) min-corner;
 *   y = flat floor level. Overridable per-build via the anchor param (dev/bench).
 * @param {number} [args.cell_size] world meters per cell (default 2 — ENG-16 2×2 blocks).
 * @returns {BoardHandle}
 */
export function create_tactical_board({
  engine,
  canvas,
  default_origin = { x: 0, y: 0, z: 0 },
  cell_size = DEFAULT_CELL_SIZE,
}) {
  /** @type {ReturnType<typeof build_board_geometry> | null} */
  let geometry = null
  /** @type {ReturnType<typeof create_board_highlights> | null} */
  let highlights = null
  /** @type {ReturnType<typeof create_board_camera> | null} */
  let camera = null
  /** @type {ReturnType<typeof create_board_entities> | null} */
  let entities = null
  /** @type {ReturnType<typeof create_board_picking> | null} */
  let picking = null
  /** current board descriptor consumed by the picker (origin/width/height/cell_size/mask). */
  let descriptor = /** @type {any} */ (null)
  let rig_raf = /** @type {number | null} */ (null)

  /** D167-B: the ENGINE-OWNED feathered-occlusion uniforms (created at boot, wired into every terrain-
   *  class material). The facade arms it (active) at mount/unmount AND projects the board's screen-space
   *  footprint into it every frame (the tick loop). Null pre-boot / on the WebGL fallback (no TSL terrain). */
  const occlusion = () => engine.get_board_occlusion?.() ?? null
  /** D167-B occlusion scratch (allocation-free per-frame projection) + the mounted board's world bounds. */
  const _occ_v3 = new Vector3()
  const _occ_vp = new Matrix4()
  let occ_bounds =
    /** @type {{ center: [number,number,number], half_x: number, half_z: number, floor_y: number, radius: number } | null} */ (
      null
    )

  /** Event bus for the three raw events. */
  /** @type {Map<string, Set<(payload: unknown) => void>>} */
  const listeners = new Map()
  const emit = (/** @type {string} */ ev, /** @type {unknown} */ p) => {
    for (const cb of listeners.get(ev) ?? []) cb(p)
  }

  /** Compose a flat mask from grid dims + obstacle/hole/void cell lists (0 floor / 1 obstacle /
   *  2 hole / 3 void). [D231] voids carve the board's non-rectangular SHAPE — the deterministic grid
   *  (dungeon_hash + room, the move module twin) is the ONLY author of shape/obstacles/holes. */
  const compose_mask = (
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {{x:number,y:number}[]} */ obstacles,
    /** @type {{x:number,y:number}[]} */ holes,
    /** @type {{x:number,y:number}[]} */ voids
  ) => {
    const mask = new Uint8Array(w * h) // all floor
    for (const c of obstacles ?? []) if (in_bounds(c, w, h)) mask[c.x + c.y * w] = CELL_OBSTACLE
    for (const c of holes ?? []) if (in_bounds(c, w, h)) mask[c.x + c.y * w] = CELL_HOLE
    for (const c of voids ?? []) if (in_bounds(c, w, h)) mask[c.x + c.y * w] = CELL_VOID
    return mask
  }

  /** Per-frame driver: camera pose is pushed by the rig's own loop; here we tick entities each frame
   *  (walks/beats/floats) against the live engine camera, with REAL elapsed dt so a constant-cells/s
   *  walk and an impact-frame beat resolve on wall-clock time (a fixed 1/60 drifts under variable
   *  framerate — the beat would overshoot its impact time when frames run slow). Runs only while
   *  a board is mounted. */
  let last_tick = 0
  const tick_loop = (/** @type {number} */ now) => {
    const dt = last_tick ? Math.min(0.1, (now - last_tick) / 1000) : 1 / 60
    last_tick = now
    if (!geometry) return
    const cam = engine.get_camera()
    if (cam) {
      entities?.tick(dt, cam)
      highlights?.tick(dt) // [D242] advance board feel-cue emphasis (pulse/flash)
      // D167-B: re-project the board's screen-space footprint into the occlusion uniforms every frame (the
      // camera orbits, so the screen AABB + view depth move). Cheap CPU (project 4 corners). Feeds the
      // per-fragment screen-rect + depth test in the terrain materials. Off-screen ⇒ null → skip (stale
      // uniforms stay, but `active` still gates and the board isn't visible then anyway).
      const occ = occlusion()
      if (occ && occ_bounds) {
        _occ_vp.multiplyMatrices(/** @type {any} */ (cam).projectionMatrix, /** @type {any} */ (cam).matrixWorldInverse)
        const s = project_board_screen(
          cam,
          occ_bounds.center,
          occ_bounds.half_x,
          occ_bounds.half_z,
          occ_bounds.floor_y,
          _occ_v3,
          _occ_vp
        )
        if (s)
          occ.set_screen(
            s.center_ndc,
            s.half_ndc,
            s.view_dist,
            occ_bounds.floor_y,
            [occ_bounds.center[0], occ_bounds.center[2]],
            occ_bounds.radius
          )
      }
    }
    rig_raf = requestAnimationFrame(tick_loop)
  }

  /** D167-B — per-cell terrain sampler: world-Y of the ground SURFACE (top face) under a board cell's
   *  centre, via the engine's block oracle + the spawn.js ground discipline (skips canopy/flora — GROUND
   *  ids only, never a treetop/lake). Returns null when the column is unstreamed / has no ground, so the
   *  board grounds itself off the REAL land at the site and the app can no longer hoist it. The demo's
   *  open-sky pose resolves nothing → a flat board (grounding is purely additive). */
  const make_ground_sampler =
    (/** @type {{x:number,y:number,z:number}} */ origin, /** @type {number} */ width, /** @type {number} */ height) =>
    (/** @type {number} */ cell_x, /** @type {number} */ cell_y) => {
      const wx = Math.floor(origin.x + (cell_x + 0.5) * cell_size)
      const wz = Math.floor(origin.z + (cell_y + 0.5) * cell_size)
      const surf = ground_surface_y((x, y, z) => engine.sample_block(x, y, z), wx, wz)
      return surf === null ? null : surf + 1 // +1 → the top FACE the board floor rests on
    }

  /** Build (or rebuild) the board. Async: geometry mount is awaited before any highlight call no-ops. */
  const build = async (/** @type {any} */ spec) => {
    const origin = spec?.anchor?.origin ?? default_origin
    const width = spec.grid_w
    const height = spec.grid_h
    const mask = compose_mask(width, height, spec.obstacles, spec.holes, spec.voids)
    // [D238 cto/owner: the cave board followed the OVERWORLD ring under its cave-coord origin →
    // seed-dependent multi-floor]. flat:true SKIPS the ground sampler entirely — a dead-flat board at
    // origin.y (compute_cell_heights returns all-zero relief when the sampler is absent). Every cave
    // board passes flat:true; terrain-following stays the default for on-terrain overworld boards.
    const ground_sample_y = spec.flat ? undefined : make_ground_sampler(origin, width, height)
    const params = { origin, width, height, mask, cell_size, ground_sample_y }

    // same-args cheap no-op (reconcile storm): if the geometry already matches, do nothing.
    if (geometry && geometry.same_args(params)) return

    // The engine boots asynchronously; add_to_scene / get_camera are silent no-ops until the renderer
    // is up. AWAIT that here so build() lands the group into a LIVE scene regardless of caller timing
    // (the contract promises an async mount — this is where it's honoured). Bounded so a never-booting
    // engine rejects instead of hanging.
    await wait_for_engine(engine)

    // rebuild: tear down the old mount first (keeps the scene clean; camera state is preserved below).
    const was_active = camera?.active ?? false
    teardown_internal({ keep_listeners: true })

    geometry = build_board_geometry(params, { defer_surface: true })
    engine.add_to_scene(geometry.group)
    // FIGHT-START FREEZE FIX: the ~10-27ms paving bake is DEFERRED (the slab binds a
    // blank texture above); pump it in ≤7ms slices across frames so no single frame eats the whole bake —
    // the ~3 s fight intro hold covers the fill-in. Fire-and-forget; bails the instant a teardown/rebuild
    // swaps the live `geometry` out (teardown nulls it, a rebuild reassigns it), abandoning the stale bake.
    {
      const g = geometry
      const pump = () => {
        if (geometry !== g) return // superseded by a teardown/rebuild — drop this stale bake
        const t0 = performance.now()
        let done = false
        do {
          done = g.bake_surface_step()
        } while (!done && performance.now() - t0 < 5) // ≤5ms of bake work/frame — worst frame stays ≤~8ms
        if (!done) requestAnimationFrame(pump)
      }
      requestAnimationFrame(pump)
    }
    // yield a frame so the freshly-added group is in the scene graph before the caller paints — this
    // is what makes build() genuinely async (the adapter AWAITS it before its first highlight call).
    await next_frame()

    descriptor = { origin, width, height, cell_size, mask }
    highlights = create_board_highlights(geometry, {
      reversed_depth: !!(/** @type {any} */ (engine.get_camera()))?.reversedDepth,
    })
    engine.add_to_scene(highlights.group)
    entities = create_board_entities(geometry, engine)

    // D167-B CENTROID CAMERA: frame the arena about its MASK CENTROID (center of mass of walkable +
    // obstacle cells), not the bbox center — irregular orthogonally-convex masks put those in different
    // places, and the board stays CENTERED in view, not shot from the side.
    const centroid = geometry.centroid_world()
    camera = create_board_camera({ engine, dom: canvas, target: centroid, span: Math.max(width, height) * cell_size })
    // D167-B FEATHERED OCCLUSION: record THIS board's world footprint (centroid + XZ half-extents +
    // floor Y) so the tick loop can project it to the screen each frame, then flip the fade ON. Trees/
    // terrain between the camera and the arena melt away with a soft screen-door/alpha feather; the world
    // outside the board's screen rect is untouched; unmount turns it fully off.
    // [D243] world-radius prop cutaway: the board's XZ footprint half-diagonal + a 2-cell margin so a
    // mushroom/pillar standing over ANY board cell melts from every orbit angle.
    const occ_half_x = (width * cell_size) / 2
    const occ_half_z = (height * cell_size) / 2
    occ_bounds = {
      center: centroid,
      half_x: occ_half_x,
      half_z: occ_half_z,
      floor_y: origin.y,
      radius: Math.hypot(occ_half_x, occ_half_z) + cell_size * 2,
    }
    const occ = occlusion()
    if (occ) {
      _occ_vp.multiplyMatrices(
        /** @type {any} */ (engine.get_camera())?.projectionMatrix,
        /** @type {any} */ (engine.get_camera())?.matrixWorldInverse
      )
      const s = project_board_screen(
        /** @type {any} */ (engine.get_camera()),
        occ_bounds.center,
        occ_bounds.half_x,
        occ_bounds.half_z,
        occ_bounds.floor_y,
        _occ_v3,
        _occ_vp
      )
      if (s)
        occ.set_screen(
          s.center_ndc,
          s.half_ndc,
          s.view_dist,
          occ_bounds.floor_y,
          [occ_bounds.center[0], occ_bounds.center[2]],
          occ_bounds.radius
        )
      occ.set_active(true)
      // [WORLD FOOTPRINT CLEAR] spec.clear_footprint (WORLD boards only — cave boards are gen-carved and NEVER
      // set it) arms the depth-independent AABB clear of terrain + grass poking through/above the flat board.
      // The AABB is the board's world-XZ bounding box (origin is the min corner, so bbox centre = origin + half)
      // + a 1-cell margin; world-static, so it's set ONCE at mount and disarmed by set_active(false) on unmount.
      if (spec.clear_footprint)
        occ.set_footprint_clear(
          [origin.x + occ_half_x, origin.z + occ_half_z],
          [occ_half_x + cell_size, occ_half_z + cell_size],
          true
        )
    }

    // The engine camera is guaranteed non-null here — build() awaited wait_for_engine (which polls
    // get_camera() !== null) before reaching this point. The picker reads it LIVE per event (get_camera),
    // never a build-time capture: a renderer/quality rebuild or the D155 WebGL-floor reroute swaps the
    // engine's camera object, and a captured ref would leave every later ray cast from a dead camera
    // (stale-picking class — board_picking's own contract prefers the getter for exactly this).
    picking = create_board_picking({
      canvas,
      get_camera: () => /** @type {any} */ (engine.get_camera()),
      get_board: () => descriptor,
      // CELL RULE: hover and click share this ONE analytic board-plane pick. Entity hover only maps its
      // resulting cell to an occupant; character/mob render objects never enter the pointer target set.
      entity_at_cell: (cell) => entities?.id_at_cell(cell) ?? null,
      on_cell_click: (cell) => emit('cell_click', cell),
      on_cell_hover: (cell) => emit('cell_hover', cell),
      on_entity_hover: (id) => emit('entity_hover', id),
    })

    if (was_active) camera.activate()
    if (rig_raf === null) {
      last_tick = 0 // fresh clock so the first tick uses the 1/60 fallback, not a stale delta
      rig_raf = requestAnimationFrame(tick_loop)
    }
  }

  /** Internal teardown — frees the mounted board; optionally preserves the listener bus (for rebuild). */
  const teardown_internal = (/** @type {{ keep_listeners?: boolean }} */ { keep_listeners = false } = {}) => {
    // D167-B: disarm the feathered occlusion so the world renders untouched with no board mounted (a
    // rebuild re-arms it immediately after with the new bounds). This is the toggle-off proof: unmount ⇒
    // the fade term folds to a no-op (frame identical to a no-board world).
    occ_bounds = null
    occlusion()?.set_active(false)
    if (rig_raf !== null) {
      cancelAnimationFrame(rig_raf)
      rig_raf = null
    }
    camera?.deactivate()
    camera?.dispose()
    entities?.dispose()
    picking?.dispose()
    if (highlights) {
      engine.remove_from_scene(highlights.group)
      highlights.dispose()
    }
    if (geometry) {
      engine.remove_from_scene(geometry.group)
      geometry.dispose()
    }
    geometry = null
    highlights = null
    camera = null
    entities = null
    picking = null
    descriptor = null
    if (!keep_listeners) listeners.clear()
  }

  return {
    build,

    teardown() {
      // [p0-fight-init ROOT FIX] the event bus belongs to the HANDLE, not the mount: `on()` subscriptions
      // are made once per handle (the dapp adapter subscribes at create time) and must survive every
      // teardown→build cycle (mid-fight churn rebuild, next-room rebuild). The old keep_listeners:false
      // wiped the bus on the first live teardown, so every LATER build's picking emitted into nobody —
      // the first-transition-fight (and room-2+) dead-input family. Unsubscribe is the caller's own
      // off() (the adapter's destroy() already does exactly that).
      teardown_internal({ keep_listeners: true })
    },

    // ── picking (§7) ──
    cell_at_ray(input) {
      if (!descriptor) return null
      if ('raycaster' in input) return cell_from_raycaster(input.raycaster, descriptor)
      return picking ? picking.pick(input.ndc) : null
    },

    // ── highlights: §7 set_cell_state / clear_states + v1.1 highlight(layer,cells,on) ──
    set_cell_state(cells, state) {
      if (state === 'idle') {
        highlights?.clear()
        return
      }
      highlights?.set_channel(cells, state)
    },
    clear_states(kind) {
      highlights?.clear(kind)
    },
    highlight(layer, cells, on) {
      highlights?.toggle(layer, cells, on)
    },
    // ── [D242] board feel-cues (reference-fight feel; the app wires the triggers) ──
    /** Pulse-emphasise cells (scale-pop + fade) — the wrong-placement "snap to legal cells" cue.
     *  @param {{x:number,y:number}[]} cells @param {{ color?: number, peak?: number }} [opts] */
    pulse_cells(cells, opts) {
      highlights?.pulse_cells(cells, opts)
    },
    /** Quick ground flash under one cell — the your-turn turn-start cue. @param {{x:number,y:number}} cell */
    flash_cell(cell) {
      highlights?.flash_cell(cell)
    },
    /** Flash the whole board footprint (or a given cell set) — a broad turn-start pulse.
     *  @param {{x:number,y:number}[]} [cells] */
    flash(cells) {
      highlights?.flash(cells)
    },
    /** [D257] AoE ripple — pop cells outward from an origin (delay = dist/speed); a cast splashes.
     *  @param {{x:number,y:number}[]} cells @param {{ origin?: {x:number,y:number}, speed?: number, color?: number, peak?: number }} [opts] */
    ripple(cells, opts) {
      highlights?.ripple(cells, opts)
    },

    // ── entities (v1.1) ──
    entity_upsert(spec) {
      entities?.upsert(spec)
    },
    entity_remove(id) {
      entities?.remove(id)
    },
    /** [D257] hit-flash the struck entity — emissive pulse (0.15s in / 0.25s out). The adapter fires it
     *  on hit-land. @param {string} id @param {{ r?: number, g?: number, b?: number, peak?: number }} [opts] */
    flash_entity(id, opts) {
      entities?.flash(id, opts)
    },
    /** [D257] impact camera shake — proxies engine.shake_camera so ALL fight cues fire through the board
     *  handle (0.10 light / 0.20 std / 0.5+ crit). @param {number} magnitude */
    shake(magnitude) {
      engine.shake_camera?.(magnitude)
    },
    entity_move(id, waypoints, opts) {
      return entities ? entities.move(id, waypoints, opts) : Promise.resolve()
    },
    entity_beat(id, opts) {
      return entities ? entities.beat(id, opts) : Promise.resolve()
    },
    // A standalone floating number over an entity — NO reaction anim (unlike entity_beat), for feedback that
    // isn't a hit: the move's spent-MP floater. Forwards board_entities' existing float spawner.
    float(id, float) {
      if (entities) entities.float(id, float)
    },

    // ── [entity-anchor] the "cell under a fighter" LIVE marker — board_highlights owns the primitive
    //    (set_entity_anchor/clear_entity_anchor), board_entities owns the position feed
    //    (render_position_of); this facade is the only place a caller can reach both siblings. ──
    render_position_of(id) {
      return entities ? entities.render_position_of(id) : null
    },
    // The measured avatar height feed (blocks) — head-anchored
    // overlays (the dapp hover tooltip) project at the REAL body height, never a constant.
    entity_height_of(id) {
      return entities ? entities.entity_height_of(id) : null
    },
    set_entity_anchor(id, world_xz, team) {
      highlights?.set_entity_anchor(id, world_xz, team)
    },
    clear_entity_anchor(id) {
      highlights?.clear_entity_anchor(id)
    },

    // ── camera (§7 camera_rig + v1.1 camera_lock/release) ──
    get camera_rig() {
      return {
        activate: () => camera?.activate(),
        deactivate: () => camera?.deactivate(),
        set_azimuth: (/** @type {number} */ r) => camera?.set_azimuth(r),
        dolly_to: (/** @type {number} */ d) => camera?.dolly_to(d),
      }
    },
    camera_lock(anchor) {
      // optional dev/bench target override; the game path locks onto the board center (rig default).
      if (anchor?.origin) camera?.set_target([anchor.origin.x, anchor.origin.y, anchor.origin.z])
      camera?.activate()
    },
    camera_release() {
      camera?.deactivate()
    },

    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)?.add(cb)
      return () => listeners.get(event)?.delete(cb)
    },

    _descriptor() {
      return descriptor
    },
  }
}

/** @param {{x:number,y:number}} c @param {number} w @param {number} h */
const in_bounds = (c, w, h) => c.x >= 0 && c.y >= 0 && c.x < w && c.y < h

/** Resolve on the next animation frame — makes build() genuinely await a mounted scene graph. */
function next_frame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
}

/** Wait (bounded, on rAF) for the engine's async boot to expose a live scene + camera, so the board
 *  group is added to a real scene (add_to_scene is a silent no-op pre-boot). Resolves once ready or
 *  after ~20 s (a never-booting engine surfaces its own boot_error; build then no-ops on a null scene).
 *  @param {import('../engine.js').EngineApi} engine */
function wait_for_engine(engine) {
  return new Promise((resolve) => {
    const start = (typeof performance !== 'undefined' ? performance : Date).now()
    const poll = () => {
      const ready = engine.get_scene() !== null && engine.get_camera() !== null
      const timed_out = (typeof performance !== 'undefined' ? performance : Date).now() - start > 20000
      if (ready || timed_out) return resolve(undefined)
      requestAnimationFrame(poll)
    }
    poll()
  })
}
