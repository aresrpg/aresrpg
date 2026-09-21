// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { sampled_read } from '../src/sampled_read.ts'

test('many viewers and a slow read share one sample, with a bounded refresh rate', async () => {
  let now = 0
  let calls = 0
  const pending = Promise.withResolvers<number>()
  const read = sampled_read(
    async () => {
      calls++
      return pending.promise
    },
    5000,
    () => now
  )
  const first = read('wood')
  now = 10000
  expect(read('wood')).toBe(first)
  pending.resolve(42)
  expect(await first).toBe(42)
  await Promise.all(Array.from({ length: 1000 }, () => read('wood')))
  expect(calls).toBe(1)
  now = 14999
  expect(await read('wood')).toBe(42)
  expect(calls).toBe(1)
  now = 15000
  expect(await read('wood')).toBe(42)
  expect(calls).toBe(2)
})

test('a failed read cannot cause a retry storm and can recover after expiry', async () => {
  let now = 0
  let calls = 0
  const read = sampled_read(
    async () => {
      if (++calls === 1) throw new Error('offline')
      return 7
    },
    5000,
    () => now
  )
  await expect(read('wood')).rejects.toThrow('offline')
  await expect(read('wood')).rejects.toThrow('offline')
  expect(calls).toBe(1)
  now = 5000
  expect(await read('wood')).toBe(7)
})
