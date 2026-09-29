// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { ADD_FUNDS_PAYMENT_METHODS, SUI_FAUCET_URL, add_funds_surface } from '../../src/components/AddFundsModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

describe('add funds methods', () => {
  test('testnet replaces payment providers with the official Sui faucet', () => {
    expect(add_funds_surface('testnet')).toBe('faucet')
    expect(add_funds_surface('mainnet')).toBe('providers')
    expect(SUI_FAUCET_URL).toBe('https://faucet.sui.io/')
  })

  test('funding has three choices with an embedded LI.FI bridge', async () => {
    const copy = await load_app_copy('en')

    expect(ADD_FUNDS_PAYMENT_METHODS.map(({ key }) => key)).toEqual(['direct', 'bridge', 'card'])
    expect(copy.wallet_legacy.method_swap).toBe('Bridge deposit')
    expect(copy.wallet_legacy.swap_note).toContain('LI.FI')
  })
})
