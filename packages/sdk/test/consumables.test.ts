// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { character_actions } from '../src/character_actions.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const harness = () => {
  const commands: string[] = []
  const submissions: unknown[] = []
  const sdk = {
    pins: { seed_package_original: id(1), content_root: { id: id(2) } },
    tx: () => ({}),
    hydrate_unknown: async () => {},
    with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: string, cap: never) => void) =>
      compose(id(3), {} as never),
    doors: {
      merge_stacks: () => commands.push('merge'),
      use_consumable: () => commands.push('consume'),
      use_city_consumable: () => commands.push('city'),
    },
    execute: async (_tx: unknown, options: unknown) => {
      submissions.push(options)
      return { $kind: 'Transaction', Transaction: { digest: 'test' } }
    },
  }
  const actions = character_actions(sdk as never, {
    kiosk_cap: async () => ({ kioskId: id(3), objectId: id(4) }) as never,
  })
  return { actions, commands, submissions }
}
const input = { character_id: id(5), item_id: id(6), item_type: 'barley_bread', custody: { kiosk: id(3) } }

test('invalid quantities never build or submit a transaction', async () => {
  const { actions, submissions, commands } = harness()
  for (const amount of [0, -1, 1.5, NaN, Infinity])
    await expect(actions.use_consumable({ ...input, amount })).rejects.toThrow('positive integer')
  expect(commands).toEqual([])
  expect(submissions).toEqual([])
})

test('a healing batch merges once and submits all consumption calls atomically with estimated gas', async () => {
  const { actions, submissions, commands } = harness()
  await actions.use_consumable({ ...input, amount: 3, merge_sources: [id(7)] })
  expect(commands).toEqual(['merge', 'consume', 'consume', 'consume'])
  expect(submissions).toHaveLength(1)
  expect(submissions[0]).toMatchObject({ budget: 'estimate', custody: input.custody })
})

test('ordinary and city consumables retain the default single-use behavior', async () => {
  const { actions, submissions, commands } = harness()
  await actions.use_consumable(input)
  await actions.use_consumable({ ...input, world: 'nauvis' })
  expect(commands).toEqual(['consume', 'city'])
  expect(submissions).toHaveLength(2)
})
