// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { point_removal_chance } from '../src/fight_math.ts'

test('the content dodge baseline uses the exact full-pool wisdom contest', () => {
  expect(point_removal_chance({ caster_wisdom: 0n, target_wisdom: 0n, current: 1n, maximum: 1n })).toBe(50n)
  expect(point_removal_chance({ caster_wisdom: 0n, target_wisdom: 30n, current: 1n, maximum: 1n })).toBe(16n)
  expect(point_removal_chance({ caster_wisdom: 0n, target_wisdom: 80n, current: 1n, maximum: 1n })).toBe(10n)
})
