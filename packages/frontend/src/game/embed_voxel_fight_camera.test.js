// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-ENTRY CINEMATIC — headless proof of the fight camera's prepare→settle state machine:
// begin_prepare snaps to iso + slowly ORBITS a synthetic anchor frame while the board builds;
// set_active(true) (board ready) SETTLES the azimuth into the canonical corner with the zoom-punch boom;
// reduced-motion holds the pose still. Black-box: we recover the orbit azimuth from the camera position the
// module writes each apply() (px = cx + horiz·sin(az); pz = cz + horiz·cos(az)) and assert the choreography.

import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { PerspectiveCamera } from 'three'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// create_fight_camera wires canvas + window listeners at construction — stub the DOM it touches (bun has none).
const restore_browser_globals = install_browser_globals()
const browser_window = globalThis.window

const { create_fight_camera } = await import('./embed_voxel_fight_camera.js')

afterAll(restore_browser_globals)
afterEach(() => {
  globalThis.window = browser_window
})

const CELL = 1.33 // BOARD_CELL_M
const GRID = 11 // the prepare footprint (PREP_GRID)
const FRAME = { origin: { x: 0, y: 0, z: 0 }, grid_w: GRID, grid_h: GRID }
const CX = FRAME.origin.x + (GRID * CELL) / 2
const CZ = FRAME.origin.z + (GRID * CELL) / 2

/** Fixed render-time data: `step(dt)` advances the exact timeline sampled by the camera pose. */
const fixed_timeline = () => {
  let elapsed_ms = 0
  return {
    now: () => elapsed_ms,
    step: (/** @type {number} */ dt) => {
      elapsed_ms += dt * 1000
    },
  }
}

/** A minimal fake EventTarget — stores listeners so a test can DISPATCH synthetic gestures (pointer/wheel/
 *  contextmenu) exactly like a real canvas/window would deliver them, then read the result off `positions`
 *  (same black-box philosophy as the rest of this file: recover state from what apply() wrote, never reach
 *  into module internals). */
function fake_target() {
  const listeners = /** @type {Map<string, Set<(e: any) => void>>} */ (new Map())
  return {
    addEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(fn)
    },
    removeEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(/** @type {string} */ type, /** @type {any} */ evt) {
      for (const fn of listeners.get(type) ?? []) fn(evt)
    },
    listener_names(/** @type {string} */ type) {
      return [...(listeners.get(type) ?? [])].map((fn) => fn.name)
    },
  }
}

/** Right-drag pan + its double-click RESET ride on WINDOW listeners (D250/D264a idiom) — swap in a fresh
 *  dispatchable window for the duration of a test (the shared beforeAll stub stays a harmless no-op for every
 *  test that doesn't dispatch through it). */
function fresh_window() {
  const window_ = /** @type {any} */ ({
    ...browser_window,
    ...fake_target(),
    matchMedia: () => ({ matches: false }),
  })
  globalThis.window = window_
  return window_
}

/** A synthetic pointer/wheel event with a safe no-op preventDefault (every handler in the module calls it). */
const ptr = (/** @type {Record<string, any>} */ overrides = {}) => ({
  preventDefault() {},
  stopImmediatePropagation() {},
  clientX: 0,
  clientY: 0,
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  ...overrides,
})

