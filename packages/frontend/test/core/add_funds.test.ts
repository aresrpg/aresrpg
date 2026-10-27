// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { SUI_FAUCET_URL, add_funds_surface } from '../../src/components/AddFundsModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

describe('add funds methods', () => {
  test('testnet replaces payment providers with the official Sui faucet', () => {
    expect(add_funds_surface('testnet')).toBe('faucet')
    expect(add_funds_surface('mainnet')).toBe('providers')
    expect(SUI_FAUCET_URL).toBe('https://faucet.sui.io/')
  })

  test('funding uses game balance and explains manual retry', async () => {
    const copy = await load_app_copy('en')
    expect(copy.wallet_legacy.funding_available).toBe('Game balance')
    expect(copy.wallet_legacy.funding_delivered_hint).toContain('retry your game action')
  })
})
