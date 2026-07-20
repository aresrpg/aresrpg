// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { apply_touch_camera } from './mobile_session_input.js'

describe('mobile session camera adapter', () => {
  it('maps right-drag pixels to the shoulder rig rotate seam and pinch spread to dolly distance', () => {
    const rotations = []
    const dollies = []
    const camera = {
      rotate: (dx, dy) => rotations.push([dx, dy]),
      dolly: (meters) => dollies.push(meters),
    }

    apply_touch_camera(camera, { dx: 12, dy: -4 }, 25)

    expect(rotations).toEqual([[18, -6]])
    expect(dollies).toEqual([-0.5])
  })

  it('does not wake either camera writer for a zero-delta frame', () => {
    let calls = 0
    const camera = {
      rotate: () => (calls += 1),
      dolly: () => (calls += 1),
    }

    apply_touch_camera(camera, { dx: 0, dy: 0 }, 0)
    expect(calls).toBe(0)
  })
})
