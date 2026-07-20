// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The tactical-fight camera — split from embed_voxel.js at the 600-LoC law. A FIXED-angle orthographic pose
// on EVERY device (the isometric view is the default now, replacing the old flag —
// D238's free-orbit drag is retired), wheel/pinch dolly (D256/D264a/D281a) scaling the ortho frustum,
// fit-to-board framing (D236/D248), an always-on idle wobble (the kept signature float), and the your-turn
// hero zoom-punch (W6 #5). Owns the `fight_cam` authority flag (the ONE camera writer during a fight) plus
// all its own pointer/wheel listeners.
//
// D230 — ONE CAMERA WRITER: while a fight owns the scene (the adapter's on_fight → set_active(true)) this
// drives the camera and the walk rig stands down; released, the walk rig resumes. board.camera_lock is BANNED
// (its dolly flies out through the cave roof, and it lost the per-frame writer war anyway).

/**
 * @param {{ engine: any, canvas: HTMLCanvasElement, board_cell_m: number, mobile?: boolean }} deps —
 *   `board_cell_m` is the host's BOARD_CELL_M render stride (D231); the fight cam is orthographic + fixed-angle
 *   on every device (the default) — `mobile` only selects the touch-vs-mouse gesture wiring below.
 */
import { game_log } from '../core/log.js'

// [D248] idle wobble — subtle always-on "breathing" so the battle cam has life, not a dead lock (the
// idle float, kept regardless of projection — explicitly preserved when isometric became the
// default). POSITIONAL on a slow lissajous; apply()'s look-at re-aims from the floated eye, so the frame also
// sways a hair (a coupled micro-rotation). Pure fn of elapsed seconds `t` — reference feel-tuning: ~0.08 m
// float @ ~0.2 Hz, unchanged by this extraction (it ran unconditionally before too — this only makes it testable).
const WOBBLE_HZ = 0.2 // Hz — the D248-tuned breathing rate
const WOBBLE_AMP_XZ = 0.08 // m — horizontal float amplitude
const WOBBLE_AMP_Y = 0.04 // m — vertical float amplitude (half the horizontal, subtler)
export const idle_wobble = (/** @type {number} */ t) => {
  const wt = t * (2 * Math.PI * WOBBLE_HZ)
  return {
    x: WOBBLE_AMP_XZ * Math.sin(wt),
    y: WOBBLE_AMP_Y * Math.sin(wt * 0.8 + 1.7),
    z: WOBBLE_AMP_XZ * Math.cos(wt * 0.9 + 0.5),
  }
}

