// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { explorer_object_url, explorer_transaction_url } from '../../src/explorer.ts'

describe('Suivision links', () => {
  test('points at the NFT object on the configured network', () => {
    expect(explorer_object_url('testnet', '0xitem')).toBe('https://testnet.suivision.xyz/object/0xitem')
    expect(explorer_object_url('mainnet', '0xitem')).toBe('https://suivision.xyz/object/0xitem')
  })

  test('keeps transaction links on the same network rule', () => {
    expect(explorer_transaction_url('testnet', 'digest')).toBe('https://testnet.suivision.xyz/txblock/digest')
  })
})
