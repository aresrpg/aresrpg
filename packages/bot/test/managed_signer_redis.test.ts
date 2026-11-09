// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { randomUUID } from 'node:crypto'

import { expect, test } from 'bun:test'
import type { RedisClient } from 'bun'

import { create_key_provider } from '../src/managed_signer.ts'
import { create_redis_store } from '../src/store.ts'
import { request_provisioning, run_provisioning, type ProvisionRequest } from '../src/provisioning.ts'
import type { Account } from '../src/model.ts'

import { fixture_google } from './helpers/control_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
const input = {
  id: 'creation',
  owner: fixture_google.toSuiAddress(),
  zklogin_public_identifier: fixture_google.toBase64(),
  policy: { revision: 1, scopes: ['play'] },
}
const keyring = { active_key_id: 'v1', keys: { v1: new Uint8Array(32).fill(8) } }
const message = new TextEncoder().encode('unfunded restore fixture')
integration(
  'real Redis commits one complete identity under concurrent creators and restores the same key',
  async () => {
    const first = fixture_redis(url!)
    const second = fixture_redis(url!)
    await Promise.all([first.connect(), second.connect()])
    const namespace = `bot:fixture:${randomUUID()}`
    const stores = [first, second].map((redis) => create_redis_store(redis, namespace))
    const providers = stores.map((store) => create_key_provider(store, keyring))
    try {
      await request_provisioning(stores[0]!, input)
      const bots = await Promise.all(
        Array.from({ length: 12 }, (_, i) => run_provisioning(stores[i % 2]!, providers[i % 2]!, input.id))
      )
      const bot = bots[0]!
      expect(bots.every((entry) => entry.address === bot.address && entry.key_id === bot.key_id)).toBe(true)
      const provision = (await stores[0]!.read<ProvisionRequest>(`provision:${input.id}`))!
      const account = (await stores[0]!.read<Account>(`account:${input.owner}`))!
      expect(provision.status).toBe('ready')
      expect(account.bot_ids).toEqual([input.id])
      expect(await stores[0]!.read(`identity:mainnet:${bot.address}`)).toBe(input.id)
      expect(await stores[0]!.scan_keys('bot:signing:', 20)).toEqual([bot.key_id])
      expect(await stores[0]!.scan_keys('identity:', 20)).toHaveLength(1)
      const backup = await stores[0]!.read<string>(bot.key_id)
      const updated = { ...keyring, active_key_id: 'v2', keys: { ...keyring.keys, v2: new Uint8Array(32).fill(7) } }
      expect(await create_key_provider(stores[1]!, updated).rewrap(provision.key!)).toEqual(provision.key!)
      await expect(providers[0]!.signer(provision.key!).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
      // Restore only this test's ciphertext, never flush or restore a shared database.
      await stores[0]!.transaction([bot.key_id], (tx) => tx.put(bot.key_id, backup))
      const signer = create_key_provider(stores[1]!, keyring).signer(provision.key!)
      expect(
        await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
      ).toBe(true)
    } finally {
      await first.send('DEL', [namespace, `${namespace}:pending`])
      first.close()
      second.close()
    }
  }
)
integration('a delayed unknown creation cannot overwrite the subsequently published identity', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:fixture:${randomUUID()}`
  const store = create_redis_store(redis, namespace)
  let delayed: string[] | undefined
  const uncertain = create_redis_store(
    {
      send: async (command: string, args: string[]) => {
        if (command === 'EVAL' && args[0]?.includes("redis.call('MSET'")) {
          delayed = args
          throw new Error('commit outcome unknown')
        }
        return redis.send(command, args)
      },
    } as RedisClient,
    namespace
  )
  try {
    await request_provisioning(store, input)
    await expect(run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)).rejects.toThrow(
      'unknown'
    )
    expect(await store.read(`bot:${input.id}`)).toBeNull()
    const winner = await run_provisioning(store, create_key_provider(store, keyring), input.id)
    const sealed = await store.read(winner.key_id)
    expect(await redis.send('EVAL', delayed!)).toBe(0)
    expect(await store.read(`bot:${input.id}`)).toEqual(winner)
    expect(await store.read(winner.key_id)).toEqual(sealed)
    expect(await store.scan_keys('identity:', 20)).toEqual([`identity:mainnet:${winner.address}`])
    expect(await run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)).toEqual(winner)
  } finally {
    await redis.send('DEL', [namespace, `${namespace}:pending`])
    redis.close()
  }
})
integration('lost successful Redis commit reply reconciles exact bot, key and owner index', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:fixture:${randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const uncertain = create_redis_store(
    {
      send: async (command: string, args: string[]) => {
        const result = await redis.send(command, args)
        if (command === 'EVAL' && args[0]?.includes("redis.call('MSET'")) throw new Error('reply lost')
        return result
      },
    } as RedisClient,
    namespace
  )
  try {
    await request_provisioning(store, input)
    const bot = await run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)
    expect(await store.read(`bot:${input.id}`)).toEqual(bot)
    expect(await store.read(bot.key_id)).not.toBeNull()
    expect((await store.read<Account>(`account:${input.owner}`))!.bot_ids).toEqual([input.id])
    expect(await store.scan_keys('identity:', 20)).toEqual([`identity:mainnet:${bot.address}`])
  } finally {
    await redis.send('DEL', [namespace, `${namespace}:pending`])
    redis.close()
  }
})
