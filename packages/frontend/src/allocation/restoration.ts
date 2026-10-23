// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AuthSession } from '../auth.ts'

/** Bound silent restoration; a late signer is disposed instead of entering a newer login. */
export const restore_allocation_wallet = async (
  restore: () => Promise<AuthSession | null>,
  timeout_ms = 10_000
): Promise<AuthSession | null> => {
  let expired = false
  let timer: ReturnType<typeof setTimeout>
  const started = performance.now()
  const pending = restore().then((wallet) => {
    if (!expired) return wallet
    wallet?.dispose?.()
    return null
  })
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true
          reject(new Error('restore_timeout'))
        }, timeout_ms)
      }),
    ])
  } finally {
    clearTimeout(timer!)
    performance.clearMeasures('allocation:restore')
    performance.measure('allocation:restore', { start: started, end: performance.now() })
  }
}
