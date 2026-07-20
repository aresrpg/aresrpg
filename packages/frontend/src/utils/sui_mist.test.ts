// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Critical cases for sui_mist.ts — backend has the exhaustive suite; these are
// the cases most likely to break under frontend-side input (commas, leading
// spaces, scientific notation, boundary values, fee identity).
//
// Run with: bun test packages/frontend/src/utils/sui_mist.test.ts

import { describe, test, expect } from 'bun:test'

import {
  MIST_PER_SUI,
  MIN_MIST,
  MAX_MIST,
  GAS_BUDGET_MIST,
  parse_mist_string,
  parse_2_decimal_sui,
  parse_pledge_sui,
  assert_valid_net_price,
  assert_valid_pledge,
  display_from_net,
  seller_share,
  fee_share,
  assert_fee_math_holds,
  format_mist_to_sui,
} from './sui_mist'

describe('constants', () => {
  test('constants match backend exactly', () => {
    expect(MIST_PER_SUI).toBe(1_000_000_000n)
    expect(MIN_MIST).toBe(10_000_000n)
    expect(MAX_MIST).toBe(100_000_000_000_000n)
    expect(GAS_BUDGET_MIST).toBe(50_000_000n)
  })
})

describe('parse_mist_string — critical rejections', () => {
  test('rejects hex (would silently return 256n via raw BigInt)', () => {
    expect(() => parse_mist_string('0x100')).toThrow('INVALID_MIST')
  })
  test('rejects negative', () => {
    expect(() => parse_mist_string('-1')).toThrow('INVALID_MIST')
  })
  test('rejects scientific notation', () => {
    expect(() => parse_mist_string('1e9')).toThrow('INVALID_MIST')
  })
  test('accepts plain integer', () => {
    expect(parse_mist_string('10000000')).toBe(10_000_000n)
  })
})

describe('parse_2_decimal_sui — user input', () => {
  test('accepts min ("0.01")', () => {
    expect(parse_2_decimal_sui('0.01')).toBe(10_000_000n)
  })
  test('accepts max ("100000")', () => {
    expect(parse_2_decimal_sui('100000')).toBe(100_000_000_000_000n)
  })
  test('accepts integer SUI ("100")', () => {
    expect(parse_2_decimal_sui('100')).toBe(100_000_000_000n)
  })
  test('rejects 3 decimals ("0.001")', () => {
    expect(() => parse_2_decimal_sui('0.001')).toThrow('INVALID_FORMAT')
  })
  test('rejects below min ("0.00")', () => {
    expect(() => parse_2_decimal_sui('0.00')).toThrow('BELOW_MIN')
  })
  test('rejects above max ("100000.01")', () => {
    expect(() => parse_2_decimal_sui('100000.01')).toThrow('ABOVE_MAX')
  })
  test('rejects negative ("-1")', () => {
    expect(() => parse_2_decimal_sui('-1')).toThrow('INVALID_FORMAT')
  })
  test('rejects letters ("abc")', () => {
    expect(() => parse_2_decimal_sui('abc')).toThrow('INVALID_FORMAT')
  })
  test('rejects trailing dot ("1.")', () => {
    expect(() => parse_2_decimal_sui('1.')).toThrow('INVALID_FORMAT')
  })
  test('rejects leading dot (".5")', () => {
    expect(() => parse_2_decimal_sui('.5')).toThrow('INVALID_FORMAT')
  })
  test('rejects comma — caller must normalize upstream', () => {
    expect(() => parse_2_decimal_sui('1,5')).toThrow('INVALID_FORMAT')
  })
})

