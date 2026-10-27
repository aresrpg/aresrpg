// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { format_sui, format_token, parse_sui_amount } from '../../src/wallet_amount.ts'

describe('wallet amounts', () => {
  test('token display keeps six significant digits instead of raw base units', () => {
    expect(format_token(4_687_123_001_203_636n, 18)).toBe('0.00468712')
    expect(format_token(789_590_049_949_647n, 18)).toBe('0.00078959')
    expect(format_token(48_200_000n, 6)).toBe('48.2')
    expect(format_token(1_234_567_890n, 6)).toBe('1234.56')
    expect(format_token(0n, 9)).toBe('0')
    expect(format_token(5n, 0)).toBe('5')
  })

  test('parses exact SUI decimals without floating point', () => {
    expect(parse_sui_amount('1.25')).toBe(1_250_000_000n)
    expect(parse_sui_amount('0.000000001')).toBe(1n)
  })

  test('refuses zero, negative, excess precision, and exponent notation', () => {
    expect(parse_sui_amount('0')).toBeNull()
    expect(parse_sui_amount('-1')).toBeNull()
    expect(parse_sui_amount('0.0000000001')).toBeNull()
    expect(parse_sui_amount('1e2')).toBeNull()
  })

  test('formats MIST as stable fixed precision SUI', () => {
    expect(format_sui(1_234_567_890n, 2)).toBe('1.23')
    expect(format_sui(20_000_000n, 4)).toBe('0.0200')
    expect(format_sui(-20_000_000n, 4)).toBe('-0.0200')
  })
})
