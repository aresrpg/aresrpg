// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Custody and consent on a real Redis: one identity per creation, lost replies, concurrent owners,
// consent that expires or races, and recovery of a proven conflict.
import { expect } from 'bun:test'
import type { RedisClient } from 'bun'

import { create_connect_service } from '../src/connect.ts'
import { create_key_provider } from '../src/managed_signer.ts'
import type { Account, AuthorizationRequest, Grant, OwnerChallenge } from '../src/model.ts'
import { create_oauth_service } from '../src/oauth.ts'
import {
  request_owner_provisioning,
  request_provisioning,
  run_provisioning,
  type ProvisionRequest,
} from '../src/provisioning.ts'
import { create_redis_store } from '../src/store.ts'
import { retired_run } from '../src/store_projection.ts'

import {
  REDIS_URL,
  consented,
  fixture_config,
  fixture_google,
  fixture_redis,
  integration,
  keyring_json,
  redis_space,
} from './fixture.ts'
import { conflict_recovery } from './fixture_fight.ts'

const input = {
  id: 'creation',
  owner: fixture_google.toSuiAddress(),
  zklogin_public_identifier: fixture_google.toBase64(),
  policy: { revision: 1, scopes: ['play'] },
}
const keyring = keyring_json({ v1: 8 })
const message = new TextEncoder().encode('unfunded restore fixture')
/** A store whose commit script reply is lost, before or after Redis ran it. */
const losing = (redis: RedisClient, namespace: string, after: boolean, keep?: (args: string[]) => void) =>
  create_redis_store(
    {
      send: async (command: string, args: string[]) => {
        const commit = command === 'EVAL' && args[0]?.includes("redis.call('MSET'")
        if (commit && !after) {
          keep?.(args)
          throw new Error('commit outcome unknown')
        }
        const result = await redis.send(command, args)
        if (commit) throw new Error('reply lost')
        return result
      },
    } as RedisClient,
    namespace
  )

integration(
  'R5 concurrent creators commit one identity; a lost reply reconciles the exact bot, key and owner index; a delayed creation cannot overwrite it',
  async () => {
    const f = await redis_space()
    const second = fixture_redis(REDIS_URL!)
    await second.connect()
    const stores = [f.store, create_redis_store(second, f.namespace)]
    const providers = stores.map((store) => create_key_provider(store, keyring))
    try {
      await request_provisioning(stores[0]!, input)
      const bots = await Promise.all(
        Array.from({ length: 12 }, (_, i) => run_provisioning(stores[i % 2]!, providers[i % 2]!, input.id))
      )
      const bot = bots[0]!
      expect(bots.every((entry) => entry.address === bot.address && entry.key_id === bot.key_id)).toBe(true)
      const provision = (await stores[0]!.read<ProvisionRequest>(`provision:${input.id}`))!
      expect([provision.status, (await stores[0]!.read<Account>(`account:${input.owner}`))!.bot_ids]).toEqual([
        'ready',
        [input.id],
      ])
      expect([
        await stores[0]!.read(`identity:mainnet:${bot.address}`),
        await stores[0]!.scan_keys('bot:signing:', 20),
      ]).toEqual([input.id, [bot.key_id]])
      const backup = await stores[0]!.read<string>(bot.key_id)
      expect(
        await create_key_provider(stores[1]!, keyring_json({ v1: 8, v2: 7 }, 'v2')).rewrap(provision.key!)
      ).toEqual(provision.key!)
      await expect(providers[0]!.signer(provision.key!).sign_personal_message(message)).rejects.toThrow('UNAVAILABLE')
      // Restore only this test's ciphertext, never flush or restore a shared database.
      await stores[0]!.transaction([bot.key_id], (tx) => tx.put(bot.key_id, backup))
      const signer = create_key_provider(stores[1]!, keyring).signer(provision.key!)
      expect(
        await signer.public_key.verifyPersonalMessage(message, (await signer.sign_personal_message(message)).signature)
      ).toBe(true)
    } finally {
      second.close()
      await f.dispose()
    }
    const lost = await redis_space()
    try {
      await request_provisioning(lost.store, input)
      const uncertain = losing(lost.redis, lost.namespace, true)
      const bot = await run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)
      expect([
        await lost.store.read(`bot:${input.id}`),
        (await lost.store.read<Account>(`account:${input.owner}`))!.bot_ids,
      ]).toEqual([bot, [input.id]])
      expect([(await lost.store.read(bot.key_id)) !== null, await lost.store.scan_keys('identity:', 20)]).toEqual([
        true,
        [`identity:mainnet:${bot.address}`],
      ])
    } finally {
      await lost.dispose()
    }
    const delayed = await redis_space()
    try {
      let held: string[] | undefined
      const uncertain = losing(delayed.redis, delayed.namespace, false, (args) => (held = args))
      await request_provisioning(delayed.store, input)
      await expect(run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)).rejects.toThrow(
        'unknown'
      )
      expect(await delayed.store.read(`bot:${input.id}`)).toBeNull()
      const winner = await run_provisioning(delayed.store, create_key_provider(delayed.store, keyring), input.id)
      const sealed = await delayed.store.read(winner.key_id)
      expect(await delayed.redis.send('EVAL', held!)).toBe(0)
      expect([await delayed.store.read(`bot:${input.id}`), await delayed.store.read(winner.key_id)]).toEqual([
        winner,
        sealed,
      ])
      expect(await delayed.store.scan_keys('identity:', 20)).toEqual([`identity:mainnet:${winner.address}`])
      expect(await run_provisioning(uncertain, create_key_provider(uncertain, keyring), input.id)).toEqual(winner)
    } finally {
      await delayed.dispose()
    }
  }
)

