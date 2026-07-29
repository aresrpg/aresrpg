// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1563 second-order gate: A CAUGHT CRASH IS STILL A CRASH. The app's error boundary used to answer a
// total client death with a bare Sentry.captureException — no console line, no component stack — so the
// fight-board TDZ took the whole HUD down with ZERO signal in dev, in a driven session, or in any monitor
// watching console errors. componentDidCatch now routes through report_boundary_error (core/report.js),
// and this pins both halves of "loud": the local console line and the structured report context.
//
// No Sentry is armed here (init_reporting is process-global state — arming it would leak into
// src/core/report.test.js, whose first assertion is that reporting is NOT live). The reporting leg is
// asserted through the PURE context builder that report_boundary_error hands to the choke; the choke's
// own envelope behaviour is already proven in src/core/report.test.js.
import { afterEach, describe, expect, test } from 'bun:test'

import { boundary_context, report_boundary_error } from '../../src/core/report.js'

const real_console_error = console.error

afterEach(() => {
  console.error = real_console_error
})

describe('a boundary-caught crash is loud', () => {
  test('report_boundary_error prints the error AND the component stack to the console', () => {
    /** @type {any[][]} */
    const calls = []
    console.error = (...args) => calls.push(args)

    const boom = new Error('Cannot access XYZ before initialization')
    report_boundary_error(boom, '\n    at DungeonBoard (DungeonBoard.jsx:340)')

    expect(calls.length).toBe(1)
    expect(calls[0].some((a) => a === boom)).toBe(true) // the ERROR OBJECT, not a stringified summary
    expect(calls[0].some((a) => typeof a === 'string' && /DungeonBoard/.test(a))).toBe(true)
  })

  test('the reported context flags an uncaught error-boundary capture and carries the component stack', () => {
    expect(boundary_context('\n    at DungeonBoard')).toEqual({
      area: 'error_boundary',
      uncaught: true,
      component_stack: '\n    at DungeonBoard',
    })
    // React can hand a null componentStack — the context stays well-formed, never undefined-shaped.
    expect(boundary_context(undefined).component_stack).toBe(null)
  })

  test('reporting never throws when Sentry is not armed (a dead boundary must not die twice)', () => {
    console.error = () => {}
    expect(() => report_boundary_error(new Error('unarmed'), null)).not.toThrow()
  })
})
