// ENG-18 — WORLD BORDER demo harness (border.html). Boots the engine in the FIXED WORLD (a 300 m zone),
// which AUTO-ARMS the mana barrier from its zone bounds on boot; the demo just sets the banner text and
// drives a fly/walk camera. The engine owns the wall + the soft-clamp (set_camera_position funnels through
// zone_border) + the border-proximity signal — this harness exercises the REAL product path, not a demo
// re-wire. It exposes window.__border (+ window.__engine) so the bench drives poses + reads proximity.
// 2026-07-05.

import { create_engine } from '../src/engine.js'
import { border_proximity, clamp_to_bounds } from '../src/core/zone_border.js'

import { create_walk_mode } from './walk_mode.js'

/** The demo zone centre — the same [70,70] the fixed-mode demo frames, so the streamed surface sits under
 *  the wall. The engine derives the 300 m bounds ([-80,-80]..[220,220]) and auto-arms the barrier. */
const ZONE_ORIGIN = /** @type {[number, number]} */ ([70, 70])

/**
 * Boots the border demo. @param {HTMLCanvasElement} canvas @param {HTMLDivElement} gate
 * @param {URLSearchParams} params
 */
export async function boot_border_demo(canvas, gate, params) {
  gate.dataset.hidden = 'false'
  gate.textContent = 'Booting world border…'

  const tier = /** @type {any} */ (params.get('tier') || 'high')
  const engine = create_engine({
    canvas,
    tier: tier === 'auto' ? undefined : tier,
    world_mode: 'fixed',
    zone_origin: ZONE_ORIGIN,
  })
  const w = /** @type {any} */ (window)
  w.__engine = engine

  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })

  const banner = params.get('banner') || 'AETHERION BOUNDARY — TURN BACK'
  let banner_set = false
  /** Set the banner once the engine has built the barrier (after the fixed-world boot auto-arm). The demo
   *  polls this in the rAF loop since the auto-arm fires a few frames into boot. */
  function try_banner() {
    if (banner_set) return
    if (!engine.get_zone_bounds()) return
    engine.set_border_banner(banner)
    banner_set = true
    const bounds = engine.get_zone_bounds()
    w.__border = {
      bounds,
      // proximity comes straight from the engine's stats (the SSOT the dapp reads); also expose the pure
      // fn against the demo state for the bench to double-check the ramp.
      get_proximity: () =>
        engine.get_stats().border_proximity ?? border_proximity(state.position[0], state.position[2], bounds),
      is_armed: () => Boolean(w.__mana_barrier?.is_armed?.()),
      set_banner: (/** @type {string} */ t) => engine.set_border_banner(t),
    }
  }

  engine.start()
  engine.set_time_of_day(0.28)

  // ── demo camera: fly (WASD + pointer-lock) or walk (G). The ENGINE soft-clamps every camera move at the
  // wall (set_camera_position → zone_border), so the demo integrates freely and relies on that clamp. ──
  const state = {
    // start high above the zone centre, looking toward a wall so the vista shows the shimmer band.
    position: /** @type {[number, number, number]} */ ([ZONE_ORIGIN[0], 240, ZONE_ORIGIN[1]]),
    yaw: Math.PI / 4,
    pitch: -0.4,
  }
  w.__border_state = state // bench pose control

  const keys = new Set()
  window.addEventListener('keydown', (e) => keys.add(e.code))
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  canvas.addEventListener('click', () => {
    if (mode === 'fly' && document.pointerLockElement !== canvas) canvas.requestPointerLock()
  })
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'fly' || document.pointerLockElement !== canvas) return
    state.yaw -= e.movementX * 0.0024
    state.pitch -= e.movementY * 0.0024
    const lim = Math.PI / 2 - 0.01
    state.pitch = Math.max(-lim, Math.min(lim, state.pitch))
  })

  // walk mode (G) — the character controller inside the zone. Its shoulder-cam pose is pushed through
  // engine.set_camera_position too, so the engine clamps the CAMERA at the wall; the demo additionally
  // clamps the body so the controller can't walk its feet out (the engine can't reach the walk body).
  const walk = create_walk_mode({ engine, canvas, spawn_xz_y: [ZONE_ORIGIN[0], 200, ZONE_ORIGIN[1]] })
  let mode = /** @type {'fly' | 'walk'} */ ('fly')
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG') return
    if (mode === 'fly') {
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      mode = 'walk'
      walk.enable()
    } else {
      mode = 'fly'
      walk.disable()
      const st = engine.get_stats()
      state.position = [...st.camera_position]
      ;[state.yaw, state.pitch] = st.camera_yaw_pitch
    }
  })

  gate.dataset.hidden = 'true'

  const MOVE = 24
  const FAST = 96
  let last = performance.now()
  requestAnimationFrame(function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    try_banner()

    if (mode === 'walk') {
      walk.tick(dt) // pushes the shoulder-cam pose through engine.set_camera_position (engine clamps it)
      // clamp the walk BODY too (the engine only sees the camera pose, not the controller feet).
      const bounds = engine.get_zone_bounds()
      const ws = w.__walk
      if (bounds && ws?.state) clamp_walk_body(ws.state, bounds)
    } else {
      if (keys.size > 0) {
        const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? FAST : MOVE) * dt
        const fwd = [Math.sin(state.yaw) * -1, 0, Math.cos(state.yaw) * -1]
        const right = [Math.cos(state.yaw), 0, -Math.sin(state.yaw)]
        const m = [0, 0, 0]
        if (keys.has('KeyW')) axpy(m, sp, fwd)
        if (keys.has('KeyS')) axpy(m, -sp, fwd)
        if (keys.has('KeyD')) axpy(m, sp, right)
        if (keys.has('KeyA')) axpy(m, -sp, right)
        if (keys.has('Space')) m[1] += sp
        if (keys.has('ControlLeft')) m[1] -= sp
        state.position = [state.position[0] + m[0], state.position[1] + m[1], state.position[2] + m[2]]
      }
      // The ENGINE clamps inside set_camera_position; read the clamped pose back so the demo state stays in
      // sync (otherwise state.position would drift outside while the camera is held at the wall).
      engine.set_camera_position(state.position)
      engine.set_camera_orientation(state.yaw, state.pitch)
      const st = engine.get_stats()
      state.position = [st.camera_position[0], state.position[1], st.camera_position[2]]
    }
    requestAnimationFrame(loop)
  })
}

/** Soft-clamp the walk controller body inside the zone (XZ; Y is the controller's) via the SAME zone_border
 *  clamp the engine uses on the camera — the feet can't leave the zone.
 *  @param {any} st @param {import('../src/core/zone_border.js').ZoneBounds} b */
function clamp_walk_body(st, b) {
  const c = clamp_to_bounds(st.position, b).position
  ;[st.position[0], , st.position[2]] = c
}

/** @param {number[]} out @param {number} s @param {number[]} v */
function axpy(out, s, v) {
  out[0] += s * v[0]
  out[1] += s * v[1]
  out[2] += s * v[2]
}
