// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2198 — character creation must survive a DEAD WebGL context. A player with GPU acceleration
// disabled (Chrome's "use hardware acceleration" off, a blocklisted driver, a headless/software
// profile) gets `null` back from `canvas.getContext('webgl2')`; three then THROWS out of the
// `new WebGLRenderer(...)` constructor. That throw used to escape `character_pedestal()` →
// `character_create()` → the create host's promise, uncaught (Sentry ARESRPG-APP-3G), and the whole
// front door died for the entire GPU-less cohort.
//
// The pedestal OWNS the context, so it owns the degradation: this drives the real
// `character_pedestal()` against a context factory that fails the two ways a real browser fails it
// (returns null / throws) and pins the contract — no escape, a FLAT handle whose methods are
// harmless no-ops, and exactly ONE report_error carrying the mechanical cause.
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'

import * as report from '../../../src/core/report.js'
import { character_pedestal } from '../../../src/game/screens/character-pedestal.js'
import { stage_mode } from '../../../src/game/screens/character-create.js'

/** A canvas whose GL context acquisition fails the way a GPU-less browser fails it. `calls` is the
 *  POSITIVE CONTROL: a stub nobody consulted would make every assertion below vacuous. */
const dead_canvas = (mode) => {
  const calls = []
  return {
    calls,
    canvas: {
      getContext(kind) {
        calls.push(kind)
        // Chrome with acceleration off returns null; a broken driver throws outright. Both ship here.
        if (mode === 'throw') throw new Error('Error creating WebGL context.')
        return null
      },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      getAttribute: () => null,
      style: {},
      clientWidth: 320,
      clientHeight: 420,
    },
  }
}

/** Flush microtasks so a rejection that nobody handled has actually been observed as unhandled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let unhandled = []
const track_unhandled = (reason) => unhandled.push(reason)
// Scoped to THIS file: a listener left installed would swallow every other suite's unhandled
// rejections in the shared runner process — a lying-green machine.
beforeAll(() => process.on('unhandledRejection', track_unhandled))
afterAll(() => process.off('unhandledRejection', track_unhandled))

afterEach(() => {
  unhandled = []
})

describe('#2198 — a dead WebGL context degrades the creator instead of killing it', () => {
  for (const mode of /** @type {const} */ (['null', 'throw'])) {
    test(`getContext ${mode === 'null' ? 'returns null' : 'throws'} → the pedestal comes back FLAT, never escaping`, async () => {
      const report_spy = spyOn(report, 'report_error').mockImplementation(() => {})
      const { canvas, calls } = dead_canvas(mode)

      // ① no escape — the mount sequence character_create() runs is: build, paint colors, rig a class.
      const pedestal = character_pedestal(canvas)
      expect(pedestal.degraded).toBe(true)
      pedestal.set_colors(['#ffffff', '#d9af57', '#8b6539'])
      await expect(pedestal.set_class('senshi', { male: true })).resolves.toBe(false)
      pedestal.destroy()
      await settle()
      expect(unhandled).toEqual([])

      // positive control — the failure came from the stubbed context factory, not from a missing global.
      expect(calls.length).toBeGreaterThan(0)

      // ③ exactly one report, with the mechanical cause preserved and the create area tagged.
      expect(report_spy).toHaveBeenCalledTimes(1)
      const [first_call] = report_spy.mock.calls
      const [reported, context] = first_call
      expect(context.area).toBe('create')
      expect(String(reported instanceof Error ? reported.message : reported)).toMatch(/WebGL/i)
      report_spy.mockRestore()
    })
  }

  // ② the flow stays completable: a flat pedestal renders the static class portrait — never the
  // "model soon" lie (the model is not coming), never a blank stage.
  test('a degraded context puts the stage on the static class portrait, whatever the model load says', () => {
    expect(stage_mode({ gl_degraded: true, model_loaded: false })).toBe('portrait')
    expect(stage_mode({ gl_degraded: true, model_loaded: true })).toBe('portrait')
    expect(stage_mode({ gl_degraded: false, model_loaded: true })).toBe('model')
    expect(stage_mode({ gl_degraded: false, model_loaded: false })).toBe('soon')
  })
})
