// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_single_flight, retry_after_version_race } from '../../src/transaction_guard.ts'

test('one synchronous flight rejects rapid repeats and unlocks after settlement', async () => {
  const run = create_single_flight()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const first = run(async () => {
    calls += 1
    await pending
  })
  expect(first).not.toBeNull()
  expect(run(async () => void (calls += 1))).toBeNull()
  await Promise.resolve()
  expect(calls).toBe(1)
  release()
  await first
  await run(async () => void (calls += 1))
  expect(calls).toBe(2)
})

test('a rejected transaction also releases the flight', async () => {
  const run = create_single_flight()
  await expect(run(async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope')
  expect(run(async () => 'retry')).not.toBeNull()
})

test('a compound action retries one pre-submission object-version race after its first receipt', async () => {
  const waits: number[] = []
  let attempts = 0
  const result = await retry_after_version_race(
    async () => {
      attempts += 1
      if (attempts === 1)
        throw new Error(
          "[sdk] dry run failed — transaction NOT submitted (zero gas): provided version doesn't match for object 0x1"
        )
      return 'crafted'
    },
    async (milliseconds) => void waits.push(milliseconds)
  )

  expect({ attempts, result, waits }).toEqual({ attempts: 2, result: 'crafted', waits: [250] })
  await expect(
    retry_after_version_race(async () =>
      Promise.reject(new Error("[sdk] transaction abc failed on-chain: provided version doesn't match"))
    )
  ).rejects.toThrow('failed on-chain')
})
