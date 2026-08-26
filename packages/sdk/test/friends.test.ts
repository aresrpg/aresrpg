// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_cache } from '../src/cache.ts'
import { friend_list_id, friends_actions } from '../src/friends.ts'

const id = (value: number) => `0x${String(value).padStart(64, '0')}`

test('first add creates the derived list while later adds mutate that exact object', async () => {
  const calls: string[] = []
  const cache = create_cache()
  const address = id(9)
  const registry = id(10)
  const package_id = id(1)
  const list = friend_list_id(registry, package_id, address)
  const sdk = {
    pins: { friend_registry: { id: registry, shared_version: '1' } },
    game_type_package: package_id,
    cache,
    tx: () => ({}),
    hydrate_unknown: async () => cache,
    execute: async () => ({ Transaction: { digest: 'digest' } }),
    doors: {
      create_friend_list: () => calls.push('create'),
      set_friend: (_tx: unknown, args: Readonly<{ present: boolean }>) => calls.push(args.present ? 'add' : 'remove'),
    },
  }
  const actions = friends_actions(sdk as never, { address })
  expect(actions.list).toBe(list)
  await actions.add(id(20))
  cache.owned.set(list, { objectId: list, version: '1', digest: id(30) })
  await actions.add(id(21))
  await actions.remove(id(20))
  expect(calls).toEqual(['create', 'add', 'remove'])
})