/** A recording engine + a dispatchable canvas — the module writes the pose here and adds listeners there. */
function make_rig() {
  const positions = /** @type {number[][]} */ ([])
  const blur = /** @type {boolean[]} */ ([])
  const camera = new PerspectiveCamera(70, 800 / 600, 0.1, 1000)
  const engine = {
    set_camera_position: (/** @type {number[]} */ p) => positions.push(p),
    set_camera_orientation: () => {},
    set_camera_fov: () => {},
    set_motion_blur_enabled: (/** @type {boolean} */ b) => blur.push(b),
    get_camera: () => camera,
  }
  const canvas = /** @type {any} */ ({
    ...fake_target(),
    style: {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  })
  return { engine, canvas, positions, blur, camera }
}

/** The orbit azimuth recovered from the last written camera position (wobble is sub-0.01 rad at this distance). */
const az_from = (/** @type {number[]} */ p) => Math.atan2(p[0] - CX, p[2] - CZ)

/** Drive `n` frames (integrate then apply) and return the azimuth after each. `board_frame` null ⇒ apply reads
 *  the synthetic prepare frame (the pre-build path); non-null ⇒ the real board (the settled path). */
function run(cam, n, dt, board_frame, positions, step = () => {}) {
  const out = /** @type {number[]} */ ([])
  for (let i = 0; i < n; i++) {
    step(dt)
    cam.integrate(dt)
    cam.apply(dt, () => board_frame)
    out.push(az_from(positions[positions.length - 1]))
  }
  return out
}

describe('fight camera — fight-entry prepare→settle choreography', () => {
  it('begin_prepare engages the camera and snaps to the iso corner (motion blur off)', () => {
    const { engine, canvas, positions, blur } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    expect(cam.is_active()).toBe(false)
    cam.begin_prepare({ frame: FRAME, reduced: false })
    expect(cam.is_active()).toBe(true)
    expect(blur.at(-1)).toBe(false) // no smear on the orbit
    cam.apply(0.016, () => null) // synthetic frame → a real pose written
    expect(az_from(positions.at(-1))).toBeCloseTo(Math.PI / 4, 1) // opens at the 45° corner
  })

  it('PREPARE orbits: the azimuth advances ≈PREPARE_ROT_SPEED while the board is still building', () => {
    const { engine, canvas, positions } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.begin_prepare({ frame: FRAME, reduced: false })
    const az = run(cam, 60, 1 / 60, null, positions) // 1.0 s, no real board yet
    const advanced = az.at(-1) - az[0]
    expect(advanced).toBeGreaterThan(0.4) // ≈0.6 rad/s · 1 s, minus a starting partial-frame — clearly rotating
    expect(advanced).toBeLessThan(0.8)
    // strictly monotonic (a turntable never reverses mid-prepare)
    for (let i = 1; i < az.length; i++) expect(az[i]).toBeGreaterThan(az[i - 1] - 1e-6)
  })

  it('REDUCED-motion holds the iso pose still — no spin', () => {
    const { engine, canvas, positions } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.begin_prepare({ frame: FRAME, reduced: true })
    const az = run(cam, 60, 1 / 60, null, positions)
    expect(Math.abs(az.at(-1) - az[0])).toBeLessThan(0.02) // only the sub-degree idle wobble, never a rotation
    expect(az[0]).toBeCloseTo(Math.PI / 4, 1)
  })

  it('SETTLE on board-ready: the azimuth eases the SHORT way back to the corner and locks', () => {
    const { engine, canvas, positions } = make_rig()
    const timeline = fixed_timeline()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL, now: timeline.now })
    cam.begin_prepare({ frame: FRAME, reduced: false })
    run(cam, 90, 1 / 60, null, positions, timeline.step) // 1.5 s orbit — well past MIN_PREPARE (0.9 s)
    const before = az_from(positions.at(-1))
    expect(before).toBeGreaterThan(Math.PI / 4 + 0.3) // it really rotated away from the corner
    cam.set_active(true) // board ready → settle now (floor already elapsed)
    const az = run(cam, 120, 1 / 60, FRAME, positions, timeline.step) // 2 s ease on fixed dt samples
    // The always-on idle wobble is part of the pose, but its phase is now deterministic timeline data rather
    // than whichever wall-clock phase the runner happened to sample.
    expect(az.at(-1)).toBeCloseTo(Math.PI / 4, 1) // locked back at the canonical corner
    // eased the SHORT way: never overshoots past the corner (monotonic decrease toward it)
    for (let i = 1; i < az.length; i++) expect(az[i]).toBeLessThanOrEqual(az[i - 1] + 1e-6)
  })

  it('board-ready BEFORE the min-rotation floor DEFERS the settle (the beat always reads)', () => {
    const { engine, canvas, positions } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.begin_prepare({ frame: FRAME, reduced: false })
    run(cam, 12, 1 / 60, null, positions) // 0.2 s — well under the 0.9 s floor
    cam.set_active(true) // board ready EARLY — must NOT settle yet
    const early = run(cam, 12, 1 / 60, null, positions) // still orbiting (0.2→0.4 s)
    expect(early.at(-1)).toBeGreaterThan(early[0] + 0.05) // rotation continued, settle deferred
    const late = run(cam, 120, 1 / 60, FRAME, positions) // cross the floor → settle fires → lock to the corner
    expect(late.at(-1)).toBeCloseTo(Math.PI / 4, 1) // precision 1 — see the wobble-margin note above
  })

  it('DIRECT engage (no prepare — a RELOAD-RESUME onto a live board) opens straight at the settled corner', () => {
    // Rule (2026-07-10): the cinematic is fresh-creates-only. On a resume, fight_entry's gate never
    // calls begin_prepare (fight_fresh:false — see fight_entry.test.js), so the adapter's on_fight(true) lands
    // here with NO prepare running: the camera must snap straight to the settled tactical pose, no rotation.
    const { engine, canvas, positions, blur } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true) // never prepared — the boring-reliable resume engage
    expect(cam.is_active()).toBe(true)
    expect(blur.at(-1)).toBe(false)
    cam.apply(0.016, () => FRAME)
    expect(az_from(positions.at(-1))).toBeCloseTo(Math.PI / 4, 1)
  })

  it('RELEASE hands the camera back and restores motion blur', () => {
    const { engine, canvas, blur } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.begin_prepare({ frame: FRAME, reduced: false })
    cam.set_active(false)
    expect(cam.is_active()).toBe(false)
    expect(blur.at(-1)).toBe(true) // motion blur back on for the walk rig
  })
})

