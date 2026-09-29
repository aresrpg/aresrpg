// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { shared_fight_checkpoints } from '../src/fight_checkpoints.ts'
import type { EventEnvelope } from '../src/protocol.ts'

test('many viewers share one read per event, including viewers whose event queues drain later', async () => {
  let reads = 0
  const read = shared_fight_checkpoints(async () => {
    reads++
    return null
  })
  const event = {
    type: 'FightProjected',
    data: { fight: 'fight' },
    ckpt: 1,
    tx: 0,
    evt: 0,
    ts_ms: 0,
  } satisfies EventEnvelope
  await Promise.all(Array.from({ length: 100 }, () => read('fight', event)))
  await read('fight', event)
  expect(reads).toBe(1)
  await read('fight', { ...event })
  expect(reads).toBe(2)
})

test('initial reads coalesce only while in flight, and newer events never reuse an older read', async () => {
  let reads = 0
  const pending = Promise.withResolvers<null>()
  const read = shared_fight_checkpoints(() => {
    reads++
    return pending.promise
  })
  const first = read('fight')
  const second = read('fight')
  expect(reads).toBe(1)
  const fresh = read('fight', {
    type: 'FightProjected',
    data: { fight: 'fight' },
    ckpt: 1,
    tx: 0,
    evt: 0,
    ts_ms: 0,
  } satisfies EventEnvelope)
  expect(reads).toBe(2)
  pending.resolve(null)
  await Promise.all([first, second, fresh])
  await read('fight')
  expect(reads).toBe(3)
})