export function create_fight_camera({ engine, canvas, board_cell_m, mobile = false }) {
  let fight_cam = false // D230 — true while the tactical board owns the camera (adapter's on_fight)
  let input_paused = false // route-hidden scenes retain fight state without retaining global input locks
  let fight_azimuth = Math.PI / 4 // D238 — orbit angle around the board (starts at the 45° corner)
  let fight_dolly = 0 // [D256] fixes dead zoom in fight cam; wheel-zoom offset added to the fit distance (clamped)
  let manual_dist = 22 // live pre-punch distance; touch pinch updates this between render frames
  const FOV = 66 // hand-tuned fight lens — shared by apply() and midpoint-anchored mobile pinch
  // The manual zoom and hero punch share this cave-décor floor. The 11 m target remains the live probe:
  // a clipped frame in a newer biome means raising this one value, never adding a second rail.
  const DECOR_CLIP_FLOOR = 11 // m — tightened to ~2x closer; was 17, before that 22 (unprobed post-5-biomes; see note)
  const DIST_MAX_WHEEL = 42 // m — widened for a whole-board view on big boards; ~1.3× the legacy 32 m ceiling
  // [W6 #5] HERO ZOOM-PUNCH — a one-second sin-bump when YOUR turn opens; push in, then ease back out.
  const ZOOM_PUNCH_DUR = 1.0 // s
  const ZOOM_PUNCH_PEAK = 3.5 // meters closer at the peak of the beat (subtle)
  let zoom_punch_t = ZOOM_PUNCH_DUR // start finished (idle)
  // Impact shake lives here because this is the sole fight-camera writer; it is additive and motion-gated.
  const SHAKE_DUR = 0.22 // s — inside the 150–250 ms brief-jolt window
  const SHAKE_POS = 0.14 // m of positional jitter at amp 1 (subtle)
  const SHAKE_ROT = 0.01 // rad of aim jitter at amp 1 (the "small rotational shake")
  let shake_amp = 0 // 0..1 current jolt strength (set on trigger, faded out by shake_t)
  let shake_t = 0 // s remaining in the current jolt
  const reduced_motion = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  let projected_camera = null
  let projection_restore = null
  const restore_mobile_projection = () => projection_restore?.()
  const set_mobile_projection = (half_height, aspect) => {
    const camera = engine.get_camera?.()
    if (!camera?.projectionMatrix?.makeOrthographic) return
    if (projected_camera !== camera) {
      restore_mobile_projection()
      projected_camera = camera
      const perspective_update = camera.updateProjectionMatrix
      camera.updateProjectionMatrix = () => {
        camera.projectionMatrix.makeOrthographic(
          camera.left,
          camera.right,
          camera.top,
          camera.bottom,
          camera.near,
          camera.far,
          camera.coordinateSystem,
          camera.reversedDepth
        )
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
      }
      projection_restore = () => {
        camera.updateProjectionMatrix = perspective_update
        camera.isPerspectiveCamera = true
        camera.isOrthographicCamera = false
        camera.updateProjectionMatrix?.()
        projected_camera = null
        projection_restore = null
      }
    }
    const half_width = half_height * aspect
    camera.left = -half_width
    camera.right = half_width
    camera.top = half_height
    camera.bottom = -half_height
    camera.isPerspectiveCamera = false
    camera.isOrthographicCamera = true
    camera.updateProjectionMatrix?.()
  }
  // orbit_target is the fight-entry SETTLE-ease goal now — D251's drag-catch/inertia-glide retired with the
  // free-orbit drag (fixed iso is the whole point). begin_prepare/do_settle/set_active drive it.
  let orbit_target = fight_azimuth
  // ── FIGHT-ENTRY CINEMATIC — the pre-board "preparing the battlefield" beat ───────────────────
  // On fight-CREATE (the host's begin_prepare, fired off the earliest post-tx-success store signal) the camera
  // engages EARLY: it snaps to the iso view and slowly ORBITS a synthetic anchor frame while the board is still
  // building + the herald sword drops. When the board is READY (set_active(true) — the adapter's on_fight) it
  // SETTLES: the azimuth eases the short way to the canonical corner with a zoom-punch "boom". prefers-reduced-
  // motion holds the iso pose still (no spin, no punch) — a plain crossfade as the board takes over.
  let preparing = false // true from begin_prepare until the board-ready settle (auto-orbit + the synthetic frame)
  let prepare_reduced = false // reduced-motion — snap to iso but never spin or punch
  let prepare_elapsed = 0 // s since begin_prepare (the min-rotation floor so the beat always reads)
  let settle_pending = false // the board went ready BEFORE the floor elapsed — settle the instant it does
  let settling = false // easing the azimuth from the free orbit into the corner (post board-ready)
  /** @type {{ origin: {x:number,y:number,z:number}, grid_w: number, grid_h: number } | null} the synthetic
   *  board frame apply() orbits while the real board is still building (the host anchors it on the battlefield). */
  let prepare_frame = null
  const PREPARE_ROT_SPEED = 0.6 // rad/s — a slow, deliberate turntable while "preparing" (≈34°/s)
  const SETTLE_TAU = 0.22 // s — the azimuth ease half-life into the corner on board-ready (a firm, quick lock)
  const MIN_PREPARE_S = 0.9 // s — a fast board build defers its settle to here so the rotation + sword always read
  // RIGHT-DRAG PAN — allows right-drag during fights to slightly move the board manually. The fight
  // cam's one drag gesture (RMB): shifts the look-at pivot laterally, clamped to a modest envelope (apply()
  // below) so the player can peek past a tall prop/obstacle without ever losing the board off-screen. NO
  // spring-back (it stays where panned) — only the explicit RESET below clears it. Stored as a
  // world-space offset from the board center (pan_x/pan_z), independent of the fixed fight_azimuth.
  let pan_x = 0
  let pan_z = 0
  // Live per-frame clamp bounds — recomputed in apply() from the CURRENT board frame, so a board-size change
  // between fights rescales the envelope automatically (never a stale limit carried from a previous board).
  let pan_limit_x = 0
  let pan_limit_z = 0
  const PAN_ENVELOPE_FRAC = 0.35 // fraction of the board's HALF-span (bw/2, bh/2) from center — a peek, not a relocation
  const PAN_RATE_M_PER_PX = 0.015 // m per screen px — gentle: the ~2-4 m typical envelope shouldn't max out in a twitch
  let pan_drag = /** @type {{ x: number, y: number, id: number } | null} */ (null)
  const clamp_pan = () => {
    pan_x = Math.max(-pan_limit_x, Math.min(pan_limit_x, pan_x))
    pan_z = Math.max(-pan_limit_z, Math.min(pan_limit_z, pan_z))
  }
  const pan_by_pixels = (/** @type {number} */ dx, /** @type {number} */ dy) => {
    const next_x =
      pan_x - Math.cos(fight_azimuth) * dx * PAN_RATE_M_PER_PX - Math.sin(fight_azimuth) * dy * PAN_RATE_M_PER_PX
    const next_z =
      pan_z + Math.sin(fight_azimuth) * dx * PAN_RATE_M_PER_PX - Math.cos(fight_azimuth) * dy * PAN_RATE_M_PER_PX
    pan_x = next_x
    pan_z = next_z
    clamp_pan()
  }
  // RESET = double RIGHT-click. Native `dblclick` does not fire reliably for non-primary buttons across
  // browsers (Chrome never fires it for RMB at all), so this is detected manually off two right-pointerdowns
  // close in time+space — the same drift-gate idiom as the house CLICK_DRIFT_PX click-vs-drag law.
  let last_rmb_t = -Infinity // -Infinity, not 0 — a real performance.now() can legitimately be tiny moments
  // after a fresh page load, and 0 would then false-positive the very first right-click ever as a "double"
  let last_rmb_x = 0
  let last_rmb_y = 0
  const PAN_DBLCLICK_MS = 400
  const PAN_DBLCLICK_PX = 8
  /** Clears the pan offset + the wheel-dolly — the double-right-click RESET gesture. Never touches the orbit
   *  azimuth (the ask was "recenter pan + reset zoom"; rotation is a separate, already-tuned gesture). */
  const reset_pan_zoom = () => {
    pan_x = 0
    pan_z = 0
    fight_dolly = 0
  }
  // D250's lesson applies identically here (own the gesture: capture + preventDefault + release on both
  // pointerup/pointercancel) — canvas-scoped press (the gesture starts ON the board, not over the HUD chrome),
  // window-scoped move/release (survives the pointer crossing the HUD mid-drag).
  const pan_down = (/** @type {PointerEvent} */ e) => {
    if (!fight_cam || e.button !== 2) return
    e.preventDefault()
    const now = performance.now()
    const is_dblclick =
      now - last_rmb_t < PAN_DBLCLICK_MS && Math.hypot(e.clientX - last_rmb_x, e.clientY - last_rmb_y) < PAN_DBLCLICK_PX
    last_rmb_t = -Infinity // consume — a 3rd rapid click starts a fresh pair, never chains into a 2nd reset
    if (is_dblclick) {
      reset_pan_zoom() // double right-click — the reset click itself never arms a drag
      return
    }
    last_rmb_t = now
    last_rmb_x = e.clientX
    last_rmb_y = e.clientY
    pan_drag = { x: e.clientX, y: e.clientY, id: e.pointerId }
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* pointer type may not capture */
    }
    canvas.style.cursor = 'grabbing'
  }
  const pan_move = (/** @type {PointerEvent} */ e) => {
    if (!fight_cam || !pan_drag) return
    const dx = e.clientX - pan_drag.x
    const dy = e.clientY - pan_drag.y
    pan_drag.x = e.clientX
    pan_drag.y = e.clientY
    // Camera-relative axes at the CURRENT azimuth — the exact screen-right/ground-forward convention already
    // proven in embed_voxel_spectate.js's hand-pan (same position parametrization: center + R·(sinθ,cosθ)):
    // a "grab the world" feel — drag right ⇒ the board slides right under the cursor ⇒ the pivot moves left.
    pan_by_pixels(dx, dy)
  }
  const pan_up = () => {
    if (!pan_drag) return
    try {
      canvas.releasePointerCapture(pan_drag.id)
    } catch {
      /* already released */
    }
    pan_drag = null
    if (fight_cam) canvas.style.cursor = 'grab'
  }
  // Suppress the native right-click menu during a fight — RMB is now a camera gesture, not a menu trigger.
  const pan_contextmenu = (/** @type {Event} */ e) => {
    if (fight_cam) e.preventDefault()
  }
  // The HUD covers the canvas, so fight zoom owns a WINDOW capture listener. Route pause must release it;
  // otherwise the persistent hidden lobby cancels wheel scrolling on every companion page.
  const orbit_wheel = (/** @type {WheelEvent} */ e) => {
    if (!fight_cam) return
    e.preventDefault()
    // pinch (ctrlKey) sends larger deltas; the sign is what matters — one notch per event either way.
    // [2026-07-12, widened again to fix insufficient zoom range] range now [-21,20] so the dolly can span
    // the WHOLE [DECOR_CLIP_FLOOR,DIST_MAX_WHEEL] rail from any board's fit anchor `base` ∈ [22,32] below: a
    // big board opens near base=32 and must still zoom IN the full 21 m (32→11); a small board opens at
    // base=22 and must zoom OUT the full 20 m (22→42). Either end starves without this span.
    fight_dolly = Math.max(-21, Math.min(20, fight_dolly + Math.sign(e.deltaY) * 0.8))
  }
  const wheel_options = { passive: false, capture: true }
  const sync_wheel_lock = () => {
    window.removeEventListener('wheel', orbit_wheel, wheel_options)
    if (fight_cam && !input_paused) window.addEventListener('wheel', orbit_wheel, wheel_options)
  }

  // Mobile fight input is deliberately a FIXED-azimuth camera: one touch pans after the shared 6px tap
  // tolerance; two touches pinch around their midpoint. Capture-phase move/up owns drags before the board
  // picker, while a <=6px release passes through unchanged and remains a cell tap.
  const MOBILE_DRAG_PX = 6
  const mobile_pointers = new Map()
  const mobile_blocked = new Set()
  let mobile_pinch = null
  const pinch_pair = () => {
    const [a, b] = [...mobile_pointers.values()]
    if (!a || !b) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) }
  }
  const mobile_zoom_at = (x, y, next_dist) => {
    const previous = manual_dist
    const delta = Math.max(DECOR_CLIP_FLOOR, Math.min(DIST_MAX_WHEEL, next_dist)) - previous
    const before = fight_dolly
    fight_dolly = Math.max(-21, Math.min(20, fight_dolly + delta))
    const applied = fight_dolly - before
    manual_dist = previous + applied
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height || !applied) return
    const nx = ((x - rect.left) / rect.width) * 2 - 1
    const ny = ((y - rect.top) / rect.height) * 2 - 1
    const toward = -applied * Math.tan(((FOV / 2) * Math.PI) / 180)
    const side = nx * toward * (rect.width / rect.height)
    const depth = ny * toward
    pan_x += Math.cos(fight_azimuth) * side + Math.sin(fight_azimuth) * depth
    pan_z += -Math.sin(fight_azimuth) * side + Math.cos(fight_azimuth) * depth
    clamp_pan()
  }
  const mobile_pointer_down = (e) => {
    if (!fight_cam || e.button !== 0 || e.pointerType !== 'touch') return
    mobile_pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, start_x: e.clientX, start_y: e.clientY })
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture may be unavailable */
    }
    if (mobile_pointers.size > 1) {
      for (const id of mobile_pointers.keys()) mobile_blocked.add(id)
      mobile_pinch = pinch_pair()
      e.preventDefault()
    }
  }
  const mobile_pointer_move = (e) => {
    const point = mobile_pointers.get(e.pointerId)
    if (!fight_cam || !point) return
    const dx = e.clientX - point.x
    const dy = e.clientY - point.y
    point.x = e.clientX
    point.y = e.clientY
    if (mobile_pointers.size > 1) {
      const next = pinch_pair()
      if (next && mobile_pinch) {
        pan_by_pixels(next.x - mobile_pinch.x, next.y - mobile_pinch.y)
        if (next.dist > 0 && mobile_pinch.dist > 0)
          mobile_zoom_at(next.x, next.y, manual_dist / (next.dist / mobile_pinch.dist))
        mobile_pinch = next
      }
      for (const id of mobile_pointers.keys()) mobile_blocked.add(id)
    } else if (Math.hypot(point.x - point.start_x, point.y - point.start_y) > MOBILE_DRAG_PX) {
      mobile_blocked.add(e.pointerId)
      pan_by_pixels(dx, dy)
    } else return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  const mobile_pointer_up = (e) => {
    if (!mobile_pointers.has(e.pointerId)) return
    if (mobile_blocked.has(e.pointerId) || mobile_pointers.size > 1) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    mobile_pointers.delete(e.pointerId)
    mobile_blocked.delete(e.pointerId)
    mobile_pinch = null
    const remaining = [...mobile_pointers.values()][0]
    if (remaining) {
      remaining.start_x = remaining.x
      remaining.start_y = remaining.y
    }
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }
  canvas.style.touchAction = 'none' // D250 — no native touch-pan stealing the drag gestures below
  if (mobile) {
    canvas.addEventListener('pointerdown', mobile_pointer_down)
    window.addEventListener('pointermove', mobile_pointer_move, { capture: true, passive: false })
    window.addEventListener('pointerup', mobile_pointer_up, { capture: true })
    window.addEventListener('pointercancel', mobile_pointer_up, { capture: true })
  } else {
    // Fixed iso angle (the default) — no orbit-drag listener; pan + wheel stay wired.
    canvas.addEventListener('pointerdown', pan_down)
    window.addEventListener('pointermove', pan_move)
    window.addEventListener('pointerup', pan_up)
    window.addEventListener('pointercancel', pan_up)
    canvas.addEventListener('contextmenu', pan_contextmenu)
  }
  /** D230 — is the fight camera the live writer? (the walk rig + input gate read this). */
  const is_active = () => fight_cam
  const set_paused = (paused) => {
    input_paused = paused
    sync_wheel_lock()
  }

  // Engage early for fight-entry; a synthetic frame is used until the real board is ready.
  const begin_prepare = (/** @type {{ frame?: any, reduced?: boolean }} */ { frame, reduced = false } = {}) => {
    if (fight_cam) return
    fight_cam = true
    sync_wheel_lock()
    preparing = true
    prepare_reduced = !!reduced
    prepare_frame = frame ?? null
    prepare_elapsed = 0
    settle_pending = false
    settling = false
    fight_azimuth = Math.PI / 4
    orbit_target = Math.PI / 4
    engine.set_motion_blur_enabled?.(false) // D251-2 — no smear on the orbit
    canvas.style.cursor = mobile ? '' : 'grab' // touch has no hover cursor; desktop keeps the pan hint
    game_log(
      'voxel',
      `fight-entry PREPARE — iso snap + ${reduced ? 'still hold (reduced-motion)' : 'slow orbit'} (cinematic)`
    )
  }

  // The board-ready SETTLE: stop the orbit and ease the azimuth the SHORT way into the canonical corner, with
  // the zoom-punch "boom" (skipped under reduced-motion — a plain crossfade as the board drops in).
  const do_settle = () => {
    preparing = false
    settle_pending = false
    settling = true
    const corner = Math.PI / 4
    orbit_target = corner + 2 * Math.PI * Math.round((fight_azimuth - corner) / (2 * Math.PI)) // nearest turn-equiv
    if (!prepare_reduced) zoom_punch_t = 0 // the BOOM — the board drops in with a push-in (motion-gated)
    game_log('voxel', 'fight-entry SETTLE — board ready, easing to the tactical corner (cinematic)')
  }

  // Board-ready settles a prepare or directly engages a resumed fight; false hands authority back.
  const set_active = (/** @type {boolean} */ on) => {
    if (on) {
      if (preparing) {
        if (prepare_elapsed >= MIN_PREPARE_S) do_settle()
        else settle_pending = true // board ready early — settle the moment the floor elapses (integrate)
        return
      }
      if (fight_cam) return // already live — idempotent
      fight_cam = true
      sync_wheel_lock()
      fight_azimuth = Math.PI / 4
      orbit_target = Math.PI / 4
      settling = false
      engine.set_motion_blur_enabled?.(false)
      canvas.style.cursor = mobile ? '' : 'grab'
      game_log('voxel', 'fight camera ENGAGED (direct) — walk rig standing down (D230)')
      return
    }
    fight_cam = false
    sync_wheel_lock()
    preparing = false
    settle_pending = false
    settling = false
    prepare_frame = null
    pan_drag = null // right-drag pan: a mid-drag pan does not survive the fight ending
    mobile_pointers.clear()
    mobile_blocked.clear()
    mobile_pinch = null
    restore_mobile_projection()
    canvas.style.cursor = ''
    engine.set_motion_blur_enabled?.(true)
    game_log('voxel', 'fight camera released — walk rig resumes (D230)')
  }

  /** [W6 #5] fire the your-turn hero zoom-punch beat — push the fight cam in when your turn opens. */
  const trigger_zoom_punch = () => {
    zoom_punch_t = 0
  }

  /** [fight-feel] fire an impact jolt of `magnitude` (≈0.06 a heal … ≈0.34 a KO … ≈0.5 a crit-nuke). Takes the
   *  STRONGER of any live jolt and the new one (back-to-back impacts don't stack into nausea) and refreshes the
   *  decay window. Inert unless the fight cam is the live writer, and under reduced-motion. */
  const add_shake = (/** @type {number} */ magnitude = 0.18) => {
    if (!fight_cam || reduced_motion()) return
    shake_amp = Math.min(1, Math.max(shake_amp, magnitude))
    shake_t = SHAKE_DUR
  }

  // The fight-entry azimuth integrator: PREPARE turntables at a flat rate, SETTLE eases (SETTLE_TAU) into the
  // canonical corner; live (post-settle) fight_azimuth is held fixed (no free-orbit drag by default).
  // Runs before the fight-cam pose branch (apply) consumes fight_azimuth. Inert when not the live writer.
  const integrate = (/** @type {number} */ dt) => {
    if (!fight_cam) return
    if (preparing) {
      prepare_elapsed += dt
      if (!prepare_reduced) {
        fight_azimuth += PREPARE_ROT_SPEED * dt // slow turntable around the battlefield while the board builds
        orbit_target = fight_azimuth
      }
      if (settle_pending && prepare_elapsed >= MIN_PREPARE_S) do_settle() // board was ready early — settle now
      return
    }
    if (settling) {
      const step = (orbit_target - fight_azimuth) * (1 - Math.exp(-dt / SETTLE_TAU))
      fight_azimuth += step
      if (Math.abs(orbit_target - fight_azimuth) < 0.002) {
        fight_azimuth = orbit_target
        settling = false
      }
      return
    }
  }

  // D230 — the fight camera pose, driven from the live board frame (architect's proven pose: under the cave
  // roof, clear of the glow-mushroom clusters). Called by the host frame loop only while active; a missing
  // board frame is a no-op. `get_board_frame` is the adapter's board-frame getter (resolved by the host).
  const apply = (/** @type {number} */ dt, /** @type {() => any} */ get_board_frame) => {
    // the LIVE board frame once built; until then, the fight-entry prepare orbit reads the synthetic frame the
    // host anchored on the battlefield, so the iso orbit is framed exactly like the board that's about to drop.
    const bf = get_board_frame?.() ?? (preparing ? prepare_frame : null)
    if (!bf) return
    // D236/D248 fight camera: FIT-TO-BOARD distance (board diagonal vs the vertical frustum, ×1.2
    // margin) clamped to the [22,30] rails, corner azimuth (head-on = mushroom-occluded), fov 66.
    // The polar was the legacy 60° (π/3); D248 supersedes it with the MEASURED reference angle 50°
    // (see the const below), pitch = −(π/2 − polar) auto-follows.
    const cs = board_cell_m // DEFAULT_CELL_SIZE (D231 −33% cells) — the host's single-homed BOARD_CELL_M, passed in
    const { x: ax, y: ay, z: az } = bf.origin
    const bw = bf.grid_w * cs
    const bh = bf.grid_h * cs
    // right-drag pan: live envelope for THIS frame's board — a board-size change (a new fight) rescales
    // it automatically. Belt-and-braces re-clamp: pan_move() already clamps on every drag update, but a stale
    // pan carried from a BIGGER previous board must never render outside the new, smaller board's envelope
    // even for one frame.
    pan_limit_x = (bw / 2) * PAN_ENVELOPE_FRAC
    pan_limit_z = (bh / 2) * PAN_ENVELOPE_FRAC
    clamp_pan()
    const bcx = ax + bw / 2
    const bcz = az + bh / 2
    const diag = Math.hypot(bw, bh)
    const fit = (diag / 2 / Math.tan(((FOV / 2) * Math.PI) / 180)) * 1.0 // [D256] ×1.0 (was 1.2) — board bigger/closer (1.2 read too far)
    // rails: legacy dollied to 22 and the architect's proven cave pose sits ≈23 — closer poses landed
    // INSIDE cave décor (probe: black frame at 15). 22 is the floor; fit engages for BIGGER boards only.
    // [D281a] WHEEL ZOOM WAS DEAD (from placement on): the old `Math.max(22, fit + fight_dolly)` added
    // the dolly to the RAW fit, which for small/medium boards sits FAR below the 22 floor (a 7×7 board's fit ≈
    // 10 m) — so with fight_dolly ∈ [-2,10] the sum 8–20 m never crossed 22 and dist stayed PINNED at 22 across
    // the entire wheel range (zoom did nothing). Anchor the dolly at the fit ALREADY CLAMPED into the rails, so
    // the wheel moves the real starting distance within [22,32] on every board size.
    const base = Math.min(32, Math.max(22, fit)) // UNCHANGED — the tuned default pose per board size; the wider wheel rails below never alter it (fight_dolly=0 ⇒ dist=base, always)
    let dist = Math.min(DIST_MAX_WHEEL, Math.max(DECOR_CLIP_FLOOR, base + fight_dolly)) // wider zoom: wheel rails widened around the untouched fit anchor
    manual_dist = dist
    // [W6 #5] hero zoom-punch: ease a brief push-in (sin bump over ZOOM_PUNCH_DUR) BENEATH the rails when
    // your turn opens; floored at DECOR_CLIP_FLOOR (probe: black frame ≲15) so the punch never clips into cave décor.
    if (zoom_punch_t < ZOOM_PUNCH_DUR) {
      zoom_punch_t += dt
      const u = Math.min(1, zoom_punch_t / ZOOM_PUNCH_DUR)
      dist = Math.max(DECOR_CLIP_FLOOR, dist - ZOOM_PUNCH_PEAK * Math.sin(Math.PI * u))
    }
    // [D248] measured reference angle: 50° from vertical (= 40° elevation), replacing the too-flat legacy 60°.
    const polar = (50 * Math.PI) / 180
    const rect = canvas.getBoundingClientRect()
    const aspect = (rect.width || 1) / (rect.height || 1)
    const half_x = (bw * Math.abs(Math.cos(fight_azimuth)) + bh * Math.abs(Math.sin(fight_azimuth))) / 2
    const half_y =
      ((bw * Math.abs(Math.sin(fight_azimuth)) + bh * Math.abs(Math.cos(fight_azimuth))) / 2) * Math.cos(polar) + 1.2
    set_mobile_projection(Math.max(half_y, half_x / aspect) * 1.08 * (dist / base), aspect)
    const pose_dist = base // ortho zoom is frustum-only (the default, every device) — a moving eye is invisible under orthographic projection
    const horiz = pose_dist * Math.sin(polar)
    const { x: wob_x, y: wob_y, z: wob_z } = idle_wobble(performance.now() / 1000)
    // [fight-feel] IMPACT SHAKE — a decaying random jitter added to the eye + aim (additive on top of the pose,
    // never a restructure). Smooth-random via high-frequency sines seeded on the clock; linear decay × strength.
    let shx = 0
    let shy = 0
    let shz = 0
    let shyaw = 0
    let shpitch = 0
    if (shake_t > 0) {
      shake_t = Math.max(0, shake_t - dt)
      const env = (shake_t / SHAKE_DUR) * shake_amp // fade to 0 over the jolt window
      const tt = performance.now() / 1000
      shx = Math.sin(tt * 97.1) * SHAKE_POS * env
      shy = Math.sin(tt * 88.7 + 2.1) * SHAKE_POS * env
      shz = Math.cos(tt * 91.3 + 1.3) * SHAKE_POS * env
      shyaw = Math.sin(tt * 113.7 + 0.7) * SHAKE_ROT * env
      shpitch = Math.cos(tt * 101.9 + 1.9) * SHAKE_ROT * env
      if (shake_t === 0) shake_amp = 0
    }
    // D238 — the orbit azimuth (drag-adjusted) replaces the fixed 45° corner; the D248 iso polar is held.
    // right-drag pan: cx/cz replace bcx/bcz as the orbit/look-at pivot — the board's raw center offset
    // by the (clamped) pan; the shake below stays additive on top of THIS pivot, unchanged.
    const cx = bcx + pan_x
    const cz = bcz + pan_z
    const px = cx + horiz * Math.sin(fight_azimuth) + wob_x
    const pz = cz + horiz * Math.cos(fight_azimuth) + wob_z
    engine.set_camera_position?.([px + shx, ay + pose_dist * Math.cos(polar) + 1.2 + wob_y + shy, pz + shz])
    // [D256] fixes the board feeling too far / slightly below center — measured reference: board center
    // sits ~6% below frame middle. LOOK_UP (+0.07 rad ≈ 4°) tilts the aim up a hair → board sits lower.
    // The aim is computed from the UN-shaken eye toward the (pan-shifted) pivot, then the shake jitter is added.
    engine.set_camera_orientation?.(Math.atan2(px - cx, pz - cz) + shyaw, -(Math.PI / 2 - polar) + 0.07 + shpitch)
    // FOV is meaningless once the projection is orthographic (the default, every device) — never set here.
  }

  const dispose = () => {
    set_paused(true)
    restore_mobile_projection()
    canvas.removeEventListener('pointerdown', mobile_pointer_down)
    window.removeEventListener('pointermove', mobile_pointer_move, { capture: true })
    window.removeEventListener('pointerup', mobile_pointer_up, { capture: true })
    window.removeEventListener('pointercancel', mobile_pointer_up, { capture: true })
    canvas.removeEventListener('pointerdown', pan_down) // right-drag pan: dies with the session
    window.removeEventListener('pointermove', pan_move)
    window.removeEventListener('pointerup', pan_up)
    window.removeEventListener('pointercancel', pan_up)
    canvas.removeEventListener('contextmenu', pan_contextmenu)
    canvas.style.cursor = '' // never leave a stray grab-cursor on a canvas that may be reattached (D158 remount)
  }

  return { is_active, set_active, set_paused, begin_prepare, trigger_zoom_punch, add_shake, integrate, apply, dispose }
}
