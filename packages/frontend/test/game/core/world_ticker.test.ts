// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_world_ticker } from '../../../src/game/core/world_ticker.ts'

test('background frames preserve elapsed movement using bounded physics steps', () => {
  const steps: number[] = []
  const ticker = create_world_ticker({ now: () => 0, tick: (_at, delta) => steps.push(delta) })
  ticker.set_active(true, true)
  ticker.advance(1_000)
  expect(steps).toHaveLength(10)
  expect(steps.every((delta) => delta <= 0.1)).toBe(true)
  expect(steps.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(1)
  ticker.advance(1_000)
  expect(steps).toHaveLength(10)
  ticker.advance(61_000)
  expect(steps).toHaveLength(20)
  ticker.dispose()
  ticker.advance(62_000)
  expect(steps).toHaveLength(20)
})

test('ordinary frames retain the existing clamp and inactive time is never replayed', () => {
  let now = 0
  const steps: number[] = []
  const ticker = create_world_ticker({ now: () => now, tick: (_at, delta) => steps.push(delta) })
  ticker.set_active(true, false)
  ticker.advance(1_000)
  expect(steps).toEqual([0.1])
  ticker.set_active(false, false)
  ticker.advance(50_000)
  now = 50_000
  ticker.set_active(true, true)
  ticker.advance(50_050)
  expect(steps).toEqual([0.1, 0.05])
  ticker.dispose()
})
