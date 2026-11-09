// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_redis_store } from '../src/store.ts'
import { create_connect_service } from '../src/connect.ts'
import { create_oauth_service } from '../src/oauth.ts'
import type { AuthorizationRequest, Grant, OwnerChallenge } from '../src/model.ts'

import { fixture_config } from './helpers/control_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'
import { authorize_fixture } from './oauth.test.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
const fixture = async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const namespace = `bot:fixture:${crypto.randomUUID()}`
  const store = create_redis_store(redis, namespace)
  const key = (logical: string) => `${namespace}:record:${logical}`
  const dispose = async () => {
    const records: string[] = await redis.send('KEYS', [`${namespace}:*`])
    await redis.send('DEL', [namespace, ...records])
    redis.close()
  }
  return { redis, namespace, store, key, dispose }
}

integration('Redis expires temporary records itself while retaining durable execution evidence', async () => {
  const f = await fixture()
  try {
    const expires_at = Date.now() + 150
    const temporary = ['request:idle', 'challenge:idle', 'client:idle', 'grant:code']
    const durable = ['client:approved', 'grant:active', 'grant:revoked', 'command:receipt', 'journal:pending']
    await f.store.transaction([...temporary, ...durable], async (tx) => {
      for (const key of temporary.slice(0, 3)) await tx.put(key, { expires_at })
      await tx.put('grant:code', { code: { expires_at, used: false }, family: null, access: null })
      await tx.put('client:approved', { id: 'approved' })
      await tx.put('grant:active', { code: { expires_at, used: true }, family: { used_hashes: ['replay'] } })
      await tx.put('grant:revoked', { code: { expires_at, used: false }, revoked: true })
      await tx.put('command:receipt', { status: 'completed', digest: 'synthetic' })
      await tx.put('journal:pending', { phase: 'submitting', digest: 'synthetic' })
    })
    for (const key of temporary) expect(await f.redis.send('PTTL', [f.key(key)])).toBeGreaterThan(0)
    await Bun.sleep(200)
    // Direct Redis commands prove this is native expiry, not application reads or cleanup.
    for (const key of temporary) expect(await f.redis.send('EXISTS', [f.key(key)])).toBe(0)
    for (const key of durable) expect(await f.redis.send('PTTL', [f.key(key)])).toBe(-1)
  } finally {
    await f.dispose()
  }
})

