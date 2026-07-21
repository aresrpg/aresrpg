// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [p0-fight-init] FACADE REGRESSION — the handle's event bus + picking survive teardown→rebuild.
//
// Root of the first-transition-fight dead-input family: the dapp adapter subscribes board.on('cell_click'…)
// ONCE per handle; the old public teardown() wiped the listener bus (keep_listeners:false), so after any
// live teardown (the placement→active churn, a next-room rebuild) the rebuilt board's picking emitted into
// nobody — hover/click/cast dead for the rest of the fight. This test drives the REAL facade headless
// (stub engine/canvas, real three camera + geometry + picking math) through build → click → teardown →
// REBUILD → click and asserts the pre-teardown subscription still receives the post-rebuild click.

import { test, expect, describe } from 'bun:test'
import { PerspectiveCamera, Group } from 'three'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): index.js imports board_entities.js, which unconditionally imports
// create_character_avatar — a static import of the absent-by-design senshi_male.glb (test_helpers/glb_fixture.js).
const { create_tactical_board } = SENSHI_MALE_GLB_AVAILABLE ? await import('./index.js') : {}

// rAF shim — the facade's build/tick paths poll on requestAnimationFrame (absent under bun test).
globalThis.requestAnimationFrame ??= (/** @type {FrameRequestCallback} */ cb) =>
  /** @type {any} */ (setTimeout(() => cb(performance.now()), 0))
globalThis.cancelAnimationFrame ??= (/** @type {any} */ id) => clearTimeout(id)

/** A minimal live-engine stub: real camera (the picking math is real), no-op scene. */
function make_engine() {
  const scene = new Group()
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 500)
  // above the 8×8 board (cell_size default 1.33 → span ≈ 10.6 m), looking near-straight down at its centre.
  camera.position.set(5.3, 30, 5.9)
  camera.lookAt(5.3, 0, 5.3)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return {
    get_scene: () => scene,
    get_camera: () => camera,
    add_to_scene: (/** @type {any} */ o) => scene.add(o),
    remove_from_scene: (/** @type {any} */ o) => scene.remove(o),
    get_board_occlusion: () => null,
    sample_block: () => 0,
  }
}

/** A canvas stub that records pointer listeners so the test can drive the REAL registered handlers. */
function make_canvas() {
  /** @type {Record<string, Function[]>} */
  const handlers = {}
  return {
    handlers,
    addEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => {
      ;(handlers[ev] ??= []).push(fn)
    },
    removeEventListener: (/** @type {string} */ ev, /** @type {Function} */ fn) => {
      const a = handlers[ev] ?? []
      const i = a.indexOf(fn)
      if (i >= 0) a.splice(i, 1)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    style: {},
  }
}

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('tactical facade — listener bus + picking across teardown→rebuild', () => {
  test('a pre-teardown cell_click subscription still fires after teardown + rebuild', async () => {
    const engine = make_engine()
    const canvas = make_canvas()
    const board = create_tactical_board({ engine: /** @type {any} */ (engine), canvas: /** @type {any} */ (canvas) })

    /** @type {any[]} */
    const clicks = []
    const off = board.on('cell_click', (c) => clicks.push(c)) // the adapter's once-per-handle subscription

    const spec = { grid_w: 8, grid_h: 8, flat: true }
    await board.build(spec)
    expect(board._descriptor()).not.toBeNull()

    // drive the REAL registered handlers at the canvas centre — the ray hits the board centre. A click is
    // the full gesture contract (drag-click gate law): pointerdown + matching pointerup within the drift
    // tolerance; the cell projection runs at UP-time.
    const click_centre = () => {
      for (const fn of canvas.handlers.pointerdown ?? []) fn({ button: 0, clientX: 400, clientY: 300 })
      for (const fn of canvas.handlers.pointerup ?? []) fn({ button: 0, clientX: 400, clientY: 300 })
    }
    click_centre()
    expect(clicks.length).toBe(1)
    expect(clicks[0]).toEqual({ x: expect.any(Number), y: expect.any(Number) })

    // teardown: picking detaches (no emission), descriptor clears — but the BUS must survive.
    board.teardown()
    expect(board._descriptor()).toBeNull()
    expect((canvas.handlers.pointerdown ?? []).length).toBe(0) // picking listeners genuinely detached
    expect((canvas.handlers.pointerup ?? []).length).toBe(0)
    expect(clicks.length).toBe(1)

    // REBUILD (the churn/next-room cycle): the SAME subscription must receive the new board's clicks.
    await board.build(spec)
    click_centre()
    expect(clicks.length).toBe(2) // ← the regression: pre-fix the wiped bus swallowed this forever

    // the caller's own unsubscribe still works (handle contract).
    off()
    click_centre()
    expect(clicks.length).toBe(2)

    board.teardown() // stop the tick loop so no timer outlives the test
  })
})