describe('fight camera — lobby route scroll-lock lifecycle', () => {
  for (const [state, engage] of [
    ['fight-entry overlay', (cam) => cam.begin_prepare({ frame: FRAME, reduced: false })],
    ['active fight', (cam) => cam.set_active(true)],
  ]) {
    it(`releases the global wheel lock on shop navigation and unmount during ${state}`, () => {
      const { engine, canvas } = make_rig()
      const window_ = fresh_window()
      const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
      const wheel_is_blocked = () => {
        let blocked = false
        window_.dispatch('wheel', ptr({ deltaY: 100, preventDefault: () => (blocked = true) }))
        return blocked
      }

      engage(cam)
      expect(wheel_is_blocked(), 'the visible lobby fight camera must own wheel zoom').toBe(true)

      cam.set_paused?.(true) // GameWorldHost route / → /shop
      expect(wheel_is_blocked(), 'the shop scroll container must receive wheel input after route pause').toBe(false)
      expect(window_.listener_names('wheel'), 'route pause must release the global capture listener').toEqual([])

      cam.set_paused?.(false) // return to the still-live lobby fight
      expect(wheel_is_blocked(), 'returning to the lobby must restore fight-camera wheel zoom').toBe(true)

      cam.dispose()
      expect(wheel_is_blocked(), 'unmount must leave no global wheel lock behind').toBe(false)
      expect(window_.listener_names('wheel'), 'unmount must release the global capture listener').toEqual([])
    })
  }
})

// Allows right-drag during fights to slightly move the board manually, and to zoom
// more — right-drag PAN (clamped, no spring-back), widened wheel-zoom rails, and the double-right-click
// RESET. Same black-box philosophy: dispatch synthetic gestures through fake_target()-backed canvas/window
// and recover state from the position apply() writes.

const HORIZ_DEFAULT = 22 * Math.sin((50 * Math.PI) / 180) // this board's tuned default: base=22 (fit clamps up), polar=50°
/** The fit/dolly distance recovered from a position — valid only while pan is 0 (the zoom-only tests keep it
 *  that way): the √2 from the 45°-corner azimuth cancels against the hypot, so the horizontal radius from the
 *  board center IS `dist·sin(polar)` directly (±wobble, ~0.1 m). */
const dist_from = (/** @type {number[]} */ p) => Math.hypot(p[0] - CX, p[2] - CZ) / Math.sin((50 * Math.PI) / 180)
/** The pan offset recovered from a position — valid only while dist is the default (fight_dolly untouched,
 *  so horiz === HORIZ_DEFAULT) and azimuth is the untouched π/4 default (the pan-only tests keep both true). */
