// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_observation_router } from '../src/observation_router.ts'
import { create_control_service } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'

const fixture = async (local: () => Promise<unknown>, publish?: () => Promise<number>) => {
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
  const owner = await create_observation_router({ ...options, actor_id: 'owner', local })
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

test.each(['ACTOR_TERMINAL', 'OBSERVATION_SLOT_BUSY', 'invalid_gameplay_payload'])(
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
