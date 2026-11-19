// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { OWNER_ADDRESS, create_telegram_access } from '../src/telegram_access.ts'

import { memory_access } from './helpers/memory_access.ts'

const FIRST = `0x${'1'.repeat(64)}`
const SECOND = `0x${'9'.repeat(64)}`

test('the waitlist keeps each owner once, in joining order, and joining admits nobody', async () => {
  const clock = { now: 1000 }
  const access = memory_access(() => clock.now)
  await access.join(SECOND)
  clock.now = 2000
  await access.join(FIRST)
  clock.now = 3000
  await access.join(SECOND)
  expect(await access.waiting()).toEqual([
    { owner: SECOND, joined_at: 1000 },
    { owner: FIRST, joined_at: 2000 },
  ])
  expect([await access.joined(FIRST), await access.joined(`0x${'8'.repeat(64)}`)]).toEqual([true, false])
  expect([await access.admitted(FIRST), await access.admitted_owners()]).toEqual([false, []])
})

test('only the allowlist admits, it is read on every call, and an admitted owner is no longer waiting', async () => {
  const access = memory_access(() => 1000)
  await access.join(FIRST)
  await access.join(SECOND)
  await access.admit(SECOND)
  await access.admit(SECOND)
  expect([await access.admitted(SECOND), await access.joined(SECOND)]).toEqual([true, true])
  expect(await access.admitted_owners()).toEqual([SECOND])
  expect(await access.waiting()).toEqual([{ owner: FIRST, joined_at: 1000 }])
  // Removed, the owner is refused on the next call and waits again from its first joining time.
  await access.remove(SECOND)
  expect(await access.admitted(SECOND)).toBe(false)
  expect((await access.waiting()).map(({ owner }) => owner)).toEqual([FIRST, SECOND])
})

test('nothing but a canonical owner address is ever written', async () => {
  const sent: string[] = []
  const access = create_telegram_access(async (command) => {
    sent.push(command)
    return 0
  })
  for (const invalid of ['claimed-wallet', '42', FIRST.toUpperCase(), `${FIRST}0`, ` ${FIRST}`, ''])
    for (const write of [access.join, access.admit, access.remove]) {
      expect(OWNER_ADDRESS.test(invalid)).toBe(false)
      await expect(write(invalid)).rejects.toThrow('invalid_owner')
    }
  expect(sent).toEqual([])
})

// Redis answers a scored range as flat text under RESP2 and as [member, score] pairs under RESP3.
test('a scored range reads the same from either Redis reply shape', async () => {
  for (const reply of [
    [SECOND, '1000', FIRST, '2000'],
    [
      [SECOND, 1000],
      [FIRST, 2000],
    ],
  ]) {
    const access = create_telegram_access(async (command) => (command === 'ZRANGE' ? reply : []))
    expect(await access.waiting()).toEqual([
      { owner: SECOND, joined_at: 1000 },
      { owner: FIRST, joined_at: 2000 },
    ])
  }
})
