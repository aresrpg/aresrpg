// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { fight_sword_frame, fight_swords_visible } from '../src/fight_swords.ts'

test('every sword plays the legacy grow, spinning fall, impact, then placement sink', () => {
  const born_late = fight_sword_frame(10_000, 30_000, 30_000)
  expect(born_late).toMatchObject({ height: 10, scale: 0.1, yaw: 0, impacted: false })

  const grown = fight_sword_frame(10_000, 30_000, 30_500)
  expect(grown.height).toBe(10)
  expect(grown.scale).toBe(2.5)

  const falling = fight_sword_frame(10_000, 30_000, 31_250)
  expect(falling.height).toBeLessThan(10)
  expect(falling.yaw).toBeGreaterThan(0)
  expect(falling.impacted).toBeFalse()

  const planted = fight_sword_frame(10_000, 30_000, 32_000)
  expect(planted).toMatchObject({ scale: 2.5, impacted: true })
  expect(fight_sword_frame(10_000, 30_000, 50_000).height).toBeLessThan(planted.height)
})

test('a mounted board hides every world sword', () => {
  expect(fight_swords_visible(false)).toBeTrue()
  expect(fight_swords_visible(true)).toBeFalse()
})
