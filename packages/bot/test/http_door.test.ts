// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedChallengeResponse } from '@aresrpg/protocol'
import { hosted_keys } from '@aresrpg/protocol/hosted-keys'
import { create_request_limiter } from '@aresrpg/protocol/request-limiter'
import { create_telegram_access } from '@aresrpg/protocol/telegram-access'

import type { Grant } from '../src/model.ts'
import { hash_secret, random_secret } from '../src/security.ts'

import { create_http_fixture } from './helpers/http_fixture.ts'
import { fixture_bot, put } from './helpers/control_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'

type Fixture = ReturnType<typeof create_http_fixture>
const identity = { owner: fixture_bot.owner, zklogin_public_identifier: fixture_bot.zklogin_public_identifier }
const challenge = (f: Fixture) =>
  f.json<HostedChallengeResponse>('/connect/challenge', { ...identity, purpose: 'session' })
const join = (f: Fixture, authorization_id: string, extra: Readonly<Record<string, unknown>> = {}) =>
  f.request('/connect/waitlist', { authorization_id, ...extra })
const error_of = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error]

test('the waitlist stores only the owner a signed session proved, never an address the caller names', async () => {
  const f = create_http_fixture()
  expect(await error_of(await join(f, random_secret()))).toEqual([400, 'invalid_session'])
  const started = await challenge(f)
  // A session that was opened but never signed proves nothing.
  expect(await error_of(await join(f, started.authorization_id))).toEqual([400, 'owner_authentication_required'])
  const forged = await f.request('/connect/verify', { challenge_id: started.challenge_id, signature: 'forged' })
  expect(forged.status).toBe(400)
  expect(await error_of(await join(f, started.authorization_id))).toEqual([400, 'owner_authentication_required'])
  expect(f.waitlisted).toEqual([])
  await f.json('/connect/verify', { challenge_id: started.challenge_id, signature: f.signature(started.message) })
  const joined = await join(f, started.authorization_id, { owner: `0x${'9'.repeat(64)}` })
  expect([joined.status, await joined.json()]).toEqual([200, { joined: true }])
  expect(f.waitlisted).toEqual([fixture_bot.owner])
  // The session cookie is the proof: the same request without it, or from another site, is refused.
  const request = (headers: Record<string, string>) =>
    f.ingress(
      new Request(`${f.config.issuer}/connect/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ authorization_id: started.authorization_id }),
      })
    )
  expect(await error_of(await request({ origin: f.config.web_origin }))).toEqual([400, 'invalid_session'])
  expect(await error_of(await request({ origin: 'https://evil.example', cookie: f.cookie() }))).toEqual([
    403,
    'invalid_origin',
  ])
  expect(await error_of(await request({ cookie: f.cookie() }))).toEqual([403, 'invalid_origin'])
  expect(f.waitlisted).toEqual([fixture_bot.owner])
})

test('a visitor gets one allowance for every unauthenticated request; our own services and health probes are never refused', async () => {
  const f = create_http_fixture(undefined, undefined, undefined, {
    visitor_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
  })
  const from = (address: string | null, path: string, body?: unknown) =>
    f.ingress(
      new Request(`${f.config.issuer}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          origin: f.config.web_origin,
          ...(address ? { 'cf-connecting-ip': address } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    )
  const session = { ...identity, purpose: 'session' }
  expect((await from('10.0.0.1', '/connect/challenge', session)).status).toBe(200)
  expect((await from('10.0.0.1', '/connect/waitlist', { authorization_id: random_secret() })).status).toBe(400)
  const refused = await from('10.0.0.1', '/connect/waitlist', { authorization_id: random_secret() })
  expect(await error_of(refused)).toEqual([429, 'rate_limited'])
  expect(refused.headers.get('access-control-allow-origin')).toBe(f.config.web_origin)
  expect(await error_of(await from('10.0.0.1', '/oauth/token', {}))).toEqual([429, 'rate_limited'])
  expect((await from('10.0.0.1', '/health')).status).toBe(200)
  expect((await from('10.0.0.2', '/connect/challenge', session)).status).toBe(200)
  // A request the edge did not carry is one of our own services: no allowance is taken or shared.
  for (const _ of [1, 2, 3]) expect((await from(null, '/connect/challenge', session)).status).toBe(200)
  expect(f.waitlisted).toEqual([])
})

// Regression: `/mcp` skipped the visitor limiter and took an allowance only after a token verified, so a
// caller with random well-formed tokens could make the custody store do a lookup per request, unlimited.
test('an MCP call that fails authentication takes the visitor allowance', async () => {
  const f = create_http_fixture(undefined, undefined, undefined, {
    visitor_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
  })
  const guess = (address: string | null, authorization?: string) =>
    f.ingress(
      new Request(`${f.config.issuer}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
          ...(address ? { 'cf-connecting-ip': address } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    )
  const bearer = () => `Bearer ${random_secret()}.${random_secret()}`
  expect(await error_of(await guess('10.0.0.9', bearer()))).toEqual([401, 'invalid_token'])
  expect(await error_of(await guess('10.0.0.9'))).toEqual([401, 'invalid_token'])
  expect(await error_of(await guess('10.0.0.9', bearer()))).toEqual([429, 'rate_limited'])
  // Another visitor, and our own services inside the cluster, are not affected.
  expect(await error_of(await guess('10.0.0.8', bearer()))).toEqual([401, 'invalid_token'])
  for (const _ of [1, 2, 3]) expect(await error_of(await guess(null, bearer()))).toEqual([401, 'invalid_token'])
})

test('an authenticated MCP call is limited per verified owner, whatever address it comes from', async () => {
  const f = create_http_fixture(undefined, undefined, undefined, {
    visitor_limiter: create_request_limiter({ capacity: 1, now: () => 0 }),
    owner_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
  })
  const [id, secret] = [random_secret(), random_secret()]
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  await put(f.store, `grant:${id}`, {
    id,
    authority_generation: f.config.authority_generation,
    owner: fixture_bot.owner,
    client_id: 'client',
    bot_id: fixture_bot.id,
    network: fixture_bot.network,
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: fixture_bot.generation,
    resource: f.config.resource,
    scopes: ['bot:observe'],
    policy_revision: fixture_bot.policy.revision,
    revoked: false,
    code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
    family: null,
    access: { hash: hash_secret(secret), expires_at: Date.now() + 60_000 },
  } satisfies Grant)
  const list = () => f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `${id}.${secret}`)
  // The peer allowance of one never applies to MCP: a shared caller such as Telegram serves many owners.
  expect((await list()).status).toBe(200)
  expect((await list()).status).toBe(200)
  expect(await error_of(await list())).toEqual([429, 'rate_limited'])
  const unknown = await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `${id}.${random_secret()}`)
  expect(await error_of(unknown)).toEqual([401, 'invalid_token'])
})

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip
integration('a website join lands once on the Redis waitlist Telegram reads, and admits nobody', async () => {
  const redis = fixture_redis(url!)
  await redis.connect()
  const keys = hosted_keys('telegram', `telegram-test:${crypto.randomUUID()}`)
  // Two accessors on the same keys: the bot service writes, Telegram and the operator command read.
  const access = () =>
    create_telegram_access(
      (command, args) => redis.send(command, args),
      keys,
      () => 1234
    )
  const f = create_http_fixture(undefined, undefined, undefined, { join_waitlist: access().join })
  try {
    const started = await challenge(f)
    await f.json('/connect/verify', { challenge_id: started.challenge_id, signature: f.signature(started.message) })
    for (const _press of [1, 2]) expect((await join(f, started.authorization_id)).status).toBe(200)
    expect(await redis.send('TYPE', [keys.key('waitlist')])).toBe('zset')
    expect(await access().waiting()).toEqual([{ owner: fixture_bot.owner, joined_at: 1234 }])
    expect(await access().admitted(fixture_bot.owner)).toBe(false)
  } finally {
    await redis.send('DEL', [keys.key('waitlist')])
    redis.close()
  }
})