const pan_from = (/** @type {number[]} */ p) => ({
  x: p[0] - CX - HORIZ_DEFAULT * Math.sin(Math.PI / 4),
  z: p[2] - CZ - HORIZ_DEFAULT * Math.cos(Math.PI / 4),
})

describe('fight camera — right-drag pan, widened zoom rails, and the double-right-click reset', () => {
  it('the wheel reaches the new tighter minimum and the new farther maximum (frustum scale, not eye distance)', () => {
    const { engine, canvas, positions, camera } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    const top_default = camera.top // fight_dolly=0 ⇒ dist=base=22, the 1.0-ratio baseline frustum

    for (let i = 0; i < 40; i++) window_.dispatch('wheel', ptr({ deltaY: -100 })) // zoom IN, well past saturation
    cam.apply(0.016, () => FRAME)
    expect(camera.top, 'wheel-in reaches the new 11 m floor, not the old 17').toBeCloseTo(top_default * (11 / 22), 2)
    expect(dist_from(positions.at(-1)), 'ortho zoom is frustum-only, eye pinned at base').toBeCloseTo(22, 0)

    const rig2 = make_rig()
    const window2 = fresh_window()
    const cam2 = create_fight_camera({ engine: rig2.engine, canvas: rig2.canvas, board_cell_m: CELL })
    cam2.set_active(true)
    for (let i = 0; i < 40; i++) window2.dispatch('wheel', ptr({ deltaY: 100 })) // zoom OUT, well past saturation
    cam2.apply(0.016, () => FRAME)
    expect(rig2.camera.top, 'wheel-out reaches the new 42 m ceiling, not the old 32').toBeCloseTo(
      top_default * (42 / 22),
      2
    )
  })

  it('the DEFAULT pose (zero wheel input) is UNCHANGED by the wider rails — never alter the tuned pose', () => {
    const { engine, canvas, positions } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    expect(
      dist_from(positions.at(-1)),
      'fight_dolly=0 must still give the tuned fit distance (base=22 for this board)'
    ).toBeCloseTo(22, 0)
  })

  it('right-drag pans within the ~30-40% envelope and clamps at the edge (never flies off unbounded)', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME) // primes pan_limit_x/z for THIS board before any drag
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 9 }))
    window_.dispatch('pointermove', ptr({ clientX: 1_000_000, clientY: 0 })) // huge +dx, guaranteed past the clamp
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    const { x: panx, z: panz } = pan_from(positions.at(-1))
    const board_half = (GRID * CELL) / 2
    const lo = board_half * 0.3 - 0.2
    const hi = board_half * 0.4 + 0.2
    expect(Math.abs(panx), 'pan must actually reach the envelope, not stay tiny').toBeGreaterThan(lo)
    expect(Math.abs(panx), 'pan must clamp INSIDE the ~30-40% envelope, never fly off unbounded').toBeLessThan(hi)
    expect(panx, 'drag +X ⇒ "grab the world" ⇒ the pivot moves toward -X').toBeLessThan(0)
    expect(panz, 'at the 45° corner a pure +dx drag moves both axes together').toBeGreaterThan(0)
  })

  it('a small right-drag pans proportionally — the clamp only bites at the edges', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 3 }))
    window_.dispatch('pointermove', ptr({ clientX: 100, clientY: 0 })) // a modest, sub-clamp drag
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    const { x: panx } = pan_from(positions.at(-1))
    expect(Math.abs(panx), '≈cos(45°)·100px·0.015 m/px ≈ 1.06 m — well under the ~2.2-2.9 m envelope').toBeGreaterThan(
      0.6
    )
    expect(Math.abs(panx)).toBeLessThan(1.6)
  })

  it('pan has NO spring-back — it stays exactly where panned across many idle frames', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 4 }))
    window_.dispatch('pointermove', ptr({ clientX: 100, clientY: 0 }))
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    const just_after = pan_from(positions.at(-1))
    for (let i = 0; i < 120; i++) cam.integrate(1 / 60) // 2 s idle — a spring-back would show up here
    cam.apply(0.016, () => FRAME)
    const later = pan_from(positions.at(-1))
    expect(later.x, 'pan must not decay/spring back on its own').toBeCloseTo(just_after.x, 0)
  })

  it('double right-click RESETS pan + zoom to the tuned default', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    // max out pan …
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 1 }))
    window_.dispatch('pointermove', ptr({ clientX: 1_000_000, clientY: 0 }))
    window_.dispatch('pointerup', ptr({}))
    // … and zoom, in the SAME session
    for (let i = 0; i < 40; i++) window_.dispatch('wheel', ptr({ deltaY: -100 }))
    cam.apply(0.016, () => FRAME)
    const mid = positions.at(-1)
    expect(Math.hypot(mid[0] - CX, mid[2] - CZ), 'sanity: pan+zoom actually moved the camera').toBeGreaterThan(2)
    // DOUBLE RIGHT-CLICK — two right-pointerdowns close in time+space (the first is far away, so it must NOT
    // register as a double-click against it; only the second pair does).
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 500, clientY: 500, pointerId: 5 }))
    window_.dispatch('pointerup', ptr({}))
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 503, clientY: 502, pointerId: 6 }))
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    const after = positions.at(-1)
    const { x: panx, z: panz } = pan_from(after)
    expect(Math.abs(panx), 'RESET clears pan_x').toBeLessThan(0.25)
    expect(Math.abs(panz), 'RESET clears pan_z').toBeLessThan(0.25)
    expect(dist_from(after), 'RESET returns zoom to the tuned default distance (base=22 for this board)').toBeCloseTo(
      22,
      0
    )
  })

  it('gesture separation: a left-drag does nothing (fixed iso angle by default) — the wheel still scales the frustum', () => {
    const { engine, canvas, positions, camera } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    const az_before = az_from(positions.at(-1))
    const top_before = camera.top

    canvas.dispatch('pointerdown', ptr({ button: 0, clientX: 0, clientY: 0, pointerId: 1 })) // the old D238 orbit gesture
    window_.dispatch('pointermove', ptr({ clientX: 300, clientY: 0 }))
    for (let i = 0; i < 60; i++) cam.integrate(1 / 60)
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    expect(az_from(positions.at(-1)), 'the fixed iso angle never rotates').toBeCloseTo(az_before, 2)

    for (let i = 0; i < 40; i++) window_.dispatch('wheel', ptr({ deltaY: -100 })) // zoom IN, well past saturation
    cam.apply(0.016, () => FRAME)
    expect(camera.top, 'wheel zoom still maps to frustum scale, not a moving eye').toBeLessThan(top_before)
  })

  it('gesture separation: a right-drag pan causes no residual drift once released', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 1 }))
    window_.dispatch('pointermove', ptr({ clientX: 300, clientY: 0 }))
    window_.dispatch('pointerup', ptr({}))
    cam.apply(0.016, () => FRAME)
    const after_pan = positions.at(-1)
    // idle for 60 frames with ZERO further input — a right-drag pan must never leak into any residual glide
    // (the fixed iso angle has no orbit-drag at all now, but this regression guard stays cheap insurance).
    for (let i = 0; i < 60; i++) cam.integrate(1 / 60)
    cam.apply(0.016, () => FRAME)
    const after_idle = positions.at(-1)
    expect(after_idle[0]).toBeCloseTo(after_pan[0], 0)
    expect(after_idle[2]).toBeCloseTo(after_pan[2], 0)
  })

  it('suppresses the native context menu during a fight, but not before one starts', () => {
    const { engine, canvas } = make_rig()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    let prevented = false
    const evt = { preventDefault: () => (prevented = true) }
    canvas.dispatch('contextmenu', evt) // no active fight yet — the listener is registered but gated off
    expect(prevented, 'no active fight ⇒ the native menu must NOT be suppressed').toBe(false)
    cam.set_active(true)
    canvas.dispatch('contextmenu', evt)
    expect(prevented, 'an active fight ⇒ RMB is a camera gesture, the native menu must be suppressed').toBe(true)
  })

  it('cursor feedback: grab while a fight is live, grabbing while actively panning, cleared on release', () => {
    const { engine, canvas } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL })
    expect(canvas.style.cursor, 'no fight yet ⇒ no cursor hint').toBeFalsy()
    cam.set_active(true)
    expect(canvas.style.cursor).toBe('grab')
    canvas.dispatch('pointerdown', ptr({ button: 2, clientX: 0, clientY: 0, pointerId: 1 }))
    expect(canvas.style.cursor).toBe('grabbing')
    window_.dispatch('pointerup', ptr({})) // pan_up is window-scoped in production (D250 idiom) — release there
    expect(canvas.style.cursor, 'back to the drag hint after release, while the fight is still live').toBe('grab')
    cam.set_active(false)
    expect(canvas.style.cursor).toBe('')
  })
})

