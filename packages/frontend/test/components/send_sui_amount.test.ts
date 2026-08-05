// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2243 — the send form's amount policy after the cap died. RED-FIRST target: every row below marked
// "formerly refused" fails against the pre-#2243 rules (balance − 0.2 SUI ceiling, 0.01 SUI floor, 2-decimal
// input), and the honest refusals are the only ones left.
import { describe, expect, test } from 'bun:test'

import { is_typable_amount, parse_send_amount } from '../../src/components/send_sui_amount'
import { format_sui_exact } from '../../src/utils/sui_mist'

const SUI = 1_000_000_000n
const BALANCE = 3n * SUI // 3 SUI

describe('parse_send_amount — the artificial caps are GONE', () => {
  test('formerly refused: the entire balance, with no 0.2 SUI reserve withheld', () => {
    expect(parse_send_amount('3', BALANCE)).toEqual({ mist: 3n * SUI, error: null })
  })

  test('formerly refused: balance minus a hair — anything inside the old 0.2 SUI reserve band', () => {
    expect(parse_send_amount('2.9', BALANCE)).toEqual({ mist: 2_900_000_000n, error: null })
  })

  test('formerly refused: below the 0.01 SUI marketplace floor (a transfer is never split into fee shares)', () => {
    expect(parse_send_amount('0.001', BALANCE)).toEqual({ mist: 1_000_000n, error: null })
  })

  test('formerly refused: a single MIST — full 9-decimal chain precision', () => {
    expect(parse_send_amount('0.000000001', BALANCE)).toEqual({ mist: 1n, error: null })
    expect(is_typable_amount('0.000000001')).toBe(true)
  })

  test('formerly refused: 3+ decimals are typable (the field used to swallow the keystroke)', () => {
    expect(is_typable_amount('1.234')).toBe(true)
    expect(is_typable_amount('1.23456789')).toBe(true)
  })

  test('nothing beyond MIST precision is typable — that is the chain unit, not a house rule', () => {
    expect(is_typable_amount('1.0000000001')).toBe(false)
    expect(is_typable_amount('1.2.3')).toBe(false)
    expect(is_typable_amount('-1')).toBe(false)
  })
})

describe('parse_send_amount — the honest refusals that remain', () => {
  test('an empty / half-typed field is not an error, just not an amount yet', () => {
    expect(parse_send_amount('', BALANCE)).toEqual({ mist: null, error: null })
    expect(parse_send_amount('.', BALANCE)).toEqual({ mist: null, error: null })
  })

  test('zero is refused — a send must move something', () => {
    expect(parse_send_amount('0', BALANCE).error).toBe('amount_positive')
    expect(parse_send_amount('0.000000000', BALANCE).error).toBe('amount_positive')
  })

  test('more than the wallet holds is refused, at exactly one MIST over', () => {
    expect(parse_send_amount('3.000000001', BALANCE).error).toBe('insufficient_balance')
    expect(parse_send_amount('3.000000000', BALANCE).error).toBe(null)
  })

  test('an unread balance never invents a refusal', () => {
    expect(parse_send_amount('999999', null)).toEqual({ mist: 999_999n * SUI, error: null })
  })

  test('garbage is refused as invalid rather than parsed into a wrong number', () => {
    expect(parse_send_amount('1e9', BALANCE)).toEqual({ mist: null, error: 'amount_invalid' })
    expect(parse_send_amount('0x10', BALANCE)).toEqual({ mist: null, error: 'amount_invalid' })
  })
})

// format_sui_exact moved to its canonical money home (utils/sui_mist.ts) and became BigInt-only in the same
// change; the two rows below are red against the `Number(mist)/1e9` version it replaced.
describe('format_sui_exact — MAX shows the WHOLE balance, never a floored one', () => {
  test('full MIST precision, trailing zeros trimmed', () => {
    expect(format_sui_exact(3n * SUI)).toBe('3')
    expect(format_sui_exact(2_900_000_000n)).toBe('2.9')
  })

  test('a near-empty wallet renders as digits, never exponent notation the field would reject', () => {
    expect(format_sui_exact(1n)).toBe('0.000000001')
    expect(format_sui_exact(12_345n)).toBe('0.000012345')
  })

  test('a balance past 2^53 MIST keeps every digit — no float rounding in a money figure', () => {
    expect(format_sui_exact(90_071_992_547_409_931n)).toBe('90071992.547409931')
  })

  test('the odd MIST tail the old 0.01-SUI floor used to shave off survives', () => {
    expect(format_sui_exact(1_234_567_891n)).toBe('1.234567891')
  })

  test('what MAX writes always parses back clean against that same balance', () => {
    for (const balance of [1n, 12_345n, 2_900_000_000n, 1_234_567_891n, 90_071_992_547_409_931n]) {
      expect(parse_send_amount(format_sui_exact(balance), balance)).toEqual({
        mist: balance,
        error: null,
      })
    }
  })
})
