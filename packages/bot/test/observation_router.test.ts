// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_observation_router } from '../src/observation_router.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'
import { create_owner_dispatch } from '../src/owner_dispatch.ts'
import type { LocalOwnerControl } from '../src/owner_control.ts'

import { put } from './helpers/control_fixture.ts'
import { runtime_fixture } from './helpers/runtime_fixture.ts'

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

test('remaining lease bounds stalled publish, and shutdown retires its reply', async () => {
  const f = await fixture(
    async () => ({}),
    () => new Promise(() => undefined)
  )
  try {
    const outcome = f.caller.observe(f.grant, {}).then(
      () => 'unexpected',
      (error: Error) => error.message
    )
    expect(await Promise.race([outcome, Bun.sleep(100).then(() => 'hung')])).toBe('observation_timeout')
    const pending = f.caller.observe(f.grant, {}).then(
      () => 'unexpected',
      (error: Error) => error.message
    )
    await Bun.sleep(1)
    await f.caller.stop()
    expect(await pending).toBe('observation_unavailable')
  } finally {
    await f.close()
  }
})

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

test('mutation publish timeout is reported without a second request', async () => {
  let publishes = 0
  const f = await fixture(
    async () => ({}),
    () => {
      publishes += 1
      return new Promise(() => undefined)
    }
  )
  try {
    await expect(f.caller.dispatch(f.grant, 'pause', [])).rejects.toThrow('observation_timeout')
    expect(publishes).toBe(1)
  } finally {
    await f.close()
  }
})

test('durable pause succeeds without contacting or awakening an unreachable owner', async () => {
  const f = await fixture(async () => {
    throw new Error('must not awaken')
  })
  try {
    await f.owner.stop()
    const ingress = create_control_service(
      f.store,
      f.options.config,
      60000,
      () => f.clock.now,
      f.caller.observe,
      f.caller.dispatch
    )
    expect(await ingress.pause(f.grant)).toMatchObject({ paused: true })
    expect(await f.store.read<Lane>(lane_key_for(f.bot))).toMatchObject({ actor_id: 'owner', paused: true })
    expect(f.messages).toHaveLength(0)
  } finally {
    await f.close()
  }
})
