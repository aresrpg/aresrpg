// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { RedisClient } from 'bun'
import { expect, test } from 'bun:test'
import { hosted_keys } from '@aresrpg/protocol/hosted-keys'
import { create_telegram_access } from '@aresrpg/protocol/telegram-access'

import { secure_records } from '../src/secure_records.ts'
import { redis_backend } from '../src/store.ts'

import { fixture, identity } from './helpers/connected_fixture.ts'

const url = process.env.TEST_TELEGRAM_REDIS_URL
const integration = url ? test : test.skip
// Disposable loopback Redis only; every test uses its own namespace and deletes it.
const connect = async () => {
  if (new URL(url!).hostname !== '127.0.0.1') throw new Error('loopback Redis only')
  const redis = new RedisClient(url!, { enableOfflineQueue: false })
  await redis.connect()
  const namespace = `telegram-test:${crypto.randomUUID()}`
  const keys = async () => ((await redis.send('KEYS', [`${namespace}:*`])) as string[]).toSorted()
  const ttl = async (id: string) => redis.send('PTTL', [`${namespace}:${id}`]) as Promise<number>
  const dispose = async () => {
    const left = await keys()
    if (left.length) await redis.send('DEL', left)
    redis.close()
  }
  const clock = { now: 1000 }
  // A second accessor on the same keys stands for the operator command beside the running service.
  const access = () =>
    create_telegram_access(
      (command, args) => redis.send(command, args),
      hosted_keys('telegram', namespace),
      () => clock.now
    )
  const backend = redis_backend(redis, namespace)
  return { redis, namespace, backend, access: access(), operator: access(), clock, keys, ttl, dispose }
}

integration('compare-and-set on Redis fails closed for a concurrent change', async () => {
  const r = await connect()
  try {
    const records = secure_records(r.backend, 'ab'.repeat(32))
    await records.change(['user:42'], () => ({ 'user:42': { value: 0 } }))
    const outcomes = await Promise.allSettled(
      [1, 2].map((version) => records.change(['user:42'], () => ({ 'user:42': { value: version } })))
    )
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason.message).toBe(
      'link_changed'
    )
    expect([1, 2]).toContain((await records.read<number>('user:42'))!)
  } finally {
    await r.dispose()
  }
})

integration('Redis expires a record natively at its absolute deadline', async () => {
  const r = await connect()
  try {
    const records = secure_records(r.backend, 'ab'.repeat(32))
    await records.change(['pending:a'], () => ({ 'pending:a': { value: 'a', expires_at: Date.now() + 150 } }))
    expect(await r.ttl('pending:a')).toBeGreaterThan(0)
    await Bun.sleep(250)
    expect(await r.redis.send('EXISTS', [`${r.namespace}:pending:a`])).toBe(0)
  } finally {
    await r.dispose()
  }
})

integration('a link on Redis: per-entity ciphertext, deadline while unopened, deleted once consumed', async () => {
  const r = await connect()
  try {
    const f = fixture({ backend: r.backend, now: Date.now() })
    const { browser, query } = await f.start()
    const [pending] = (await r.keys()).filter((key) => key.includes(':pending:'))
    expect(await r.redis.send('PTTL', [pending!])).toBeGreaterThan(0)
    const result = await f.links.callback(query, browser.cookie)
    // Once it holds tokens it must outlive its deadline until revoked or consumed.
    expect(await r.redis.send('PTTL', [pending!])).toBe(-1)
    await f.links.confirm(42, result.code)
    const keys = await r.keys()
    expect(keys.map((key) => key.slice(r.namespace.length + 1).split(':')[0]).toSorted()).toEqual(['owner', 'user'])
    for (const key of keys) {
      expect(await r.redis.send('PTTL', [key])).toBe(-1)
      expect(await r.redis.send('GET', [key])).not.toContain('refresh')
    }
    expect((await f.links.current(42))?.identity).toEqual(identity)
  } finally {
    await r.dispose()
  }
})

integration('the allowlist on Redis is read live: admitted at the next request, refused after removal', async () => {
  const r = await connect()
  try {
    const f = fixture({ backend: r.backend, access: r.access, now: Date.now() })
    await f.identify()
    expect(await r.access.admitted(identity.owner)).toBe(false)
    await expect(f.links.upgrade(42)).rejects.toThrow('owner_not_admitted')
    await r.operator.admit(identity.owner)
    await r.operator.admit(identity.owner)
    expect(await r.redis.send('TYPE', [`${r.namespace}:admitted`])).toBe('set')
    expect(await r.operator.admitted_owners()).toEqual([identity.owner])
    const { browser, query } = await f.start(42, true)
    await f.links.confirm(42, (await f.links.callback(query, browser.cookie)).code)
    expect((await f.links.authenticate(42)).play).toBe(true)
    await r.operator.remove(identity.owner)
    await expect(f.links.authenticate(42)).rejects.toThrow('owner_not_admitted')
    expect(await r.operator.admitted_owners()).toEqual([])
  } finally {
    await r.dispose()
  }
})

integration('the waitlist on Redis keeps each owner once, oldest first, and lists only who still waits', async () => {
  const r = await connect()
  try {
    const other = `0x${'9'.repeat(64)}`
    await r.access.join(other)
    r.clock.now = 2000
    await r.access.join(identity.owner)
    r.clock.now = 3000
    await r.access.join(other)
    expect(await r.redis.send('TYPE', [`${r.namespace}:waitlist`])).toBe('zset')
    expect(await r.operator.waiting()).toEqual([
      { owner: other, joined_at: 1000 },
      { owner: identity.owner, joined_at: 2000 },
    ])
    expect([await r.access.joined(other), await r.access.joined(`0x${'8'.repeat(64)}`)]).toEqual([true, false])
    await expect(r.access.join('claimed-wallet')).rejects.toThrow('invalid_owner')
    await r.operator.admit(other)
    expect(await r.operator.waiting()).toEqual([{ owner: identity.owner, joined_at: 2000 }])
    expect((await r.keys()).map((key) => key.slice(r.namespace.length + 1))).toEqual(['admitted', 'waitlist'])
  } finally {
    await r.dispose()
  }
})
