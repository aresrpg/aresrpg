// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cross-process owner routing and one vertical run from consent to the SDK executor.
import { expect, test, describe } from 'bun:test'

import { create_control_service, lane_key_for, type Lane, type LocalOwnerControl } from '../src/control.ts'
import { start_service_runtime } from '../src/service_runtime.ts'
import { create_observation_router, create_owner_dispatch } from '../src/observation_router.ts'

import { runtime_fixture, put } from './fixture.ts'

describe('observation router', () => {
  const fixture = async (
    local: () => Promise<unknown>,
    publish?: () => Promise<number>,
    local_control?: LocalOwnerControl
  ) => {
    const f = await runtime_fixture()
    const messages: { channel: string; raw: string }[] = []
    const callbacks = new Map<string, (raw: string, channel: string) => void>()
    const bus = {
      publish: async (channel: string, raw: string) => {
        messages.push({ channel, raw })
        callbacks.get(channel)?.(raw, channel)
        return callbacks.has(channel) ? 1 : 0
      },
      subscribe: async (channel: string, callback: (raw: string, channel: string) => void) => {
        callbacks.set(channel, callback)
      },
      unsubscribe: async (channel: string) => {
        callbacks.delete(channel)
      },
    }
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    await control.acquire(f.bot, 'owner', 30)
    const options = {
      store: f.store,
      config: f.options.config,
      publisher: bus,
      subscriber: bus,
      timeout_ms: 1000,
      now: () => f.clock.now,
      report_failure: () => undefined,
    }
    const owner = await create_observation_router({
      ...options,
      actor_id: 'owner',
      local,
      local_control: local_control ?? create_owner_dispatch(f.store, f.options.config, local, () => f.clock.now),
    })
    const caller = await create_observation_router({
      ...options,
      actor_id: 'caller',
      local: async () => {
        throw new Error('must route')
      },
      publisher: publish ? { publish } : bus,
    })
    return {
      ...f,
      callbacks,
      messages,
      bus,
      control,
      owner,
      caller,
      close: async () => {
        await caller.stop()
        await owner.stop()
        await f.runtime.stop()
      },
    }
  }

  test.each(['actor_stopped', 'OBSERVATION_SLOT_BUSY', 'invalid_gameplay_payload'])(
    'remote read preserves %s',
    async (message) => {
      const f = await fixture(async () => {
        throw new Error(message)
      })
      try {
        await expect(f.caller.observe(f.grant, {})).rejects.toThrow(message)
      } finally {
        await f.close()
      }
    }
  )

  test('reply identity requires both the expected actor and fence', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = await fixture(async () => {
      await held
      return { ready: true }
    })
    try {
      let completed = false
      const pending = f.caller.observe(f.grant, {}).then((value) => {
        completed = true
        return value
      })
      await Bun.sleep(1)
      const request = JSON.parse(f.messages.find(({ channel }) => channel === 'bot:observations:owner')!.raw)
      for (const identity of [
        { sender: 'intruder', fence: request.fence },
        { sender: 'owner', fence: request.fence + 1 },
      ])
        await f.bus.publish(
          'bot:observations:caller',
          JSON.stringify({
            type: 'reply',
            id: request.id,
            ...identity,
            outcome: { ok: true, value: { forged: true } },
          })
        )
      await Bun.sleep(1)
      expect(completed).toBe(false)
      release()
      expect(await pending).toEqual({ ready: true })
    } finally {
      release()
      await f.close()
    }
  })

  test('a stale request fence never invokes the live observation reader', async () => {
    let reads = 0
    const f = await fixture(async () => {
      reads += 1
      return {}
    })
    try {
      await f.bus.publish(
        'bot:observations:owner',
        JSON.stringify({
          type: 'request',
          id: 'stale',
          sender: 'caller',
          actor_id: 'owner',
          grant_id: f.grant.id,
          fence: 0,
          deadline: f.clock.now + 30,
          payload: {},
        })
      )
      await Bun.sleep(1)
      expect(reads).toBe(0)
      expect(JSON.parse(f.messages.at(-1)!.raw)).toMatchObject({
        type: 'reply',
        fence: 0,
        outcome: { ok: true, value: { status: 'pending' } },
      })
    } finally {
      await f.close()
    }
  })

  test('grant-first status routes to the fenced owner and rechecks revoked authority', async () => {
    const f = await fixture(async () => ({}))
    try {
      const ingress = create_control_service(
        f.store,
        f.options.config,
        60000,
        () => f.clock.now,
        f.caller.observe,
        f.caller.dispatch
      )
      await put(f.store, 'command:owned', { id: 'owned', grant_id: f.grant.id, bot_id: f.bot.id, status: 'accepted' })
      expect(await ingress.status(f.grant, 'owned')).toMatchObject({ id: 'owned', status: 'accepted' })
      expect(JSON.parse(f.messages[0]!.raw).control).toEqual({ method: 'status', args: ['owned'] })
      await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
      await expect(ingress.status(f.grant, 'owned')).rejects.toThrow('invalid_token')
    } finally {
      await f.close()
    }
  })

  test('owner mutation errors are never retried at another process', async () => {
    let mutations = 0
    const f = await fixture(
      async () => ({}),
      undefined,
      async () => {
        mutations += 1
        throw new Error('actor_owned')
      }
    )
    try {
      await expect(f.caller.dispatch(f.grant, 'pause', [])).rejects.toThrow('actor_owned')
      expect(mutations).toBe(1)
      expect(f.messages.filter(({ raw }) => JSON.parse(raw).type === 'request')).toHaveLength(1)
    } finally {
      await f.close()
    }
  })

  test('unknown control methods and stale mutation fences cannot reach local execution', async () => {
    let mutations = 0
    const f = await fixture(
      async () => ({}),
      undefined,
      async () => {
        mutations += 1
      }
    )
    try {
      for (const control of [
        { method: 'acquire', args: [] },
        { method: 'pause', args: [] },
      ])
        await f.bus.publish(
          'bot:observations:owner',
          JSON.stringify({
            type: 'request',
            id: 'bad',
            sender: 'caller',
            actor_id: 'owner',
            grant_id: f.grant.id,
            fence: 0,
            deadline: f.clock.now + 30,
            payload: {},
            control,
          })
        )
      await Bun.sleep(1)
      expect(mutations).toBe(0)
      expect(JSON.parse(f.messages.at(-1)!.raw)).toMatchObject({ outcome: { ok: false, error: 'actor_fenced' } })
    } finally {
      await f.close()
    }
  })
})

describe('owner dispatch', () => {
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
})

describe('service runtime', () => {
  test('a process claims no wallet and is not ready before its subscription is acknowledged; stop unsubscribes', async () => {
    const f = await runtime_fixture()
    const state = { ticks: 0, unsubscribed: false, acknowledge: () => undefined as void }
    const acknowledgment = new Promise<void>((resolve) => (state.acknowledge = resolve))
    const starting = start_service_runtime({
      ...f.options,
      publisher: { publish: async () => 0 },
      tick_ms: 60000,
      heartbeat_ms: 60000,
      runtime: { ...f.runtime, tick: async () => void (state.ticks += 1) },
      subscriber: {
        connect: async () => undefined,
        close: () => undefined,
        onclose: null,
        subscribe: async () => (await acknowledgment, 1),
        unsubscribe: async () => void (state.unsubscribed = true),
      },
    })
    await Bun.sleep(1)
    expect([state.ticks, await f.store.scan_keys('lane:', 100)]).toEqual([0, []])
    state.acknowledge()
    const service = await starting
    expect([state.ticks, service.ready()]).toEqual([1, true])
    await service.stop()
    expect([service.ready(), state.unsubscribed]).toEqual([false, true])
  })
})
