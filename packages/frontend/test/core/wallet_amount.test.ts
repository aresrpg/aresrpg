// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { format_sui, parse_sui_amount } from '../../src/wallet_amount.ts'

describe('wallet amounts', () => {
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
  })
})
