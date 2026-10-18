// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { wait_for_fight_resources } from '../../../src/game/fight/fight_resources.ts'

test('a cue awaits the replacement appearance request, not an older completed request', async () => {
  const first = Promise.withResolvers<Error | null>()
  const second = Promise.withResolvers<Error | null>()
  let current = first.promise
  let completed = false
  const pending = wait_for_fight_resources(() => current).then(() => {
    completed = true
  })
  current = second.promise
  first.resolve(null)
  await Promise.resolve()
  expect(completed).toBe(false)
  second.resolve(null)
  await pending
  expect(completed).toBe(true)
})

test('retiring a fight releases its waiter without forwarding a stale load failure', async () => {
  const request = Promise.withResolvers<Error | null>()
  let current: Promise<Error | null> | null = request.promise
  const pending = wait_for_fight_resources(() => current)
  current = null
  request.resolve(new Error('retired request'))
  await expect(pending).resolves.toBeUndefined()
})

test('a current preparation failure reaches the cue boundary', async () => {
  const failed = Promise.resolve(new Error('appearance unavailable'))
  await expect(wait_for_fight_resources(() => failed)).rejects.toThrow('appearance unavailable')
})
