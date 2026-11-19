// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_owner_dispatch } from '../src/owner_dispatch.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'

test('control transaction checks the expected fence again after routing', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lane = await control.acquire(f.bot, 'owner', 30)
  const store = {
    ...f.store,
    transaction: ((keys, operation) =>
      f.store.transaction(keys, async (tx) => {
        const key = lane_key_for(f.bot)
        await tx.put(key, { ...lane, actor_id: 'replacement', fence: lane.fence + 1 })
        return operation(tx)
      })) as typeof f.store.transaction,
  }
  const dispatch = create_owner_dispatch(store, f.options.config, f.observe, () => f.clock.now)
  try {
    await expect(
      dispatch(f.grant, 'pause', [], { actor_id: 'owner', fence: lane.fence, deadline: f.clock.now + 30 })
    ).rejects.toThrow('actor_fenced')
    expect((await f.store.read<Lane>(lane_key_for(f.bot)))?.paused).toBe(false)
  } finally {
    await f.runtime.stop()
  }
})

test('control transaction cannot commit after its RPC deadline expires', async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const lane = await control.acquire(f.bot, 'owner', 30)
  const store = {
    ...f.store,
    transaction: ((keys, operation) =>
      f.store.transaction(keys, (tx) =>
        operation({
          ...tx,
          put: async (key, value) => {
            await tx.put(key, value)
            f.clock.now += 20
          },
        })
      )) as typeof f.store.transaction,
  }
  const dispatch = create_owner_dispatch(store, f.options.config, f.observe, () => f.clock.now)
  try {
    await expect(
      dispatch(f.grant, 'pause', [], { actor_id: 'owner', fence: lane.fence, deadline: f.clock.now + 10 })
    ).rejects.toThrow('observation_timeout')
    expect((await f.store.read<Lane>(lane_key_for(f.bot)))?.paused).toBe(false)
  } finally {
    await f.runtime.stop()
  }
})
