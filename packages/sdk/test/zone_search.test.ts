// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { search_existing_zone } from '../src/zone_search.ts'

const refused = new Error(
  '[sdk] transaction resolution failed — NOT submitted: MoveAbort EObjectAlreadyExists: Derived object is already claimed., in 0x2::derived_object::claim (line 41)'
)

test('a missing projected zone switches once from unsigned creation to refresh', async () => {
  const calls: boolean[] = []
  expect(
    await search_existing_zone(false, async (refresh) => {
      calls.push(refresh)
      if (!refresh) throw refused
      return 'certified'
    })
  ).toBe('certified')
  expect(calls).toEqual([false, true])
})

test('executed, unrelated and refresh failures never retry', async () => {
  for (const [refresh, error] of [
    [true, refused],
    [false, new Error('[sdk] transaction digest failed on-chain: EObjectAlreadyExists ::derived_object::claim')],
    [false, new Error('[sdk] transaction resolution failed — NOT submitted: insufficient gas')],
  ] as const) {
    let calls = 0
    await expect(
      search_existing_zone(refresh, async () => {
        calls++
        throw error
      })
    ).rejects.toBe(error)
    expect(calls).toBe(1)
  }
})
