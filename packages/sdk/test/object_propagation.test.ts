// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { retry_object_propagation } from '../src/character_actions.ts'

test('a newly projected object retries before signing, but an executed failure never retries', async () => {
  let attempts = 0
  const waits: number[] = []
  const resolved = await retry_object_propagation(
    async () => {
      attempts += 1
      if (attempts < 3) throw new Error('Object 0xclaim not found')
      return 'ready'
    },
    async (delay) => void waits.push(delay)
  )
  expect(resolved).toBe('ready')
  expect(attempts).toBe(3)
  expect(waits).toEqual([500, 1_000])

  let executed_attempts = 0
  await expect(
    retry_object_propagation(
      async () => {
        executed_attempts += 1
        throw new Error('[sdk] transaction digest failed on-chain: Object 0xclaim not found')
      },
      async () => undefined
    )
  ).rejects.toThrow('failed on-chain')
  expect(executed_attempts).toBe(1)
})
