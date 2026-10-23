// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import type { AuthSession } from '../../src/auth.ts'
import { restore_allocation_wallet } from '../../src/allocation/restoration.ts'

test('silent restoration times out and disposes a signer arriving after timeout', async () => {
  let resolve!: (session: AuthSession) => void
  let disposed = false
  const pending = new Promise<AuthSession>((done) => {
    resolve = done
  })
  await expect(restore_allocation_wallet(() => pending, 1)).rejects.toThrow('restore_timeout')
  resolve({
    dispose: () => {
      disposed = true
    },
  } as AuthSession)
  await Promise.resolve()
  expect(disposed).toBe(true)
})
test('successful restoration preserves the usable signer', async () => {
  let disposed = false
  const session = {
    dispose: () => {
      disposed = true
    },
  } as AuthSession
  expect(await restore_allocation_wallet(async () => session)).toBe(session)
  expect(disposed).toBe(false)
})