describe('parse_pledge_sui — kolizeum pledges (zero valid, no marketplace floor)', () => {
  test('accepts zero ("0") — the old parser rejects the same input', () => {
    expect(parse_pledge_sui('0')).toBe(0n)
    expect(() => parse_2_decimal_sui('0')).toThrow('BELOW_MIN')
  })
  test('accepts zero with decimals ("0.00") — the old parser rejects the same input', () => {
    expect(parse_pledge_sui('0.00')).toBe(0n)
    expect(() => parse_2_decimal_sui('0.00')).toThrow('BELOW_MIN')
  })
  test('accepts a normal mid-range value ("0.5")', () => {
    expect(parse_pledge_sui('0.5')).toBe(500_000_000n)
  })
  test('accepts max ("100000")', () => {
    expect(parse_pledge_sui('100000')).toBe(100_000_000_000_000n)
  })
  test('rejects above max ("100000.01")', () => {
    expect(() => parse_pledge_sui('100000.01')).toThrow('ABOVE_MAX')
  })
  test('rejects negative ("-1")', () => {
    expect(() => parse_pledge_sui('-1')).toThrow('INVALID_FORMAT')
  })
  test('rejects 3 decimals ("0.001")', () => {
    expect(() => parse_pledge_sui('0.001')).toThrow('INVALID_FORMAT')
  })
  test('rejects non-strings', () => {
    expect(() => parse_pledge_sui(0 as unknown as string)).toThrow('INVALID_FORMAT')
  })
})

describe('fee math — identity + examples', () => {
  // Spec example: net = 100 SUI (100_000_000_000 MIST)
  //   display = 100 * 21 / 20 = 105 SUI
  //   seller  = 100 * 19 / 20 = 95 SUI
  //   fee     = 100 / 10      = 10 SUI
  //   seller + fee = 105 = display
  test('net=100 SUI → display=105 / seller=95 / fee=10', () => {
    const net = parse_2_decimal_sui('100')
    expect(display_from_net(net)).toBe(105_000_000_000n)
    expect(seller_share(net)).toBe(95_000_000_000n)
    expect(fee_share(net)).toBe(10_000_000_000n)
  })

  test('identity holds at minimum (0.01 SUI)', () => {
    expect(() => assert_fee_math_holds(MIN_MIST)).not.toThrow()
  })

  test('identity holds at maximum (100000 SUI)', () => {
    expect(() => assert_fee_math_holds(MAX_MIST)).not.toThrow()
  })
})

describe('format_mist_to_sui — floors, never rounds up', () => {
  test('zero, 9 decimals', () => {
    expect(format_mist_to_sui(0n, 9)).toBe('0.000000000')
  })
  test('1 MIST at 2 decimals floors to 0.00 (not 0.01)', () => {
    expect(format_mist_to_sui(1n, 2)).toBe('0.00')
  })
  test('0.0105 SUI at 2 decimals floors to 0.01', () => {
    expect(format_mist_to_sui(10_500_000n, 2)).toBe('0.01')
  })
  test('0.105 SUI at 2 decimals floors to 0.10', () => {
    expect(format_mist_to_sui(105_000_000n, 2)).toBe('0.10')
  })
  test('1 SUI at 2 decimals', () => {
    expect(format_mist_to_sui(1_000_000_000n, 2)).toBe('1.00')
  })
  test('100000 SUI at 2 decimals', () => {
    expect(format_mist_to_sui(100_000_000_000_000n, 2)).toBe('100000.00')
  })
})

describe('assert_valid_net_price', () => {
  test('rejects non-bigint (number)', () => {
    expect(() => assert_valid_net_price(1_000_000 as unknown as bigint)).toThrow('INVALID_FORMAT')
  })
  test('rejects below MIN_MIST', () => {
    expect(() => assert_valid_net_price(MIN_MIST - 1n)).toThrow('BELOW_MIN')
  })
  test('rejects above MAX_MIST', () => {
    expect(() => assert_valid_net_price(MAX_MIST + 1n)).toThrow('ABOVE_MAX')
  })
})

describe('assert_valid_pledge — zero valid, no floor, no %20', () => {
  test('accepts zero (unlike assert_valid_net_price)', () => {
    expect(() => assert_valid_pledge(0n)).not.toThrow()
    expect(() => assert_valid_net_price(0n)).toThrow('BELOW_MIN')
  })
  test('accepts a value not divisible by 20 (unlike assert_valid_net_price)', () => {
    expect(() => assert_valid_pledge(7n)).not.toThrow()
  })
  test('rejects non-bigint (number)', () => {
    expect(() => assert_valid_pledge(0 as unknown as bigint)).toThrow('INVALID_FORMAT')
  })
  test('rejects above MAX_MIST', () => {
    expect(() => assert_valid_pledge(MAX_MIST + 1n)).toThrow('ABOVE_MAX')
  })
  test('accepts exactly MAX_MIST', () => {
    expect(() => assert_valid_pledge(MAX_MIST)).not.toThrow()
  })
})
