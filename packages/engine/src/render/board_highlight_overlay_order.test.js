// POST-AgX GRAPH ORDER (②) — proves create_post_stack WIRES the board-highlight overlay into its output graph
// and composites it AFTER the tonemap/grade (so the night auto-exposure swing never reaches it). The overlay is
// constructed INSIDE create_post_stack with no returned handle, and `window` is undefined under bun, so the
// only clean unit seam is a spy: mock.module replaces create_highlight_overlay with a spy that DELEGATES to the
// real implementation (the built node graph stays valid) while recording construction args + composite() call
// order relative to the scene grade. The grade runs at post_stack:~446, immediately after renderOutput()'s AgX
// at :~440 — so "grade before highlight.composite" ⇒ the highlight composites post-AgX. Red today: the overlay
// is absent from post_stack, so composite() is never called. Own file (a same-file mock would poison the
// real-routing suites in board_highlight_lighting.test.js). Pixel + exact-adjacency proof: the screenshot rider.

import { test, expect, describe, mock, afterAll } from 'bun:test'
import { Scene, PerspectiveCamera } from 'three'

import * as real_overlay from './board_highlight_overlay_pass.js'

// capture the REAL factory BEFORE mocking (so the spy can delegate without recursing into itself).
const REAL_create_highlight_overlay = real_overlay.create_highlight_overlay

/** @type {string[]} */
const call_order = []
/** @type {any} */
let construct_opts = null

const spy_create_highlight_overlay = (/** @type {any} */ opts) => {
  construct_opts = opts
  const handle = REAL_create_highlight_overlay(opts)
  const real_composite = handle.composite
  handle.composite = (/** @type {any} */ out) => {
    call_order.push('highlight.composite')
    return real_composite(out) // delegate — keep the real node graph valid
  }
  return handle
}

// register the spy BEFORE post_stack is imported so its static import binds to it. route_board_highlight_overlay
// and BOARD_HIGHLIGHT_LAYER are spread through UNCHANGED (the tactical routing stays real).
mock.module('./board_highlight_overlay_pass.js', () => ({
  ...real_overlay,
  create_highlight_overlay: spy_create_highlight_overlay,
}))
afterAll(() => mock.restore())

const { create_post_stack } = await import('./lighting/post_stack.js')

/** low-tier atmo double (no clouds/froxels/bloom passes); grade.apply RECORDS the post-AgX grade call. */
const atmo_double = () => ({
  config: { bloom: { strength: 0.1, radius: 0.6, threshold: 2.05 } },
  features: { clouds: false, froxels: false, bloom_off: true },
  grade: {
    apply: (/** @type {*} */ rgb) => {
      call_order.push('grade')
      return rgb
    },
  },
  froxels: { apply: (/** @type {*} */ c) => c },
  clouds: { cloud_layer: () => ({ color: [0, 0, 0], alpha: 0 }) },
  sun_direction: { value: { toArray: () => [0, 1, 0] } },
  sun_radiance: { value: { toArray: () => [1, 1, 1] } },
})

describe('post_stack wires the board-highlight overlay composite AFTER the tonemap/grade (②)', () => {
  test('overlay constructed with the main scene depth, and composite() runs AFTER the grade (⇒ post-AgX)', () => {
    call_order.length = 0
    construct_opts = null
    const ps = create_post_stack({
      renderer: {},
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      sun: null,
      atmo: atmo_double(),
      tier: 'low',
    })

    // WIRED: constructed with the shared scene + the main-pass depth (the occlusion-mask input).
    expect(construct_opts).toBeTruthy()
    expect(construct_opts.scene_depth).toBeDefined()

    // GRAPH ORDER: the grade (right after renderOutput()'s AgX in build_output) runs BEFORE the highlight
    // composite ⇒ highlights are composited in DISPLAY space, after the tonemap. Red today: no composite call.
    expect(call_order).toContain('grade')
    expect(call_order).toContain('highlight.composite')
    expect(call_order.indexOf('grade')).toBeLessThan(call_order.indexOf('highlight.composite'))

    ps.dispose()
  })
})
