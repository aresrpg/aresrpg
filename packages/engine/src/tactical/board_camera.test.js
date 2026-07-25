// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board_camera — ONE rig, TWO projections (owner ruling 2026-07-25: the simulator's board floats in the
// void under a TRUE isometric, so a `void_scene` engine renders through an OrthographicCamera).
//
// What is pinned here is the only thing that can silently drift: which projection knob the rig drives. A
// fov write on an orthographic camera is a no-op that leaves the frustum at its boot default (the board
// would be framed by an arbitrary 40 m window and the wheel would do nothing), and a view-size write on a
// perspective camera is dead code. The pose itself is projection-independent and identical either way —
// asserted here so the ortho branch can never quietly change the world's fight camera.
//
// Same fake-DOM idiom as pointer_lock.test.js (bun has no real DOM).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { create_board_camera, POLAR_RAD } from './board_camera.js'

/** A minimal fake element/window (addEventListener only — the rig binds drag + wheel). */
const fake_target = () => {
  const listeners = /** @type {Map<string, Set<(e: any) => void>>} */ (new Map())
  return {
    addEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(fn)
    },
    removeEventListener(/** @type {string} */ type, /** @type {(e: any) => void} */ fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(/** @type {string} */ type, /** @type {any} */ event = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
  }
}

/** An engine stub that records every camera write and answers with the given camera kind. */
const fake_engine = (/** @type {boolean} */ orthographic) => {
  const calls = {
    position: /** @type {number[][]} */ ([]),
    orientation: /** @type {number[][]} */ ([]),
    fov: /** @type {number[]} */ ([]),
    view_size: /** @type {number[]} */ ([]),
  }
  return {
    calls,
    get_camera: () => (orthographic ? { isOrthographicCamera: true } : { isPerspectiveCamera: true }),
    set_camera_position: (/** @type {number[]} */ p) => calls.position.push(p),
    set_camera_orientation: (/** @type {number} */ yaw, /** @type {number} */ pitch) =>
      calls.orientation.push([yaw, pitch]),
    set_camera_fov: (/** @type {number} */ f) => calls.fov.push(f),
    set_camera_view_size: (/** @type {number} */ h) => calls.view_size.push(h),
  }
}

const globals = /** @type {any} */ (globalThis)
let saved_window = /** @type {any} */ (undefined)
let saved_raf = /** @type {any} */ (undefined)
let saved_caf = /** @type {any} */ (undefined)

beforeEach(() => {
  saved_window = globals.window
  saved_raf = globals.requestAnimationFrame
  saved_caf = globals.cancelAnimationFrame
  globals.window = fake_target()
  globals.requestAnimationFrame = () => 1 // the rig pushes once synchronously in activate(); no loop here
  globals.cancelAnimationFrame = () => {}
})
afterEach(() => {
  globals.window = saved_window
  globals.requestAnimationFrame = saved_raf
  globals.cancelAnimationFrame = saved_caf
})

/** span 24 m ⇒ perspective dolly clamp(24*1.7)=40.8; ortho view height clamp(24*1.4)=33.6 */
const SPAN = 24
const TARGET = /** @type {[number, number, number]} */ ([10, 2, -6])

const rig_on = (/** @type {boolean} */ orthographic) => {
  const engine = fake_engine(orthographic)
  const dom = fake_target()
  const rig = create_board_camera({
    engine: /** @type {any} */ (engine),
    dom: /** @type {any} */ (dom),
    target: TARGET,
    span: SPAN,
  })
  rig.activate()
  return { engine, dom, rig }
}

describe('the board camera drives the projection the live camera actually has', () => {
  test('an ORTHOGRAPHIC engine is sized by frustum height and never by fov', () => {
    const { engine, rig } = rig_on(true)
    expect(engine.calls.fov).toEqual([])
    expect(engine.calls.view_size).toEqual([SPAN * 1.4])
    expect(rig.get_state().view_h).toBeCloseTo(SPAN * 1.4, 6)
  })

  test('a PERSPECTIVE engine keeps the faux-iso fov and is never sized (the world fight camera is untouched)', () => {
    const { engine } = rig_on(false)
    expect(engine.calls.fov).toEqual([42])
    expect(engine.calls.view_size).toEqual([])
  })

  test('the POSE is projection-independent — both cameras sit at the same locked-iso pose', () => {
    const ortho = rig_on(true)
    const perspective = rig_on(false)
    expect(ortho.engine.calls.position[0]).toEqual(perspective.engine.calls.position[0])
    expect(ortho.engine.calls.orientation[0]).toEqual(perspective.engine.calls.orientation[0])
    // and it IS the locked polar: the eye sits cos(POLAR)·dolly above the target
    const [eye] = ortho.engine.calls.position
    const [, eye_y] = eye
    expect(eye_y - TARGET[1]).toBeCloseTo(Math.cos(POLAR_RAD) * SPAN * 1.7, 6)
  })

  test('the wheel zooms the FRUSTUM under ortho and the DOLLY under perspective', () => {
    const o = rig_on(true)
    o.dom.dispatch('wheel', { deltaY: 100, preventDefault() {} })
    expect(o.rig.get_state().view_h).toBeCloseTo(SPAN * 1.4 + 100 * 0.03, 6)
    expect(o.rig.get_state().dolly).toBeCloseTo(SPAN * 1.7, 6) // the eye never moved

    const p = rig_on(false)
    p.dom.dispatch('wheel', { deltaY: 100, preventDefault() {} })
    expect(p.rig.get_state().dolly).toBeCloseTo(SPAN * 1.7 + 100 * 0.015, 6)
  })
})
