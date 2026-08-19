// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { fight_float_frame, fight_float_text } from '../src/fight_floats.ts'

test('combat floats use signed semantic text', () => {
  expect(fight_float_text(12, 'damage')).toBe('−12')
  // ap/mp amounts are SIGNED deltas: losses read minus, gains (a steal's drink) read plus
  expect(fight_float_text(-3, 'mp')).toBe('−3')
  expect(fight_float_text(-2, 'ap')).toBe('−2')
  expect(fight_float_text(3, 'mp')).toBe('+3')
  expect(fight_float_text(2, 'ap')).toBe('+2')
  expect(fight_float_text(8, 'heal')).toBe('+8')
})

test('combat floats wait for impact, pop, rise, and expire', () => {
  expect(fight_float_frame(219, 'damage').visible).toBeFalse()
  expect(fight_float_frame(280, 'damage').scale).toBeGreaterThan(1)
  expect(fight_float_frame(700, 'damage').y).toBeGreaterThan(0)
  expect(fight_float_frame(1_120, 'damage').visible).toBeFalse()
  expect(fight_float_frame(280, 'critical').scale).toBeGreaterThan(fight_float_frame(280, 'damage').scale)
})
