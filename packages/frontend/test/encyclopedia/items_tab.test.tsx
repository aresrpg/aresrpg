// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { loot_box_is_random } from '../../src/encyclopedia/loot_box.ts'

describe('encyclopedia consumable rewards', () => {
  test('only a single positive-weight outcome is guaranteed', () => {
    const cases: readonly { why: string; weights: readonly { weight: number }[]; random: boolean }[] = [
      { why: 'one positive-weight outcome is guaranteed', weights: [{ weight: 1 }], random: false },
      { why: 'competing outcomes are random', weights: [{ weight: 100 }, { weight: 1 }], random: true },
      { why: 'an invalid zero-weight outcome is never guaranteed', weights: [{ weight: 0 }], random: true },
    ]

    cases.forEach(({ why, weights, random }) => {
      expect(loot_box_is_random(weights), why).toBe(random)
    })
  })
})
