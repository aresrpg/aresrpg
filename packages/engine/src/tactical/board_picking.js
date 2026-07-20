// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — TACTICAL BOARD PICKING (ray → cell) + raw pointer events.
//
// Picking is an ANALYTIC Y-PLANE intersection with FLOOR snapping — NEVER a mesh raycast (the study
// §4 law: the board's raised obstacles / sunken holes must never break clicking; the plane at the
// floor level is the pick surface regardless of what geometry sits above/below it). The pipeline:
//   1. build a world ray from the input (NDC via the engine camera, OR a dapp-owned Raycaster),
//   2. intersect it with the horizontal plane y = origin.y + FLOOR_THICKNESS (the RENDERED slab top —
//      D291 raised the visible walkable surface FLOOR_THICKNESS above origin.y; every other consumer
//      (entities, obstacles/holes, highlights) followed it there, so picking must too — see the
//      CELL-TARGETING-OFFSET fix, 2026-07-19: at the fight camera's fixed tilt, plane-vs-origin.y drift
//      pushed the picked cell away from the camera by FLOOR_THICKNESS·tan(polar), a "small" offset that
//      still crosses cell boundaries near an edge — board_picking.test.js pins it),
//   3. cell = FLOOR((hit − origin)/cell_size)  — floor, NOT round (round mis-snaps at 2 m cells),
//   4. reject on plane-miss (ray parallel / pointing away), out-of-bounds, or a VOID cell (mask 0 =
//      hole / out-of-shape → null; void cells are never walkable or pickable, D75).
//
// The three RAW input events (contract v1.2): cell_hover fires with the picked CellCoord or null (one-shot
// clear); cell_click fires with the CellCoord OR NULL — a real click gesture that missed the board is an
// EVENT, not silence (D2: an off-board click with a spell armed must reach the dapp so it can
// deselect; v1.1 swallowed it and the spell stayed stuck armed). entity_hover fires with an entity id when
// the pointer is over a placed entity's CELL. RAW ONLY — the engine reports WHAT the pointer is over, never
// WHY; the dapp decides meaning (is this a legal move target? a valid cast cell?). Entity hit-testing is
// delegated to a caller-supplied `pick_entity(ndc)` (the facade resolves the plane cell's occupant — the D1
// cell-hitbox rule), keeping this file to the plane math + the event plumbing. 2026-07-04, v1.2 2026-07-18.

import { Plane, Raycaster, Vector2, Vector3 } from 'three'

import { read_cell, CELL_FLOOR, FLOOR_THICKNESS } from './board.js'

/** Reused scratch — picking runs on every pointermove, so allocate nothing per event. */
const _ray = new Raycaster()
const _ndc = new Vector2()
const _hit = new Vector3()
const _plane = new Plane(new Vector3(0, 1, 0), 0) // normal +Y; constant re-set per pick to −origin.y

/** Pointerdown→pointerup click-vs-drag tolerance, in screen px (house drag-click gate law). A real
 *  click's press and release drift a few pixels even with zero drag intent; board_camera.js drags the
 *  fight camera's azimuth off this SAME canvas, so anything past this tolerance is a camera-orbit
 *  gesture, not a click, and must not fire one. */
const CLICK_DRIFT_PX = 6

/**
 * @typedef {object} BoardDescriptor
 * @property {{ x: number, y: number, z: number }} origin cell (0,0) min-corner; y = floor plane
 * @property {number} width
 * @property {number} height
 * @property {number} cell_size world meters per cell
 * @property {Uint8Array | number[]} mask row-major walkability bytes (0 = void)
 */

/**
 * Intersects a prebuilt Raycaster with the board's floor plane and snaps to a cell. Renderer-agnostic
 * (the caller owns the Raycaster; the engine builds one from its camera in `cell_at_ndc`). Returns a
 * board-local CellCoord, or null on plane-miss / out-of-bounds / void cell.
 *
 * @param {Raycaster} raycaster a ray already positioned in world space (origin + direction)
 * @param {BoardDescriptor} board minimal board descriptor
 * @returns {{ x: number, y: number } | null}
 */
