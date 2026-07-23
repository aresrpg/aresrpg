// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { arm_projection_timer } from './use_projected_hp.js'

describe('arm_projection_timer — presentation-only exact-boundary wake-up', () => {
  test('arms for the absolute carried boundary, delivers one wake-up, and clears on cleanup', () => {
    const scheduled = []
    const cleared = []
    let ticks = 0
    const cleanup = arm_projection_timer(
      10_288,
      () => {
        ticks += 1
      },
      {
        now: () => 10_000,
        set_timeout: (callback, delay_ms) => {
          scheduled.push({ callback, delay_ms })
          return 617
        },
        clear_timeout: (timer) => cleared.push(timer),
      }
    )

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].delay_ms).toBe(288)
    scheduled[0].callback()
    expect(ticks).toBe(1)

    cleanup()
    expect(cleared).toEqual([617])
  })

  test('a capped projection arms no timer and cleanup stays inert', () => {
    let armed = 0
    const cleanup = arm_projection_timer(null, () => {}, {
      set_timeout: () => {
        armed += 1
        return 1
      },
    })

    expect(armed).toBe(0)
    expect(cleanup()).toBeUndefined()
  })
})
