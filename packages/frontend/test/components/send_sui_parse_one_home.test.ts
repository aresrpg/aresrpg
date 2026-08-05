// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1368 — decimal SUI becomes MIST in utils/sui_mist.ts only. This is the MAX-send money path: conversion
// parity must include both an ordinary decimal and a balance whose final MIST cannot be rounded away.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { parse_send_amount } from '../../src/components/send_sui_amount'
import { format_sui_exact, parse_sui_decimal } from '../../src/utils/sui_mist'

const source = readFileSync(new URL('../../src/components/send_sui_amount.ts', import.meta.url), 'utf8')

describe('decimal SUI parsing has one money home', () => {
  test('1.5 SUI has the identical MIST value at the home and at the send policy', () => {
    const mist = parse_sui_decimal('1.5')

    expect(mist).toBe(1_500_000_000n)
    expect(parse_send_amount('1.5', 2_000_000_000n)).toEqual({ mist, error: null })
  })

  test('MAX preserves and reparses an odd final MIST through that same home', () => {
    const balance_mist = 1_234_567_891n
    const max_input = format_sui_exact(balance_mist)
    const mist = parse_sui_decimal(max_input)

    expect(max_input).toBe('1.234567891')
    expect(mist).toBe(balance_mist)
    expect(parse_send_amount(max_input, balance_mist)).toEqual({ mist, error: null })
  })

  test('the send policy delegates conversion instead of carrying a second parser', () => {
    expect(source).toContain("import { parse_sui_decimal } from '../utils/sui_mist'")
    expect(source).not.toContain('MIST_PER_SUI')
    expect(source).not.toContain('PARSABLE_RE')
    expect(source).not.toContain('padEnd(9')
  })
})
