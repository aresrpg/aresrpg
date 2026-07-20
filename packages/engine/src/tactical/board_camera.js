// ENG-16 Phase B — TACTICAL BOARD CAMERA RIG (the "locked isometric").
//
// A CONSTRAINED PERSPECTIVE rig (never orthographic — the study §3 law, both AresRPG eras used a
// locked-polar perspective, not ortho). Faux-iso = polar FROZEN at ~50° from vertical, azimuth FREE
// (the player still orbits horizontally by dragging), dolly ∝ board span, target = board center. Only
// polar is locked; azimuth + dolly stay live.
//
// LOCK MECHANISM — the engine's frame loop unconditionally applies the fly camera's stored pose each
// frame (core/fly_camera.js .apply()). This rig therefore does NOT fight that: while active it runs
// its own rAF that COMPUTES the locked-iso pose and PUSHES it through the engine's public seam
// (set_camera_position / set_camera_orientation / set_camera_fov) every frame — so the fly camera's
// stored state IS the iso pose, and .apply() renders it. activate() takes over (installs drag/wheel
// listeners + starts the pose loop); deactivate() removes them and hands control back to the dapp's
// own camera driver (which resumes pushing its pose). The rig owns azimuth + dolly state.
//
// The dapp must stop driving its fly/walk camera while the rig is active (the demo gates that on the
// board mode) — two drivers writing the seam each frame would fight. camera_lock(anchor) on the board
// handle just calls activate() with an optional target override (dev/bench; the game path uses the
// board center). 2026-07-04.

/** Fixed polar angle from vertical (down = 0). 50° = the reverted prod value (study §3). Exported
 *  so a regression test can cast a pick ray at the SAME tilt the live fight camera actually uses, rather
 *  than duplicating the magic number (board_picking.test.js — the CELL-TARGETING-OFFSET fix). */
export const POLAR_RAD = (50 * Math.PI) / 180
/** Dolly = clamp(board_span · SPAN_FACTOR, MIN, MAX) — matches C's clamp(span*1.7,12,30) shape. */
const SPAN_FACTOR = 1.7
const DOLLY_MIN = 8
const DOLLY_MAX = 60
const AZIMUTH_SENSITIVITY = 0.006 // radians per pixel of horizontal drag
const WHEEL_SENSITIVITY = 0.015 // dolly meters per wheel delta unit
const FOV_DEGREES = 42 // a modest perspective FOV — narrow enough to read as faux-iso

/**
 * @typedef {object} CameraRig
 * @property {() => void} activate take over the engine camera + start pushing the iso pose each frame
 * @property {() => void} deactivate stop the pose loop + remove input listeners (hands control back)
 * @property {(radians: number) => void} set_azimuth dapp orbit knob (absolute azimuth)
 * @property {(distance: number) => void} dolly_to dapp zoom knob (clamped)
 * @property {(target: [number, number, number]) => void} set_target override the orbit target (dev/bench)
 * @property {boolean} active
 * @property {() => { azimuth: number, dolly: number, target: [number, number, number] }} get_state debug/bench readout
 * @property {() => void} dispose
 */

/**
 * Creates the locked-iso camera rig for a board.
 * @param {object} args
 * @param {import('../engine.js').EngineApi} args.engine the engine handle (the camera seam)
 * @param {HTMLElement} args.dom the element to bind drag/wheel on (the canvas)
 * @param {[number, number, number]} args.target world-space orbit target (board center)
 * @param {number} args.span board span in meters (max(width,height)·cell_size) → initial dolly
 * @returns {CameraRig}
 */
export function create_board_camera({ engine, dom, target, span }) {
  let azimuth = Math.PI / 4 // start at a 45° corner view (classic tactical presentation)
  let dolly = clamp(span * SPAN_FACTOR, DOLLY_MIN, DOLLY_MAX)
  let tgt = /** @type {[number, number, number]} */ ([...target])
  let active = false
  let raf = /** @type {number | null} */ (null)
  let dragging = false
  let last_x = 0

  /** Computes + pushes the iso pose (position + yaw/pitch + fov) for the current azimuth/dolly/target. */
  const push_pose = () => {
    // Spherical → cartesian offset from the target. Polar measured from vertical: the camera sits
    // above + to the side. horizontal_radius shrinks the XZ ring as polar → 0 (straight down).
    const horizontal = Math.sin(POLAR_RAD) * dolly
    const vertical = Math.cos(POLAR_RAD) * dolly
    const px = tgt[0] + Math.sin(azimuth) * horizontal
    const pz = tgt[2] + Math.cos(azimuth) * horizontal
    const py = tgt[1] + vertical
    engine.set_camera_position([px, py, pz])
    // Look AT the target. yaw = atan2 of the (target − eye) horizontal direction; the engine's fly
    // camera builds its quaternion as Euler(pitch, yaw, 0, 'YXZ') with forward = −Z, so:
    //   yaw   = atan2(−dx, −dz)  (so −Z forward points from eye toward target)
    //   pitch = asin(dy / |d|)   (negative — looking down)
    const dx = tgt[0] - px
    const dy = tgt[1] - py
    const dz = tgt[2] - pz
    const dist = Math.hypot(dx, dy, dz) || 1
    const yaw = Math.atan2(-dx, -dz)
    const pitch = Math.asin(dy / dist)
    engine.set_camera_orientation(yaw, pitch)
    engine.set_camera_fov(FOV_DEGREES)
  }

  const loop = () => {
    if (!active) return
    push_pose()
    raf = requestAnimationFrame(loop)
  }

  const on_down = (/** @type {PointerEvent} */ e) => {
    if (e.button !== 0) return
    dragging = true
    last_x = e.clientX
  }
  const on_move = (/** @type {PointerEvent} */ e) => {
    if (!dragging) return
    const dx = e.clientX - last_x
    last_x = e.clientX
    azimuth -= dx * AZIMUTH_SENSITIVITY // drag right → orbit left (natural grab feel)
  }
  const on_up = () => {
    dragging = false
  }
  const on_wheel = (/** @type {WheelEvent} */ e) => {
    e.preventDefault()
    dolly = clamp(dolly + e.deltaY * WHEEL_SENSITIVITY, DOLLY_MIN, DOLLY_MAX)
  }

  return {
    get active() {
      return active
    },
    activate() {
      if (active) return // idempotent
      active = true
      dom.addEventListener('pointerdown', on_down)
      window.addEventListener('pointermove', on_move)
      window.addEventListener('pointerup', on_up)
      dom.addEventListener('wheel', on_wheel, { passive: false })
      push_pose() // apply immediately so the first frame is already iso
      raf = requestAnimationFrame(loop)
    },
    deactivate() {
      if (!active) return
      active = false
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      dom.removeEventListener('pointerdown', on_down)
      window.removeEventListener('pointermove', on_move)
      window.removeEventListener('pointerup', on_up)
      dom.removeEventListener('wheel', on_wheel)
    },
    set_azimuth(radians) {
      azimuth = radians
    },
    dolly_to(distance) {
      dolly = clamp(distance, DOLLY_MIN, DOLLY_MAX)
    },
    set_target(next) {
      tgt = [...next]
    },
    get_state() {
      return { azimuth, dolly, target: /** @type {[number,number,number]} */ ([...tgt]) }
    },
    dispose() {
      this.deactivate()
    },
  }
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