describe('fight camera — fixed mobile touch gestures', () => {
  it('mobile registers one pan/pinch seam and no desktop rotation handlers', () => {
    const { engine, canvas } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL, mobile: true })

    expect(canvas.listener_names('pointerdown')).toEqual(['mobile_pointer_down'])
    expect(window_.listener_names('pointermove')).toEqual(['mobile_pointer_move'])
    expect(window_.listener_names('pointerup')).toEqual(['mobile_pointer_up'])
    expect(canvas.listener_names('pointerdown')).not.toContain('orbit_down')
    expect(window_.listener_names('pointermove')).not.toContain('orbit_move')
    cam.dispose()
  })

  it('keeps <=6px as a tap, but turns >6px into a one-finger pan without rotating', () => {
    const { engine, canvas, positions } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL, mobile: true })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME) // prime this board's live pan bounds
    const before = positions.at(-1)

    let tap_stopped = false
    canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 10, clientX: 100, clientY: 100 }))
    window_.dispatch('pointermove', ptr({ pointerType: 'touch', pointerId: 10, clientX: 106, clientY: 100 }))
    window_.dispatch(
      'pointerup',
      ptr({
        pointerType: 'touch',
        pointerId: 10,
        clientX: 106,
        clientY: 100,
        stopImmediatePropagation: () => (tap_stopped = true),
      })
    )
    cam.apply(0.016, () => FRAME)
    const after_tap = positions.at(-1)
    expect(tap_stopped, 'a <=6px release must reach board_picking and select the tapped cell').toBe(false)
    expect(after_tap[0]).toBeCloseTo(before[0], 1)
    expect(after_tap[2]).toBeCloseTo(before[2], 1)

    let drag_stopped = false
    canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 11, clientX: 100, clientY: 100 }))
    window_.dispatch('pointermove', ptr({ pointerType: 'touch', pointerId: 11, clientX: 107, clientY: 100 }))
    window_.dispatch(
      'pointerup',
      ptr({
        pointerType: 'touch',
        pointerId: 11,
        clientX: 107,
        clientY: 100,
        stopImmediatePropagation: () => (drag_stopped = true),
      })
    )
    cam.apply(0.016, () => FRAME)
    const after_drag = positions.at(-1)
    expect(drag_stopped, 'a >6px release must not leak a cell selection after panning').toBe(true)
    expect(Math.hypot(after_drag[0] - after_tap[0], after_drag[2] - after_tap[2])).toBeGreaterThan(0.05)
  })

  it('pinches to zoom and shifts the pivot toward an off-centre pinch midpoint', () => {
    const pinch = (mid_x) => {
      const { engine, canvas, positions, camera } = make_rig()
      const window_ = fresh_window()
      const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL, mobile: true })
      cam.set_active(true)
      cam.apply(0.016, () => FRAME)
      const before_top = camera.top
      const half = 50
      canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 21, clientX: mid_x - half, clientY: 300 }))
      canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 22, clientX: mid_x + half, clientY: 300 }))
      window_.dispatch(
        'pointermove',
        ptr({ pointerType: 'touch', pointerId: 21, clientX: mid_x - half - 20, clientY: 300 })
      )
      window_.dispatch(
        'pointermove',
        ptr({ pointerType: 'touch', pointerId: 22, clientX: mid_x + half + 20, clientY: 300 })
      )
      cam.apply(0.016, () => FRAME)
      return { position: positions.at(-1), before_top, after_top: camera.top }
    }

    const centered = pinch(400)
    const off_center = pinch(650)
    expect(centered.after_top, 'spreading two fingers must shrink the orthographic frustum').toBeLessThan(
      centered.before_top
    )
    expect(
      Math.hypot(off_center.position[0] - centered.position[0], off_center.position[2] - centered.position[2]),
      'an off-centre pinch must shift the board pivot instead of always zooming around screen centre'
    ).toBeGreaterThan(0.5)
  })
})

