// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { clear_auth_wallet, read_auth_wallet, remember_auth_wallet, type AuthStorage } from '../../src/auth_storage.ts'

const create_storage = (): AuthStorage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

describe('remembered authentication', () => {
  test('stores only the wallet identity needed for provider restoration', () => {
    const storage = create_storage()
    remember_auth_wallet(storage, 'Enoki Google')
    expect(read_auth_wallet(storage)).toBe('Enoki Google')
    clear_auth_wallet(storage)
    expect(read_auth_wallet(storage)).toBeNull()
  })

  test('unavailable browser storage degrades to a logged-out session', () => {
    const unavailable: AuthStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(read_auth_wallet(unavailable)).toBeNull()
    expect(() => remember_auth_wallet(unavailable, 'wallet')).not.toThrow()
    expect(() => clear_auth_wallet(unavailable)).not.toThrow()
  })
})