integration('R6 concurrent owner upserts across Redis clients resolve one retained wallet request', async () => {
  const f = await redis_space()
  const second = fixture_redis(REDIS_URL!)
  await second.connect()
  const stores = [f.store, create_redis_store(second, f.namespace)]
  try {
    const requests = await Promise.all(
      Array.from({ length: 12 }, (_, index) => request_owner_provisioning(stores[index % 2]!, input, input.policy))
    )
    expect(new Set(requests.map(({ id }) => id)).size).toBe(1)
    const bots = await Promise.all(
      stores.map((store) => run_provisioning(store, create_key_provider(store, keyring), requests[0]!.id))
    )
    expect(bots[1]!.address).toBe(bots[0]!.address)
    expect([
      (await stores[0]!.read<Account>(`account:${input.owner}`))!.bot_ids,
      (await stores[0]!.scan_keys('bot:signing:', 20)).length,
    ]).toEqual([[requests[0]!.id], 1])
  } finally {
    second.close()
    await f.dispose()
  }
})

integration(
  'R4 consent promotes the client and a code exchange removes the grant expiry; expiry during verification, a wrong-type key or a race mints at most one grant',
  async () => {
    const f = await redis_space()
    try {
      const a = await consented(f.store, { now: Date.now() })
      const client_key = f.key(`client:${a.client.client_id}`)
      expect(await f.redis.send('PTTL', [client_key])).toBeGreaterThan(0)
      // Expiry while the owner's proof is verified mints nothing and promotes nothing.
      const expiring = create_connect_service(f.store, fixture_config, async () => {
        await f.redis.send('PEXPIREAT', [f.key(`challenge:${a.first.result.challenge_id}`), String(Date.now() - 1)])
      })
      await expect(
        expiring.authorize(a.first.result.challenge_id, 'fixture-owner-proof', a.started.session)
      ).rejects.toThrow('invalid_challenge')
      expect([await f.store.scan_keys('grant:', 10), (await f.redis.send('PTTL', [client_key])) > 0]).toEqual([
        [],
        true,
      ])
      const consent = await a.consent()
      const id = consent.result.challenge_id
      await f.redis.send('SET', [`${f.namespace}:pending`, 'wrong-type'])
      await expect(a.authorize(id)).rejects.toThrow('WRONGTYPE')
      expect([
        (await f.store.read<OwnerChallenge>(`challenge:${id}`))?.consumed,
        await f.store.scan_keys('grant:', 10),
      ]).toEqual([false, []])
      await f.redis.send('DEL', [`${f.namespace}:pending`])
      const rival = create_connect_service(create_redis_store(f.redis, f.namespace), fixture_config, async () => {})
      const results = await Promise.allSettled([
        a.authorize(id),
        rival.authorize(id, 'fixture-owner-proof', a.started.session),
      ])
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect([
        (await f.store.scan_keys('grant:', 10)).length,
        (await f.store.read<OwnerChallenge>(`challenge:${id}`))?.consumed,
      ]).toEqual([1, true])
      expect(await f.redis.send('PTTL', [client_key])).toBe(-1)
      const won = results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<
        URL | { redirect_url: string }
      >
      const code = new URL(won.value instanceof URL ? won.value : won.value.redirect_url).searchParams.get('code')!
      const grant_key = f.key(`grant:${code.split('.')[0]}`)
      expect(await f.redis.send('PTTL', [grant_key])).toBeGreaterThan(0)
      const tokens = await a.oauth.exchange(a.token_input(code))
      expect(await f.redis.send('PTTL', [grant_key])).toBe(-1)
      expect((await a.oauth.authenticate(tokens.access_token)).client_id).toBe(a.client.client_id)
      const refresh = {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: a.client.client_id,
        resource: fixture_config.resource,
      }
      await a.oauth.exchange(refresh)
      await expect(a.oauth.exchange(refresh)).rejects.toThrow('invalid_grant')
      expect([
        await f.redis.send('PTTL', [grant_key]),
        (await f.store.read<Grant>(`grant:${code.split('.')[0]}`))?.revoked,
      ]).toEqual([-1, true])
      // No client re-registration is needed after its original provisional deadline.
      const later = create_oauth_service(f.store, fixture_config, () => Date.now() + fixture_config.request_ttl_ms + 1)
      const request = (await f.store.read<AuthorizationRequest>(`request:${a.identity.authorization_id}`))!
      const again = await later.begin(
        new URLSearchParams({
          client_id: a.client.client_id,
          redirect_uri: request.redirect_uri,
          scope: request.scopes.join(' '),
          resource: request.resource,
          state: 'fresh',
          response_type: 'code',
          code_challenge_method: 'S256',
          code_challenge: request.code_challenge,
        })
      )
      expect(again).toHaveProperty('location')
    } finally {
      await f.dispose()
    }
  }
)