describe('fight camera — orthographic projection (every device, by default)', () => {
  it('is orthographic on desktop-default too now (symmetric frustum + corner-angle already proven above), restoring the walk-cam perspective on release', () => {
    const desktop = make_rig()
    const desktop_cam = create_fight_camera({ engine: desktop.engine, canvas: desktop.canvas, board_cell_m: CELL })
    desktop_cam.set_active(true)
    desktop_cam.apply(0.016, () => FRAME)
    expect(desktop.camera.isPerspectiveCamera).toBe(false)
    expect(desktop.camera.isOrthographicCamera).toBe(true)
    desktop_cam.set_active(false) // release hands back to the walk rig — ITS camera is perspective
    expect(desktop.camera.isPerspectiveCamera).toBe(true)
    expect(desktop.camera.isOrthographicCamera).toBe(false)
    expect(desktop.camera.projectionMatrix.elements[11]).toBe(-1)

    const mobile = make_rig()
    fresh_window()
    const mobile_cam = create_fight_camera({
      engine: mobile.engine,
      canvas: mobile.canvas,
      board_cell_m: CELL,
      mobile: true,
    })
    mobile_cam.set_active(true)
    mobile_cam.apply(0.016, () => FRAME)
    expect(mobile.camera.isPerspectiveCamera).toBe(false)
    expect(mobile.camera.isOrthographicCamera).toBe(true)
    expect(mobile.camera.projectionMatrix.elements[11]).toBe(0)
    mobile.camera.aspect = 390 / 844
    mobile.camera.updateProjectionMatrix()
    expect(mobile.camera.isOrthographicCamera, 'a renderer resize must keep the projection type consistent').toBe(true)
    expect(
      mobile.camera.projectionMatrix.elements[11],
      'a renderer resize must not restore perspective mid-fight'
    ).toBe(0)
    mobile_cam.set_active(false)
    expect(mobile.camera.isPerspectiveCamera).toBe(true)
    expect(mobile.camera.isOrthographicCamera).toBe(false)
    expect(mobile.camera.projectionMatrix.elements[11]).toBe(-1)
  })

  it('fits the board in a symmetric frustum and pinch-zooms by shrinking that frustum, not moving the eye', () => {
    const { engine, canvas, positions, camera } = make_rig()
    const window_ = fresh_window()
    const cam = create_fight_camera({ engine, canvas, board_cell_m: CELL, mobile: true })
    cam.set_active(true)
    cam.apply(0.016, () => FRAME)
    const before_top = camera.top
    const before_dist = dist_from(positions.at(-1))
    expect(camera.left).toBeCloseTo(-camera.right, 8)
    expect(camera.bottom).toBeCloseTo(-camera.top, 8)
    expect(camera.right - camera.left).toBeGreaterThan(GRID * CELL)

    canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 31, clientX: 350, clientY: 300 }))
    canvas.dispatch('pointerdown', ptr({ pointerType: 'touch', pointerId: 32, clientX: 450, clientY: 300 }))
    window_.dispatch('pointermove', ptr({ pointerType: 'touch', pointerId: 31, clientX: 320, clientY: 300 }))
    window_.dispatch('pointermove', ptr({ pointerType: 'touch', pointerId: 32, clientX: 480, clientY: 300 }))
    cam.apply(0.016, () => FRAME)
    expect(camera.top).toBeLessThan(before_top)
    expect(dist_from(positions.at(-1))).toBeCloseTo(before_dist, 1)
  })
})

// The always-on idle wobble (kept unconditionally on the iso-default) is covered in the companion
// embed_voxel_fight_camera_wobble.test.js — it reaches into module internals (idle_wobble directly), which
// would break this file's black-box-only philosophy (see the top-of-file note).