export function cell_from_raycaster(raycaster, board) {
  const { origin, width, height, cell_size, mask } = board
  // Plane y = origin.y + FLOOR_THICKNESS (the RENDERED slab top, D291 — NOT the pre-thickness base
  // plane) ⇒ n·p + d = 0 with n=(0,1,0) ⇒ d = −(origin.y + FLOOR_THICKNESS). Matches board_entities.js'
  // origin.y+FLOOR_THICKNESS stance and board.js's obstacle/hole floor_y+FLOOR_THICKNESS — the ONE
  // surface height every renderer already agrees on; picking was the sole holdout at bare origin.y.
  _plane.set(_plane.normal.set(0, 1, 0), -(origin.y + FLOOR_THICKNESS))
  const hit = raycaster.ray.intersectPlane(_plane, _hit)
  if (!hit) return null // ray parallel to the floor, or pointing away from it
  return snap_hit_to_cell(hit.x, hit.z, origin, width, height, cell_size, mask)
}

/**
 * Snaps a world-space floor hit (x,z) to a board cell with FLOOR rounding + mask gating. Extracted as
 * a pure function so the picking math is unit-testable without a camera or a Raycaster.
 * @param {number} hx world X of the floor hit
 * @param {number} hz world Z of the floor hit
 * @param {{ x: number, y: number, z: number }} origin
 * @param {number} width @param {number} height @param {number} cell_size
 * @param {Uint8Array | number[]} mask
 * @returns {{ x: number, y: number } | null}
 */
export function snap_hit_to_cell(hx, hz, origin, width, height, cell_size, mask) {
  const cx = Math.floor((hx - origin.x) / cell_size)
  const cy = Math.floor((hz - origin.z) / cell_size)
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null
  // Void cells (holes / out-of-shape) are not pickable — the mask carves the playable shape (D75).
  if (read_cell(mask, cx, cy, width, height) !== CELL_FLOOR) return null
  return { x: cx, y: cy }
}

/**
 * Builds a world ray from NDC through a three camera and returns the picked cell (or null). This is
 * the engine-camera path (dapp passes normalized device coords in [-1,1]); the Raycaster path is for
 * a dapp that owns its own caster.
 * @param {{ x: number, y: number }} ndc normalized device coords, x/y ∈ [-1, 1]
 * @param {import('three').Camera} camera the live engine camera
 * @param {BoardDescriptor} board see cell_from_raycaster
 * @returns {{ x: number, y: number } | null}
 */
export function cell_at_ndc(ndc, camera, board) {
  _ndc.set(ndc.x, ndc.y)
  _ray.setFromCamera(_ndc, camera)
  return cell_from_raycaster(_ray, board)
}

/**
 * @typedef {object} PickingController
 * @property {(ndc: { x: number, y: number }) => ({ x: number, y: number } | null)} pick pure cell pick
 * @property {() => void} dispose detaches the pointer listeners
 */

/**
 * Wires DOM pointer events on a canvas into the three raw board events. Converts client coords → NDC,
 * picks a cell + an entity, and invokes the caller's emit hooks. Suppresses redundant hover spam (only
 * emits cell_hover / entity_hover when the target CHANGES). Movement of the pointer OFF the board still
 * emits a cell_hover(null) once so the dapp can clear its cursor highlight.
 *
 * @param {object} args
 * @param {HTMLCanvasElement} args.canvas the render canvas (client→NDC uses its bounding rect)
 * @param {(() => import('three').Camera) | undefined} [args.get_camera] returns the LIVE engine camera per event
 *   (preferred — read live like `get_board`, so a renderer/quality rebuild or the D155 WebGL-floor reroute that
 *   swaps the engine's camera object can never leave picking raycasting a stale camera). Falls back to `camera`.
 * @param {import('three').Camera} [args.camera] a camera captured at creation (legacy/back-compat; prefer get_camera)
 * @param {() => BoardDescriptor} args.get_board returns the current board descriptor (origin/width/height/cell_size/mask)
 * @param {(ndc: { x: number, y: number }) => (string | null)} [args.pick_entity] hit-test entities → id | null
 * @param {(cell: { x: number, y: number } | null) => void} [args.on_cell_click] null = a clean click that missed the board (v1.2 — the dapp's off-board deselect needs it)
 * @param {(cell: { x: number, y: number } | null) => void} [args.on_cell_hover]
 * @param {(id: string | null) => void} [args.on_entity_hover]
 * @returns {PickingController}
 */
