// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { classify_wallet_recipient } from '../../src/wallet_recipient.ts'

const address = `0x${'1'.repeat(64)}`

describe('wallet recipient classification', () => {
  test('keeps raw addresses, SuiNS, and Ares names mutually exclusive', () => {
    expect(classify_wallet_recipient(address)).toEqual({ kind: 'address', value: address })
    expect(classify_wallet_recipient('@Aiden')).toEqual({ kind: 'suins', value: '@Aiden' })
    expect(classify_wallet_recipient('vault@aresrpg')).toEqual({ kind: 'suins', value: 'vault@aresrpg' })
    expect(classify_wallet_recipient('aiden.sui')).toEqual({ kind: 'suins', value: 'aiden.sui' })
    expect(classify_wallet_recipient('Aiden')).toEqual({ kind: 'character', value: 'Aiden' })
  })

  test('does not send incomplete or malformed input to a resolver', () => {
    expect(classify_wallet_recipient('0x123')).toEqual({ kind: 'invalid_address', value: '0x123' })
    expect(classify_wallet_recipient('abc')).toEqual({ kind: 'idle', value: 'abc' })
  })
})
