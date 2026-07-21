// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { validate_item_send_dialog } from './item_send_validation'

const address = `0x${'a'.repeat(64)}`

describe('item SEND dialog validation', () => {
  test.each([address, 'alice.sui', '@alice', 'vault@alice'])('accepts an address or SuiNS target: %s', (recipient) => {
    expect(
      validate_item_send_dialog({
        recipient,
        amount: '1',
        available_amount: 1,
        stackable: false,
      })
    ).toEqual({ valid: true, amount: 1n, recipient_error: null, amount_error: null })
  })

  test.each(['', 'alice', '0x1234', `0x${'z'.repeat(64)}`])('rejects a target outside address/SuiNS forms: %s', (recipient) => {
    const result = validate_item_send_dialog({
      recipient,
      amount: '1',
      available_amount: 1,
      stackable: false,
    })

    expect(result.valid).toBe(false)
    expect(result.recipient_error).toBe('recipient_invalid')
  })

  test.each(['', '0', '-1', '1.5', '1e2', 'abc'])('rejects a non-positive-integer stack amount: %s', (amount) => {
    const result = validate_item_send_dialog({
      recipient: address,
      amount,
      available_amount: 25,
      stackable: true,
    })

    expect(result.valid).toBe(false)
    expect(result.amount_error).toBe('amount_invalid')
  })

  test('rejects more units than the stack owns', () => {
    expect(
      validate_item_send_dialog({
        recipient: address,
        amount: '26',
        available_amount: 25,
        stackable: true,
      })
    ).toEqual({ valid: false, amount: 26n, recipient_error: null, amount_error: 'amount_exceeds_available' })
  })

  test('accepts the exact available stack amount and normalizes whitespace', () => {
    expect(
      validate_item_send_dialog({
        recipient: `  ${address}  `,
        amount: ' 25 ',
        available_amount: 25,
        stackable: true,
      })
    ).toEqual({ valid: true, amount: 25n, recipient_error: null, amount_error: null })
  })

  test('non-stackables are always exactly one object', () => {
    const result = validate_item_send_dialog({
      recipient: address,
      amount: '2',
      available_amount: 1,
      stackable: false,
    })

    expect(result.valid).toBe(false)
    expect(result.amount_error).toBe('amount_non_stackable')
  })
})
