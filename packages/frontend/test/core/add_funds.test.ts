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

  test('the former crypto swap routes through Portal Bridge', async () => {
    const bridge = ADD_FUNDS_PAYMENT_METHODS.find(({ key }) => key === 'swap_crypto')
    const copy = await load_app_copy('en')

    expect(bridge?.providers).toEqual([{ name: 'Portal Bridge', url: 'https://portalbridge.com/' }])
    expect(copy.wallet_legacy.method_swap).toBe('From Solana, ETH, and more..')
    expect(
      ADD_FUNDS_PAYMENT_METHODS.flatMap(({ providers }) => providers).some(({ name }) => name === 'ChangeNOW')
    ).toBeFalse()
  })
})
