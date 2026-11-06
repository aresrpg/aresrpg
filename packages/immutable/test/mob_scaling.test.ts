// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { mob_loot_chance_scaled } from '../src/mob_scaling.ts'

// Pinned integer answers from move-math/sources/fight_math.move::mob_loot_chance_scaled.
// Expectations are independent of the TypeScript implementation, including truncation and cap.
test.each([
  [2n, 10n, 20n, 10n, 1n],
  [2n, 10n, 20n, 15n, 2n],
  [2n, 10n, 20n, 20n, 2n],
  [1n, 10n, 20n, 10n, 0n],
  [5_000n, 10n, 20n, 15n, 5_000n],
  [9_000n, 10n, 20n, 20n, 10_000n],
  [2n, 10n, 10n, 10n, 2n],
])('Move loot parity: %s bp over %s–%s at %s resolves to %s', (base, low, high, level, expected) => {
  expect(mob_loot_chance_scaled(base, low, high, level)).toBe(expected)
})
