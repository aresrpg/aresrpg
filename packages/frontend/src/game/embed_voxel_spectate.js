// D183/D184/D201 — the SPECTATE diorama camera (login backdrop). Split from embed_voxel.js at the
// 600-LoC law when D201's hands-on pan landed. NO game logic, NO controller, NO avatar — a camera and
// its leash: LMB-drag PANS the focus across the lite world (clamped inside the zone with a margin so
// the vista never stares into the far shell), RMB-drag YAWS, the iso PITCH is LOCKED (the angle
// never changes). The idle auto-drift lives only until the FIRST hand lands (a drift that fights the hands
// is worse than none). The drag listeners (down/up/move) ride the WINDOW (the login card overlays the
// backdrop) with a card-guard so buttons/inputs stay dead zones for the camera. The APP deliberately
// drives the camera here (one writer: the first set trips the engine's D185 standdown — the designed
// interplay).
//
// [owner: right-click dead app-wide] the contextmenu suppressor (`sc`) binds to the CANVAS ONLY — never
// window. This layer sits behind the whole app (the login card overlays it, but the mounted canvas
// persists across routes), so a window-scoped contextmenu listener swallowed native right-click on
// EVERY page (encyclopedia, admin, …), not just this vista. Canvas-scoped mirrors the proven precedent
// in embed_voxel_fight_camera.js (pan_contextmenu binds `canvas`, never window) and confines the
// RMB-drag-vs-menu tradeoff to the one element that actually needs it.

import { instrument_cpu_callback } from './cpu_span.js'

/** LOCKED iso pitch — D201: rotation is yaw-only, the angle never changes. */
const ISO_PITCH = -0.55
// P0 (the spectate/pre-character camera sat too close to the map — zoomed out to avoid landing in the
// tree). The old vantage (R42/H32) put the eye at spawn_y+32 ≈ y163 — DEAD INSIDE the rainforest canopy:
// jungle_giant trunks reach h_max 34 + an ~11-block crown ⇒ tops near y175, colossal giants (10%) ~y185.
// Lift the eye clear of it (spawn_y+64 ≈ y195, ~10 m over the tallest canopy) and pull the orbit back so the
// vista frames the map instead of staring into leaves. The H/R ratio (≈0.78) is held so the D201-locked pitch
// keeps the SAME framing, just higher + wider — a zoom-out, not a re-angle.
const ISO_RADIUS = 100
const ISO_HEIGHT = 78
const ISO_SPEED = 0.02 // rad/s — cinematic drift (until the first hand, D201)
const CLAMP_MARGIN = 16 // m inside the fence — the vista never stares straight into the wall

/**
 * Drives the spectate iso camera around `world_spawn` on the given engine. Returns the cleanup
 * (cancels the rAF + removes the window + canvas listeners).
 * @param {any} engine the live engine facade (set_camera_position / set_camera_orientation)
 * @param {[number, number, number]} world_spawn the scenic focus the diorama starts on
 * @param {HTMLCanvasElement} canvas the spectate render target — the contextmenu suppressor binds
 *   HERE ONLY (never window), so right-click stays alive on every page the canvas doesn't cover.
 * @param {() => boolean} [can_interact] the interaction gate: the backdrop is DISPLAY-ONLY
 *   (the auto-drift keeps playing) until the visitor chose "watch the live world" or is logged in. Drags are
 *   IGNORED while it returns false, so window-bound mouse listeners can't pan the world behind the login card
 *   (CSS pointer-events can't gate a window listener). Defaults to always-interactive (the standalone unit-test
 *   contract; the real mount always injects the store-backed gate).
 * @returns {(() => void) & {set_paused:(paused:boolean)=>void}}
 */
