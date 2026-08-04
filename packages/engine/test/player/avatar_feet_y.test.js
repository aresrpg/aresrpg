// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { avatar_feet_y } from '../../src/player/controller.js'

describe('avatar_feet_y', () => {
  test('presence uses the same step-smoothed feet anchor as the local avatar, not the physics origin', () => {
    const transform = { position: [4, 65, 9], visual_y: 64.375 }

    expect(avatar_feet_y(transform)).toBe(64.375)
    expect(avatar_feet_y(transform)).not.toBe(transform.position[1])
    expect(avatar_feet_y(transform)).not.toBe(Math.floor(transform.position[1]))
  })
})
