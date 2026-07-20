// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [owner: right-click dead app-wide] regression proof — the contextmenu suppressor (`sc`) must bind to
// the CANVAS render target ONLY, never `window`. Before this fix it rode window, so the spectate
// backdrop (which sits behind the whole app) killed native right-click/inspect-element on every route,
// not just the vista. Black-box: dispatch synthetic events through fake, listener-recording targets and
// assert (a) window never gets a 'contextmenu' registration, (b) canvas does, and (c) the RMB-drag-vs-
// menu suppression the camera still needs keeps working through the canvas.

import { afterAll, describe, expect, it } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

/** A minimal fake EventTarget — records listeners per type so a test can assert WHERE a handler was
 *  bound (the crux of this regression) and dispatch synthetic events to prove behavior survives the move. */
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
    has(/** @type {string} */ type) {
      return (listeners.get(type)?.size ?? 0) > 0
    },
  }
}

// create_spectate_camera wires window listeners + a rAF loop at construction — bun has no DOM/rAF.
// card_guard() does `target instanceof Element`, so a bare-bones Element stand-in is required too
// (production `Element` always exists; only the headless test runtime is missing it).
const restore_browser_globals = install_browser_globals({ with_element: true })

const { create_spectate_camera } = await import('./embed_voxel_spectate.js')

afterAll(restore_browser_globals)

/** A synthetic mouse/contextmenu event with a safe no-op preventDefault + a spy flag. */
function evt(/** @type {Record<string, any>} */ overrides = {}) {
  const e = /** @type {any} */ ({ prevented: false, target: null, clientX: 0, clientY: 0, button: 0, ...overrides })
  e.preventDefault = () => (e.prevented = true)
  return e
}

describe('spectate camera — contextmenu suppressor binds to canvas, never window', () => {
  it('registers contextmenu on the canvas and NEVER on window', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const engine = { set_camera_position: () => {}, set_camera_orientation: () => {} }
    const cleanup = create_spectate_camera(engine, [0, 100, 0], canvas)

    expect(canvas.has('contextmenu'), 'the suppressor must bind to the canvas').toBe(true)
    expect(window_.has('contextmenu'), 'window must NEVER get a contextmenu listener (the app-wide bug)').toBe(false)
    // sanity: the drag gestures are untouched — still window-scoped (unrelated to this bug)
    expect(window_.has('mousedown')).toBe(true)
    expect(window_.has('mouseup')).toBe(true)
    expect(window_.has('mousemove')).toBe(true)

    cleanup()
  })

  it('a contextmenu dispatched on WINDOW is never intercepted — right-click survives on every other page', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const engine = { set_camera_position: () => {}, set_camera_orientation: () => {} }
    create_spectate_camera(engine, [0, 100, 0], canvas)

    const e = evt({ target: new /** @type {any} */ (globalThis.Element)() })
    window_.dispatch('contextmenu', e) // simulates right-click on a non-canvas page (encyclopedia/admin)
    expect(e.prevented, 'no listener rides window anymore — the native menu must fire normally').toBe(false)
  })

  it('RMB behavior is preserved: a contextmenu on the canvas (the vista itself) is still suppressed', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const engine = { set_camera_position: () => {}, set_camera_orientation: () => {} }
    create_spectate_camera(engine, [0, 100, 0], canvas)

    // target = a bare Element (the canvas), closest(...) → null ⇒ card_guard false ⇒ suppressed, exactly
    // as it behaved pre-fix for a right-drag-to-yaw on the vista.
    const e = evt({ target: new /** @type {any} */ (globalThis.Element)() })
    canvas.dispatch('contextmenu', e)
    expect(e.prevented, 'RMB-drag-to-yaw on the vista must still suppress the native menu').toBe(true)
  })

  it('card-guarded targets (buttons/inputs on the overlaid login card) are still left alone', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const engine = { set_camera_position: () => {}, set_camera_orientation: () => {} }
    create_spectate_camera(engine, [0, 100, 0], canvas)

    const card_el = new /** @type {any} */ (globalThis.Element)()
    card_el.closest = () => true // stands in for `.closest('button, input, a, form, textarea, select')` matching
    const e = evt({ target: card_el })
    canvas.dispatch('contextmenu', e)
    expect(e.prevented, 'card_guard keeps interactive UI right-click-able').toBe(false)
  })

  it('gate: a drag is IGNORED when can_interact() is false, honored when true', () => {
    // Two iso frames at the SAME `t` → the second has dt=0, freezing the cinematic auto-drift, so any position
    // delta between them is the DRAG alone — the gate becomes observable without the drift confounding it.
    const run = (/** @type {() => boolean} */ can_interact) => {
      const window_ = fake_target()
      globalThis.window = /** @type {any} */ (window_)
      const canvas = /** @type {any} */ (fake_target())
      let frame_cb = /** @type {any} */ (null)
      globalThis.requestAnimationFrame = /** @type {any} */ ((/** @type {any} */ cb) => ((frame_cb = cb), 1))
      const positions = /** @type {number[][]} */ ([])
      const engine = {
        get_zone_bounds: () => null, // unclamped pan
        set_camera_position: (/** @type {number[]} */ p) => positions.push([...p]),
        set_camera_orientation: () => {},
      }
      create_spectate_camera(engine, [0, 100, 0], canvas, can_interact)
      const t = performance.now() + 5000 // positive dt on the seed frame; dt=0 on the second (same t)
      frame_cb(t)
      const before = positions.at(-1)
      window_.dispatch('mousedown', evt({ button: 0, target: new /** @type {any} */ (globalThis.Element)() }))
      window_.dispatch('mousemove', evt({ clientX: 240, clientY: 0 })) // a big LMB pan
      window_.dispatch('mouseup', evt({}))
      frame_cb(t)
      return { before, after: positions.at(-1) }
    }

    const gated = run(() => false)
    expect(gated.after, 'a gated drag must not move the display-only backdrop').toEqual(gated.before)

    const live = run(() => true)
    expect(live.after, 'an interactive drag pans the vista').not.toEqual(live.before)
    expect(Math.abs(live.after[0] - live.before[0]), '~240px × 0.12 m/px pan applied').toBeGreaterThan(1)
  })

  it('cleanup removes the canvas listener (no leak across remounts)', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const engine = { set_camera_position: () => {}, set_camera_orientation: () => {} }
    const cleanup = create_spectate_camera(engine, [0, 100, 0], canvas)
    expect(canvas.has('contextmenu')).toBe(true)
    cleanup()
    expect(canvas.has('contextmenu'), 'dispose must remove the canvas-scoped listener').toBe(false)
  })

  it('pause cancels the camera rAF and resume re-arms it', () => {
    const window_ = fake_target()
    globalThis.window = /** @type {any} */ (window_)
    const canvas = /** @type {any} */ (fake_target())
    const frames = new Map()
    let next_id = 1
    globalThis.requestAnimationFrame = /** @type {any} */ ((callback) => {
      const id = next_id++
      frames.set(id, callback)
      return id
    })
    globalThis.cancelAnimationFrame = (id) => frames.delete(id)
    const cleanup = create_spectate_camera(
      { set_camera_position: () => {}, set_camera_orientation: () => {} },
      [0, 100, 0],
      canvas
    )
    expect(frames.size).toBe(1)
    cleanup.set_paused(true)
    expect(frames.size).toBe(0)
    cleanup.set_paused(false)
    expect(frames.size).toBe(1)
    cleanup()
    expect(frames.size).toBe(0)
  })
})
