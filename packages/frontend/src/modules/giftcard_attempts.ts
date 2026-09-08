// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Durable browser intent, not chain claim state. Explicit retries bypass this automatic gate.

import type { AuthStorage } from '../auth_storage.ts'

/** An unavailable store disables automation for this observer's lifetime. */
export const create_claim_attempts = (storage: AuthStorage | null, network: string, kind: 'giftcard' | 'claim') => {
  let available = storage
  const key = (address: string, giftcard: string): string =>
    `aresrpg:${kind}-attempt:${network}:${address.toLowerCase()}:${giftcard.toLowerCase()}`
  return Object.freeze({
    has: (address: string, giftcard: string): boolean => {
      if (!available) return true
      try {
        return available.getItem(key(address, giftcard)) !== null
      } catch (error) {
        available = null
        console.error('Claim attempt storage is unreadable; automatic redemption is disabled.', error)
        return true
      }
    },
    remember: (address: string, giftcard: string): boolean => {
      if (!available) return false
      try {
        available.setItem(key(address, giftcard), '1')
        return true
      } catch (error) {
        available = null
        console.error('Claim attempt could not be retained; automatic redemption is disabled.', error)
        return false
      }
    },
  })
}

// Preserve deployed giftcard keys when sharing the same automatic-intent rule.
export const create_giftcard_attempts = (storage: AuthStorage | null, network: string) =>
  create_claim_attempts(storage, network, 'giftcard')