integration('consent promotes the client and code exchange removes expiry from the active grant', async () => {
  const f = await fixture()
  try {
    const a = await authorize_fixture(f.store, { now: Date.now() })
    const client_key = f.key(`client:${a.client.client_id}`)
    expect(await f.redis.send('PTTL', [client_key])).toBeGreaterThan(0)
    const approved = await a.connect.authorize(a.consent.result.challenge_id, 'fixture-owner-proof', a.started.session)
    expect(await f.redis.send('PTTL', [client_key])).toBe(-1)
    const code = new URL(approved.redirect_url).searchParams.get('code')!
    const grant_key = f.key(`grant:${code.split('.')[0]}`)
    expect(await f.redis.send('PTTL', [grant_key])).toBeGreaterThan(0)
    const tokens = await a.oauth.exchange({
      grant_type: 'authorization_code',
      code,
      client_id: a.client.client_id,
      redirect_uri: a.client.redirect_uris[0],
      code_verifier: a.verifier,
      resource: fixture_config.resource,
    })
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
    expect(await f.redis.send('PTTL', [grant_key])).toBe(-1)
    const retained = await f.store.read<Grant>(`grant:${code.split('.')[0]}`)
    expect(retained?.revoked).toBe(true)
    // No client re-registration is needed after its original provisional deadline.
    const later = create_oauth_service(f.store, fixture_config, () => Date.now() + fixture_config.request_ttl_ms + 1)
    const request = (await f.store.read<AuthorizationRequest>(`request:${a.identity.authorization_id}`))!
    expect(
      await later.begin(
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
    ).toHaveProperty('location')
  } finally {
    await f.dispose()
  }
})

integration('expiry during consent verification cannot mint a grant or promote a provisional client', async () => {
  const f = await fixture()
  try {
    const a = await authorize_fixture(f.store, { now: Date.now() })
    const connect = create_connect_service(f.store, fixture_config, async () => {
      await f.redis.send('PEXPIREAT', [f.key(`challenge:${a.consent.result.challenge_id}`), String(Date.now() - 1)])
    })
    await expect(
      connect.authorize(a.consent.result.challenge_id, 'fixture-owner-proof', a.started.session)
    ).rejects.toThrow('invalid_challenge')
    expect(await f.store.scan_keys('grant:', 10)).toEqual([])
    expect(await f.redis.send('PTTL', [f.key(`client:${a.client.client_id}`)])).toBeGreaterThan(0)
  } finally {
    await f.dispose()
  }
})

integration('expiry after a transaction snapshot rejects every staged write without replay', async () => {
  const f = await fixture()
  try {
    const expires_at = Date.now() + 10000
    await f.store.transaction(['challenge:race'], (tx) => tx.put('challenge:race', { expires_at, consumed: false }))
    let calls = 0
    await expect(
      f.store.transaction(['challenge:race', 'grant:new'], async (tx) => {
        calls += 1
        const proof = (await tx.get<OwnerChallenge>('challenge:race'))!
        await tx.put('challenge:race', { ...proof, consumed: true })
        await tx.put('grant:new', { code: { expires_at, used: false } })
        await f.redis.send('PEXPIREAT', [f.key('challenge:race'), String(Date.now() - 1)])
      })
    ).rejects.toThrow('control_transaction_conflict')
    expect(calls).toBe(1)
    expect(await f.store.read('grant:new')).toBeNull()
    expect(await f.store.read('challenge:race')).toBeNull()
  } finally {
    await f.dispose()
  }
})

integration('concurrent consent grants at most once and wrong-type Redis state consumes nothing', async () => {
  const f = await fixture()
  try {
    const a = await authorize_fixture(f.store, { now: Date.now() })
    const connect = create_connect_service(create_redis_store(f.redis, f.namespace), fixture_config, async () => {})
    await f.redis.send('SET', [`${f.namespace}:pending`, 'wrong-type'])
    await expect(
      a.connect.authorize(a.consent.result.challenge_id, 'fixture-owner-proof', a.started.session)
    ).rejects.toThrow('WRONGTYPE')
    expect((await f.store.read<OwnerChallenge>(`challenge:${a.consent.result.challenge_id}`))?.consumed).toBe(false)
    expect(await f.store.scan_keys('grant:', 10)).toEqual([])
    await f.redis.send('DEL', [`${f.namespace}:pending`])
    const results = await Promise.allSettled([
      a.connect.authorize(a.consent.result.challenge_id, 'fixture-owner-proof', a.started.session),
      connect.authorize(a.consent.result.challenge_id, 'fixture-owner-proof', a.started.session),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await f.store.scan_keys('grant:', 10)).toHaveLength(1)
    expect((await f.store.read<OwnerChallenge>(`challenge:${a.consent.result.challenge_id}`))?.consumed).toBe(true)
  } finally {
    await f.dispose()
  }
})

integration('rewrites retain absolute expiry and invalid deadlines publish no partial transaction', async () => {
  const f = await fixture()
  try {
    const expires_at = Date.now() + 10000
    await f.store.transaction(['request:fixed'], (tx) => tx.put('request:fixed', { expires_at }))
    const deadline = await f.redis.send('PEXPIRETIME', [f.key('request:fixed')])
    await f.store.transaction(['request:fixed'], async (tx) => {
      const request = await tx.get<AuthorizationRequest>('request:fixed')
      await tx.put('request:fixed', { ...request, consumed: true })
    })
    expect(await f.redis.send('PEXPIRETIME', [f.key('request:fixed')])).toBe(deadline)
    for (const invalid of [NaN, Infinity, -1, 0, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        f.store.transaction(['challenge:invalid', 'grant:partial'], async (tx) => {
          await tx.put('grant:partial', { revoked: true })
          await tx.put('challenge:invalid', { expires_at: invalid })
        })
      ).rejects.toThrow('INVALID_CONTROL_EXPIRY')
      expect(await f.store.read('grant:partial')).toBeNull()
    }
    await expect(
      f.store.transaction(['challenge:expired', 'grant:partial'], async (tx) => {
        await tx.put('grant:partial', { revoked: true })
        await tx.put('challenge:expired', { expires_at: Date.now() - 1 })
      })
    ).rejects.toThrow('control_transaction_conflict')
    expect(await f.store.read('grant:partial')).toBeNull()
  } finally {
    await f.dispose()
  }
})