export function create_spectate_camera(engine, world_spawn, canvas, can_interact = () => true) {
  let focus_x = world_spawn[0]
  let focus_z = world_spawn[2]
  let th = 0
  let hands = false
  let drag = 0 // 0 none · 1 pan (LMB) · 2 yaw (RMB)
  let lx = 0
  let ly = 0
  // D210: the pan clamp reads the ENGINE's fence (get_zone_bounds always returns the border box — the
  // same one the walkers are clamped by), so the spectator can pan the WHOLE map and see players
  // anywhere on it (D206). Streaming follows the camera for free; null pre-boot ⇒ unclamped this frame.
  const clamp_x = (/** @type {number} */ v) => {
    const b = engine.get_zone_bounds?.()
    return b ? Math.max(b.min_x + CLAMP_MARGIN, Math.min(b.max_x - CLAMP_MARGIN, v)) : v
  }
  const clamp_z = (/** @type {number} */ v) => {
    const b = engine.get_zone_bounds?.()
    return b ? Math.max(b.min_z + CLAMP_MARGIN, Math.min(b.max_z - CLAMP_MARGIN, v)) : v
  }
  const card_guard = (/** @type {EventTarget | null} */ t) =>
    t instanceof Element && !!t.closest('button, input, a, form, textarea, select')

  const sd = (/** @type {MouseEvent} */ e) => {
    if (!can_interact()) return // display-only backdrop: no pan/yaw until spectate is chosen or the visitor logs in
    if (card_guard(e.target)) return
    hands = true
    drag = e.button === 2 ? 2 : 1
    lx = e.clientX
    ly = e.clientY
  }
  const su = () => {
    drag = 0
  }
  const sm = (/** @type {MouseEvent} */ e) => {
    if (!drag) return
    const dx = e.clientX - lx
    const dy = e.clientY - ly
    lx = e.clientX
    ly = e.clientY
    if (drag === 2) {
      th -= dx * 0.008 // yaw only — pitch stays ISO_PITCH forever (D201: angle locked)
      return
    }
    // map-drag pan in the CAMERA frame: right = (cosθ, −sinθ), ground-forward = (−sinθ, −cosθ);
    // content follows the cursor (drag right ⇒ world slides right ⇒ focus moves left).
    const k = 0.12 // m per px at the iso height
    focus_x = clamp_x(focus_x - Math.cos(th) * dx * k - Math.sin(th) * dy * k)
    focus_z = clamp_z(focus_z + Math.sin(th) * dx * k - Math.cos(th) * dy * k)
  }
  const sc = (/** @type {Event} */ e) => {
    if (!card_guard(/** @type {any} */ (e).target)) e.preventDefault() // RMB drag ≠ context menu
  }
  window.addEventListener('mousedown', sd)
  window.addEventListener('mouseup', su)
  window.addEventListener('mousemove', sm)
  canvas.addEventListener('contextmenu', sc) // [owner: right-click dead app-wide] canvas-scoped only — never window

  let iso_raf = 0
  let paused = false
  let last = performance.now()
  const iso_frame_body = (/** @type {number} */ now) => {
    iso_raf = 0
    if (paused) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!hands) th += ISO_SPEED * dt // cinematic drift until the first hand (D201)
    engine.set_camera_position?.([
      focus_x + Math.sin(th) * ISO_RADIUS,
      world_spawn[1] + ISO_HEIGHT,
      focus_z + Math.cos(th) * ISO_RADIUS,
    ])
    // facing the focus from angle th (D178 convention) — pitch LOCKED (D201).
    engine.set_camera_orientation?.(th, ISO_PITCH)
    iso_raf = requestAnimationFrame(iso_frame)
  }
  const iso_frame = instrument_cpu_callback('scene', iso_frame_body)
  iso_raf = requestAnimationFrame(iso_frame)

  if (import.meta.env.DEV)
    /** @type {any} */ (window).__voxel_iso = {
      // probe/qa drive: synthesize a drag (button 0 = pan, 2 = yaw) without real pointer events.
      drive: (/** @type {number} */ dx, /** @type {number} */ dy, /** @type {number} */ button = 0) => {
        sd(/** @type {any} */ ({ button, clientX: 0, clientY: 0, target: null }))
        sm(/** @type {any} */ ({ clientX: dx, clientY: dy }))
        su()
      },
      get: () => ({ focus_x, focus_z, th }),
    }

  const cleanup = () => {
    cancelAnimationFrame(iso_raf)
    window.removeEventListener('mousedown', sd)
    window.removeEventListener('mouseup', su)
    window.removeEventListener('mousemove', sm)
    canvas.removeEventListener('contextmenu', sc)
  }
  cleanup.set_paused = (next_paused) => {
    paused = next_paused
    if (paused) {
      if (iso_raf) cancelAnimationFrame(iso_raf)
      iso_raf = 0
    } else if (!iso_raf) {
      last = performance.now()
      iso_raf = requestAnimationFrame(iso_frame)
    }
  }
  return cleanup
}
