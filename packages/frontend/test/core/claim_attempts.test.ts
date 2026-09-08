// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_claim_attempts, create_giftcard_attempts } from '../../src/modules/giftcard_attempts.ts'

test('giftcard keys remain deployed-compatible while generic claims retain their own account/network scope', () => {
  const values = new Map([['aresrpg:giftcard-attempt:testnet:0xab:0xcd', '1']])
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
  expect(create_giftcard_attempts(storage, 'testnet').has('0xAB', '0xCD')).toBeTrue()
  const claims = create_claim_attempts(storage, 'testnet', 'claim')
  expect(claims.has('0xAB', '0xCD')).toBeFalse()
  expect(claims.remember('0xAB', '0xCD')).toBeTrue()
  expect(create_claim_attempts(storage, 'testnet', 'claim').has('0xab', '0xcd')).toBeTrue()
  expect(claims.has('0xef', '0xcd')).toBeFalse()
  expect(create_claim_attempts(storage, 'mainnet', 'claim').has('0xab', '0xcd')).toBeFalse()
})

test('failed persistence cannot reopen automation on a later pass', () => {
  let writes = 0
  const attempts = create_claim_attempts(
    {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        writes++
        throw new Error('storage full')
      },
    },
    'testnet',
    'claim'
  )
  expect(attempts.has('0xa', '0xb')).toBeFalse()
  expect(attempts.remember('0xa', '0xb')).toBeFalse()
  expect(attempts.has('0xa', '0xb')).toBeTrue()
  expect(attempts.remember('0xa', '0xb')).toBeFalse()
  expect(writes).toBe(1)
})