export function create_board_picking({
  canvas,
  camera,
  get_camera,
  get_board,
  pick_entity,
  on_cell_click,
  on_cell_hover,
  on_entity_hover,
}) {
  /** The LIVE camera resolver — prefer the getter (read per event, like get_board); a bare `camera` ref is
   *  wrapped for back-compat. Reading live is what keeps a picking ray on the engine's CURRENT camera even
   *  if the engine swaps its camera object mid-session (renderer/quality rebuild, WebGL-floor reroute). */
  const camera_of = get_camera ?? (() => /** @type {import('three').Camera} */ (camera))

  /** Last hovered cell + entity (change-detection so we don't re-emit every pointermove). */
  let last_cell_key = /** @type {string | null} */ ('__init__')
  let last_entity = /** @type {string | null} */ ('__init__')

  /** The in-flight left-press anchor (client px), or null between presses. Set on pointerdown, consumed
   *  (reset to null) on the very next pointerup regardless of outcome — never carried across gestures. */
  let pending_down = /** @type {{ x: number, y: number } | null} */ (null)

  const to_ndc = (/** @type {PointerEvent} */ e) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    }
  }

  const pick = (/** @type {{ x: number, y: number }} */ ndc) => {
    // The live getter may legally return null for a frame (renderer rebuild/reroute mid-swap) — no pick then;
    // the next event reads the fresh camera. A captured ref could never be null, hence this guard lands with it.
    const cam = camera_of()
    return cam ? cell_at_ndc(ndc, cam, get_board()) : null
  }

  const on_move = (/** @type {PointerEvent} */ e) => {
    const ndc = to_ndc(e)
    const cell = pick(ndc)
    const key = cell ? `${cell.x},${cell.y}` : null
    if (key !== last_cell_key) {
      last_cell_key = key
      on_cell_hover?.(cell)
    }
    if (pick_entity) {
      const id = pick_entity(ndc)
      if (id !== last_entity) {
        last_entity = id
        on_entity_hover?.(id)
      }
    }
  }

  // The pointer LEAVING the canvas entirely (onto interactive HUD chrome overlaid on top of it — the spell
  // bar, turn controls, deck cards — or off the window) never fires another 'pointermove' on the canvas, so
  // on_move above never runs again: without this, whatever cell/entity was hovered last stays latched forever
  // (the dapp never gets a chance to clear it). `pointerleave` (unlike `pointerout`) doesn't bubble and fires
  // exactly once when the pointer truly exits the element's bounds — the same one-shot clear on_move already
  // gives for a hover that lands off-board while still ON the canvas.
  const on_leave = () => {
    // '__init__' means on_move never ran at all this session (no hover to clear) — treat it the same as
    // already-null so a leave with nothing ever hovered stays a silent no-op, not a spurious clear dispatch.
    if (last_cell_key !== null && last_cell_key !== '__init__') {
      last_cell_key = null
      on_cell_hover?.(null)
    }
    if (last_entity !== null && last_entity !== '__init__') {
      last_entity = null
      on_entity_hover?.(null)
    }
  }

  // CLICK = pointerdown→pointerup within CLICK_DRIFT_PX, projected FRESH at UP-time. Firing at down-time
  // used to project against whatever camera pose was live under the press — on this board, a drag can
  // still be settling (board_camera.js orbits azimuth off this same canvas), so a down-time projection
  // could compute a cell one off from what the user actually sees under the cursor; the first click would
  // then miss/mis-target and only a second click (camera settled) would land. Deferring the projection to
  // the matching up — and re-running it at that instant, not reusing the down-time pick — reads the
  // camera's ACTUAL pose at release. Drift beyond tolerance means the gesture was a camera drag, not a
  // click, and is dropped silently (the drag itself is owned entirely by board_camera.js).
  const on_down = (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0) return // left click only — raw click intent
    pending_down = { x: e.clientX, y: e.clientY }
  }

  const on_up = (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0) return
    const down = pending_down
    pending_down = null // consume — never let a stale press leak into the next gesture
    if (!down) return // no matching press on this canvas (e.g. the press started elsewhere)
    const drift = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    if (drift > CLICK_DRIFT_PX) return // camera-orbit drag, not a click
    // fresh projection at up-time, current camera pose. NULL RIDES (contract v1.2): a genuine click that
    // missed the board still fires — the dapp needs it to deselect an armed spell (D2). Only non-clicks
    // (drags, non-left buttons, unmatched presses) stay silent.
    on_cell_click?.(pick(to_ndc(e)))
  }

  canvas.addEventListener('pointermove', on_move)
  canvas.addEventListener('pointerdown', on_down)
  canvas.addEventListener('pointerup', on_up)
  canvas.addEventListener('pointerleave', on_leave)

  return {
    pick,
    dispose() {
      canvas.removeEventListener('pointermove', on_move)
      canvas.removeEventListener('pointerdown', on_down)
      canvas.removeEventListener('pointerup', on_up)
      canvas.removeEventListener('pointerleave', on_leave)
    },
  }
}