integration(
  'S24 R3 a proven conflict recovers on Redis even when the commit reply is lost; legacy execution records never starve the index',
  async () => {
    for (const lose_ack of [false, true]) {
      const f = await redis_space()
      try {
        await conflict_recovery(f.store, lose_ack)
      } finally {
        await f.dispose()
      }
    }
    const f = await redis_space()
    // Legacy receipt rows have no reader at all; legacy commands are never restored.
    const keys = ['command:a', 'command:b', 'behavior:run', 'profession:old']
    try {
      await f.redis.send('SET', [f.namespace, 'records-v2'])
      for (const key of keys) {
        const value = {
          status: 'active',
          pending: 'legacy-envelope',
          ...(key === 'behavior:run' ? { character_id: 'hero' } : {}),
        }
        await f.redis.send('SET', [f.key(key), JSON.stringify({ revision: 'legacy', value })])
        await f.redis.send('ZADD', [`${f.namespace}:pending`, '0', f.key(key)])
      }
      // A hero run is found, and so is a stored run of a retired shape: discovery lets the actor stop it.
      expect([
        await f.store.scan_pending(1),
        await f.store.scan_pending(10),
        await f.store.scan_pending(1, 'profession:old'),
      ]).toEqual([['behavior:run'], ['behavior:run', 'profession:old'], []])
      expect([
        retired_run('behavior:run', await f.store.read('behavior:run')),
        retired_run('profession:old', await f.store.read('profession:old')),
      ]).toEqual([false, true])
      await f.store.transaction(['profession:old'], async (tx) =>
        tx.put('profession:old', { ...(await tx.get<object>('profession:old')), status: 'stopped' })
      )
      expect([await f.store.scan_pending(10), await f.store.read('command:a')]).toEqual([['behavior:run'], null])
      expect(await f.redis.send('GET', [f.key('command:a')])).toContain('legacy-envelope')
    } finally {
      await f.dispose()
    }
  }
)
