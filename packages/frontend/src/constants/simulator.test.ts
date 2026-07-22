// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { compute_health_regen } from './simulator'

describe('simulator natural HP regeneration', () => {
  test('mirrors the live level-only kernel instead of deriving a Wisdom bonus', () => {
    expect(compute_health_regen.length).toBe(1)
    expect(compute_health_regen(1)).toBe(2.08)
    expect(compute_health_regen(10)).toBe(2.8)
  })
})
