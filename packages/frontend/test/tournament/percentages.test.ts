// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { parse_prize_percentages, prize_percentage_balance } from '../../src/tournament/percentages.ts'

test('decimal percentages become exact integers without a floating-point sum', () => {
  expect(parse_prize_percentages(['0.14', '12.34', '23.45', '34.56', '29.51'])).toEqual([14, 1234, 2345, 3456, 2951])
  expect(parse_prize_percentages(['.14', '99.86', '0', '0', '0'])).toEqual([14, 9986, 0, 0, 0])
  expect(parse_prize_percentages(['100.00', '0', '0', '0', '0'])).toEqual([10000, 0, 0, 0, 0])
})

test('precision, bounds, incomplete input and incorrect totals are rejected rather than rounded', () => {
  for (const value of ['', '0.', '-1', '100.01', '0.140', '1e2', 'Infinity', 'NaN']) {
    expect(parse_prize_percentages([value, '0', '0', '0', '0'])).toBeNull()
  }
  expect(parse_prize_percentages(['99.99', '0', '0', '0', '0'])).toBeNull()
  expect(parse_prize_percentages(['100', '0', '0', '0'])).toBeNull()
  expect(parse_prize_percentages(['100', '0', '0', '0', '0', '0'])).toBeNull()
})

test('allocation feedback uses exact basis points and distinguishes invalid input from excess', () => {
  expect(prize_percentage_balance(['0.14', '12.34', '23.45', '34.56', '29.51'])).toBe(0)
  expect(prize_percentage_balance(['60', '25', '10', '5.01', '0'])).toBe(-1)
  expect(prize_percentage_balance(['60', '25', '10', '4.99', '0'])).toBe(1)
  expect(prize_percentage_balance(['60', '25', '10', '4.', '0'])).toBeNull()
})
