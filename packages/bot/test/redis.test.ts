// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_redis_store } from '../src/store.ts'

import { fixture_redis } from './helpers/redis_fixture.ts'
import { create_http_fixture } from './helpers/http_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
integration('Redis atomically rejects absent-key races without replaying callbacks or partial commits', async () => {
  const first = fixture_redis(url!)
  const second = fixture_redis(url!)
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  await Promise.all([first.connect(), second.connect()])
  const stores = [create_redis_store(first, namespace), create_redis_store(second, namespace)]
  try {
    let entered = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const results = await Promise.allSettled(
      stores.map((store) =>
        store.transaction(['lane', 'receipt'], async (tx) => {
          expect(await tx.get('lane')).toBeNull()
          entered += 1
          if (entered === 2) release()
          await barrier
          await tx.put('lane', { pending: null })
          await tx.put('receipt', { digest: 'synthetic' })
        })
      )
    )
    expect(entered).toBe(2)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await stores[0]!.read('receipt')).toEqual({ digest: 'synthetic' })
    await expect(
      stores[0]!.transaction(['lane', 'receipt'], async (tx) => {
        await tx.put('lane', 99)
        await tx.put('receipt', 99)
        throw new Error('fixture crash')
      })
    ).rejects.toThrow('fixture crash')
    expect(await stores[1]!.read('lane')).toEqual({ pending: null })
    expect(await stores[1]!.read('receipt')).toEqual({ digest: 'synthetic' })
    await expect(stores[0]!.transaction(['lane'], (tx) => tx.put('unlocked', 1))).rejects.toThrow(
      'CONTROL_KEY_NOT_LOCKED'
    )
    await expect(stores[0]!.transaction(['lane'], (tx) => tx.get('unlocked'))).rejects.toThrow('CONTROL_KEY_NOT_LOCKED')
    await stores[0]!.transaction(['lane'], async (tx) => {
      await tx.put('lane', { fence: 2 })
      expect(await tx.get('lane')).toEqual({ fence: 2 })
    })
    expect(await stores[1]!.read('lane')).toEqual({ fence: 2 })
    expect(await stores[1]!.scan_keys('', 1)).toEqual(['lane'])
    expect(await stores[1]!.scan_keys('', 1, 'lane')).toEqual(['receipt'])
    expect(await stores[1]!.scan_keys('rec', 10)).toEqual(['receipt'])
    await expect(stores[0]!.scan_keys('', 0)).rejects.toThrow('INVALID_SCAN_LIMIT')
    await expect(stores[0]!.transaction(['lane'], (tx) => tx.put('lane', undefined))).rejects.toThrow(
      'INVALID_CONTROL_VALUE'
    )
  } finally {
    await first.send('DEL', [namespace])
    first.close()
    second.close()
  }
})

integration('Redis validates read-only admission and detects ABA changes', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const concurrent = create_redis_store(redis, namespace)
  try {
    await store.transaction(['grant'], (tx) => tx.put('grant', { revoked: false }))
    await expect(
      store.transaction(['grant'], async (tx) => {
        expect(await tx.get('grant')).toEqual({ revoked: false })
        await concurrent.transaction(['grant'], (other) => other.put('grant', { revoked: true }))
        await concurrent.transaction(['grant'], (other) => other.put('grant', { revoked: false }))
      })
    ).rejects.toThrow('control_transaction_conflict')
    expect(await store.transaction([], async () => 'empty')).toBe('empty')
  } finally {
    await redis.send('DEL', [namespace])
    redis.close()
  }
})

integration('health rejects a closed Redis connection and a fresh process connection recovers', async () => {
  const first = fixture_redis(url!)
  const replacement = fixture_redis(url!)
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  try {
    await first.connect()
    const original = create_http_fixture(create_redis_store(first, namespace))
    expect((await original.request('/health')).status).toBe(200)
    first.close()
    expect((await original.request('/health')).status).toBe(503)
    await replacement.connect()
    const restarted = create_http_fixture(create_redis_store(replacement, namespace))
    expect((await restarted.request('/health')).status).toBe(200)
  } finally {
    first.close()
    replacement.close()
  }
})

integration(
  'pending discovery excludes history, survives restart and settles with the authoritative record',
  async () => {
    const redis = fixture_redis(url!)
    await redis.connect()
    const namespace = `bot:fixture:${crypto.randomUUID()}`
    const store = create_redis_store(redis, namespace)
    try {
      const keys = Array.from({ length: 1000 }, (_, index) => `command:history-${index}`)
      await store.transaction([...keys, 'command:pending', 'profession:active'], async (tx) => {
        for (const key of keys) await tx.put(key, { status: 'completed' })
        await tx.put('command:pending', { status: 'uncertain' })
        await tx.put('profession:active', { status: 'waiting' })
      })
      const restarted = create_redis_store(redis, namespace)
      expect(await restarted.scan_pending(1)).toEqual(['command:pending'])
      expect(await restarted.scan_pending(1, 'command:pending')).toEqual(['profession:active'])
      await expect(
        store.transaction(['command:pending'], async (tx) => {
          await tx.put('command:pending', { status: 'completed' })
          throw new Error('fixture crash before commit')
        })
      ).rejects.toThrow('fixture crash')
      expect(await restarted.scan_pending(10)).toEqual(['command:pending', 'profession:active'])
      await store.transaction(['command:pending', 'profession:active'], async (tx) => {
        await tx.put('command:pending', { status: 'completed' })
        await tx.put('profession:active', { status: 'awaiting_ai' })
      })
      expect(await restarted.scan_pending(10)).toEqual([])
      expect(await restarted.read('command:pending')).toEqual({ status: 'completed' })
    } finally {
      await redis.send('DEL', [namespace, `${namespace}:pending`])
      redis.close()
    }
  }
)

integration('old snapshots cannot silently hide unresolved work behind a missing pending index', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  try {
    await redis.send('HSET', [
      namespace,
      'command:unresolved',
      JSON.stringify({ revision: 'legacy', value: { status: 'uncertain' } }),
    ])
    const store = create_redis_store(redis, namespace)
    await expect(store.scan_pending(10)).rejects.toThrow('UNSUPPORTED_CONTROL_SCHEMA')
    await expect(store.transaction(['new'], (tx) => tx.put('new', {}))).rejects.toThrow('UNSUPPORTED_CONTROL_SCHEMA')
    await expect(store.read('command:unresolved')).rejects.toThrow('UNSUPPORTED_CONTROL_SCHEMA')
    expect(await redis.send('HGET', [namespace, 'command:unresolved'])).toContain('uncertain')
    expect(await redis.send('GET', [`${namespace}:record:new`])).toBeNull()
  } finally {
    await redis.send('DEL', [namespace, `${namespace}:pending`])
    redis.close()
  }
})
