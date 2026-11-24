// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The HTTP door: browser-bound sessions, origin and body limits, the request limiter and account isolation.
import { expect, spyOn, test } from 'bun:test'
import type { HostedChallengeResponse } from '@aresrpg/protocol'
import { create_request_limiter } from '@aresrpg/protocol/request-limiter'

import { create_behavior_control } from '../src/behavior_control.ts'
import { empty_lane, lane_key_for } from '../src/control.ts'
import { random_secret, type AuthorizationRequest, type Grant, type OwnerChallenge } from '../src/model.ts'

import {
  bearer_grant,
  begin_authorization,
  connect_bot,
  consent_input,
  fixture_bot,
  fixture_config,
  http_fixture,
  memory_store,
  other_bot,
  other_google,
  owner_session,
  put,
} from './fixture.ts'
import { character, resource } from './fixture_game.ts'

test('S5 browser-bound requests: parallel attempts, foreign or tampered cookies, a cancel of another attempt and expiry fail closed', async () => {
  const f = http_fixture()
  const details = (id: string) => f.request(`/connect/request?authorization_id=${id}`)
  const challenge = (id?: string) =>
    f.json<HostedChallengeResponse>('/connect/challenge', {
      authorization_id: id,
      purpose: 'session',
      owner: fixture_bot.owner,
      zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
    })
  const a = await begin_authorization(f)
  const proof = await challenge(a.authorization_id)
  const b = await begin_authorization(f)
  expect([(await details(a.authorization_id)).status, (await details(b.authorization_id)).status]).toEqual([200, 200])
  expect(a.cookie.split('=')[0] === b.cookie.split('=')[0]).toBe(false)
  // The cookie lives exactly as long as its request; a challenge cannot extend it.
  const request = (await f.store.read<AuthorizationRequest>(`request:${a.authorization_id}`))!
  const expiry = (value: string) => Date.parse(/Expires=([^;]+)/.exec(value)?.[1] ?? '')
  expect(expiry(a.header)).toBe(Math.floor(request.expires_at / 1000) * 1000)
  for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=None']) expect(a.header).toContain(attribute)
  const issued = await f.request('/connect/challenge', {
    authorization_id: a.authorization_id,
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  expect(expiry(issued.headers.get('set-cookie')!)).toBe(expiry(a.header))
  const verify = { challenge_id: proof.challenge_id, signature: f.signature(proof.message) }
  const name = a.cookie.split('=')[0]!
  for (const cookie of ['', b.cookie, `${name}=${random_secret()}`, `${name}=${b.cookie.split('=')[1]}`]) {
    expect((await f.raw(`/connect/request?authorization_id=${a.authorization_id}`, cookie)).status).toBe(400)
    expect((await f.raw('/connect/verify', cookie, verify)).status).toBe(400)
  }
  // A standalone setup neither displaces nor cancels a provider request.
  const standalone = await challenge()
  expect((await f.request('/connect/cancel', { authorization_id: standalone.authorization_id })).status).toBe(200)
  expect([(await details(b.authorization_id)).status, (await details(standalone.authorization_id)).status]).toEqual([
    200, 400,
  ])
  expect((await f.request('/connect/cancel', { authorization_id: a.authorization_id })).status).toBe(200)
  expect([(await details(b.authorization_id)).status, (await details(a.authorization_id)).status]).toEqual([200, 400])
  expect((await f.request('/connect/verify', verify)).status).toBe(400)
  const c = await begin_authorization(f)
  const late = await challenge(c.authorization_id)
  await f.store.transaction([`challenge:${late.challenge_id}`], async (tx) => {
    const record = (await tx.get<OwnerChallenge>(`challenge:${late.challenge_id}`))!
    await tx.put(`challenge:${late.challenge_id}`, { ...record, expires_at: Date.now() - 1 })
  })
  expect(
    (await f.request('/connect/verify', { challenge_id: late.challenge_id, signature: f.signature(late.message) }))
      .status
  ).toBe(400)
  // An expired request stays rejected with its cookie present, and leaves another request alone.
  const d = await begin_authorization(f)
  await f.store.transaction([`request:${d.authorization_id}`], async (tx) => {
    const record = (await tx.get<AuthorizationRequest>(`request:${d.authorization_id}`))!
    await tx.put(`request:${d.authorization_id}`, { ...record, expires_at: Date.now() - 1 })
  })
  expect([(await details(d.authorization_id)).status, (await details(b.authorization_id)).status]).toEqual([400, 200])
})

test('S5 a second request cannot substitute the consent client or its PKCE proof; one browser keeps two owners apart', async () => {
  const f = http_fixture()
  const a = await begin_authorization(f, 'bot:observe')
  const owner = await f.json<HostedChallengeResponse>('/connect/challenge', {
    authorization_id: a.authorization_id,
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  await f.json('/connect/verify', { challenge_id: owner.challenge_id, signature: f.signature(owner.message) })
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = await f.json<HostedChallengeResponse>(
    '/connect/challenge',
    consent_input(a.authorization_id, fixture_bot)
  )
  const b = await begin_authorization(f)
  const second = await f.json<HostedChallengeResponse>('/connect/challenge', {
    authorization_id: b.authorization_id,
    purpose: 'session',
    owner: other_google.toSuiAddress(),
    zklogin_public_identifier: other_google.toBase64(),
  })
  const verify_second = { challenge_id: second.challenge_id, signature: f.signature(second.message) }
  expect((await f.raw('/connect/verify', a.cookie, verify_second)).status).toBe(400)
  await f.json('/connect/verify', verify_second)
  expect((await f.json<{ owner: string }>(`/connect/bots?authorization_id=${a.authorization_id}`)).owner).toBe(
    fixture_bot.owner
  )
  expect((await f.json<{ owner: string }>(`/connect/bots?authorization_id=${b.authorization_id}`)).owner).toBe(
    other_google.toSuiAddress()
  )
  const body = { challenge_id: consent.challenge_id, signature: f.signature(consent.message) }
  expect((await f.raw('/connect/authorize', b.cookie, body)).status).toBe(400)
  expect((await f.request('/connect/cancel', { authorization_id: b.authorization_id })).status).toBe(200)
  const redirect = new URL((await f.json<{ redirect_url: string }>('/connect/authorize', body)).redirect_url)
  expect(redirect.origin + redirect.pathname).toBe('https://client.example.test/callback')
  const code = redirect.searchParams.get('code')!
  const grant = (await f.store.read<Grant>(`grant:${code.split('.')[0]}`))!
  expect([grant.client_id, grant.owner, grant.scopes]).toEqual([a.client_id, fixture_bot.owner, ['bot:observe']])
  const exchange = {
    grant_type: 'authorization_code',
    client_id: a.client_id,
    code,
    redirect_uri: 'https://client.example.test/callback',
    code_verifier: a.verifier,
    resource: f.config.resource,
  }
  expect((await f.request('/oauth/token', { ...exchange, client_id: b.client_id })).status).toBe(400)
  expect((await f.request('/oauth/token', { ...exchange, code_verifier: b.verifier })).status).toBe(400)
  expect((await f.request('/oauth/token', exchange)).status).toBe(200)
  expect((await f.request('/oauth/token', exchange)).status).toBe(400)
  expect((await f.request('/connect/authorize', body)).status).toBe(400)
})

test('S6 a foreign origin, an oversized streamed body and a lost store fail closed; rejections log only route, status and code', async () => {
  const store = memory_store()
  let disconnected = false
  const f = http_fixture({
    ...store,
    read: async (key) => (disconnected ? Promise.reject(new Error('Redis connection closed')) : store.read(key)),
  })
  const denied = await f.ingress(
    new Request(`${f.config.issuer}/connect/challenge`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: '{}',
    })
  )
  expect(denied.status).toBe(403)
  const oversized = await f.request('/oauth/register', { payload: 'x'.repeat(f.config.max_body_bytes) })
  expect([oversized.status, await oversized.json()]).toEqual([400, { error: 'request_too_large' }])
  const messages: unknown[][] = []
  const log = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    messages[messages.length] = args
  })
  try {
    const response = await f.raw('/connect/request?authorization_id=fixture-private-query', 'fixture-private-cookie')
    const body = (await response.json()) as { error: string }
    expect(messages).toEqual([
      ['Hosted request rejected', JSON.stringify({ path: '/connect/request', status: 400, code: body.error })],
    ])
    expect(JSON.stringify(messages)).not.toContain('fixture-private')
    expect((await f.request('/health')).status).toBe(200)
    disconnected = true
    const unhealthy = await f.request('/health')
    expect([unhealthy.status, await unhealthy.json()]).toEqual([503, { error: 'storage_unavailable' }])
  } finally {
    log.mockRestore()
  }
})

test('S7 one allowance per visitor, a failed MCP authentication takes it, an authenticated call is limited per owner', async () => {
  const f = http_fixture(undefined, undefined, undefined, {
    visitor_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
    owner_limiter: create_request_limiter({ capacity: 2, now: () => 0 }),
  })
  const error_of = async (response: Response) => [response.status, ((await response.json()) as { error: string }).error]
  const from = (address: string | null, path: string, body?: unknown, authorization?: string) =>
    f.ingress(
      new Request(`${f.config.issuer}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'content-type': 'application/json',
          ...(path === '/mcp' ? {} : { origin: f.config.web_origin }),
          ...(authorization ? { authorization } : {}),
          ...(address ? { 'cf-connecting-ip': address } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    )
  const session = {
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  }
  const forged = { challenge_id: random_secret(), signature: 'forged' }
  expect((await from('10.0.0.1', '/connect/challenge', session)).status).toBe(200)
  expect((await from('10.0.0.1', '/connect/verify', forged)).status).toBe(400)
  const refused = await from('10.0.0.1', '/connect/verify', forged)
  expect([await error_of(refused), refused.headers.get('access-control-allow-origin')]).toEqual([
    [429, 'rate_limited'],
    f.config.web_origin,
  ])
  expect(await error_of(await from('10.0.0.1', '/oauth/token', {}))).toEqual([429, 'rate_limited'])
  expect((await from('10.0.0.1', '/health')).status).toBe(200)
  expect((await from('10.0.0.2', '/connect/challenge', session)).status).toBe(200)
  // A request the edge did not carry is one of our own services: no allowance is taken or shared.
  for (const _ of [1, 2, 3]) expect((await from(null, '/connect/challenge', session)).status).toBe(200)
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
  const guess = () => `Bearer ${random_secret()}.${random_secret()}`
  expect(await error_of(await from('10.0.0.9', '/mcp', list, guess()))).toEqual([401, 'invalid_token'])
  expect(await error_of(await from('10.0.0.9', '/mcp', list))).toEqual([401, 'invalid_token'])
  expect(await error_of(await from('10.0.0.9', '/mcp', list, guess()))).toEqual([429, 'rate_limited'])
  for (const _ of [1, 2, 3])
    expect(await error_of(await from(null, '/mcp', list, guess()))).toEqual([401, 'invalid_token'])
  const { token } = await bearer_grant(f.store, { scopes: ['bot:observe'] })
  // The peer allowance never applies to MCP: a shared caller such as an AI provider serves many owners.
  for (const status of [200, 200]) expect((await from('10.0.0.9', '/mcp', list, `Bearer ${token}`)).status).toBe(status)
  expect(await error_of(await from('10.0.0.7', '/mcp', list, `Bearer ${token}`))).toEqual([429, 'rate_limited'])
})

test('S8 S9 accounts stay apart over HTTP and MCP; forged proofs establish no session; provisioning takes no caller identity', async () => {
  const store = memory_store()
  for (const bot of [fixture_bot, other_bot]) {
    await put(store, `bot:${bot.id}`, bot)
    await put(store, `account:${bot.owner}`, {
      owner: bot.owner,
      zklogin_public_identifier: bot.zklogin_public_identifier,
      bot_ids: [bot.id],
    })
  }
  const observe = async (grant: Grant) => ({ bot_id: grant.bot_id, grant_id: grant.id })
  const [alice, bob, sibling] = [
    http_fixture(store, undefined, observe),
    http_fixture(store, undefined, observe),
    http_fixture(store, undefined, observe),
  ]
  const setup = http_fixture(store)
  const owned = await owner_session(setup, fixture_bot)
  const theirs = await owner_session(http_fixture(store), other_bot)
  expect(
    (await setup.json<{ bots: { id: string }[] }>(`/connect/bots?authorization_id=${owned.authorization_id}`)).bots.map(
      ({ id }) => id
    )
  ).toEqual([fixture_bot.id])
  for (const path of ['/connect/request', '/connect/bots'])
    expect((await setup.request(`${path}?authorization_id=${theirs.authorization_id}`)).status).toBe(400)
  expect((await setup.request('/connect/bots', { authorization_id: theirs.authorization_id })).status).toBe(400)
  expect((await setup.request('/connect/challenge', consent_input(owned.authorization_id, other_bot))).status).toBe(400)
  const pairing = {
    version: 1,
    network: 'mainnet',
    nonce: '11111111-1111-4111-8111-111111111111',
    owner: other_bot.owner,
    zklogin_public_identifier: other_bot.zklogin_public_identifier,
  }
  expect(
    (
      await setup.request('/connect/proof', {
        authorization_id: owned.authorization_id,
        bot_id: other_bot.id,
        request: pairing,
      })
    ).status
  ).toBe(400)
  for (const fields of [{ creation_id: 'first' }, { owner: other_bot.owner }, { bot_id: other_bot.id }])
    expect((await setup.request('/connect/bots', { authorization_id: owned.authorization_id, ...fields })).status).toBe(
      400
    )
  const provisioned = () =>
    setup.json<{ bot: { id: string } }>('/connect/bots', { authorization_id: owned.authorization_id })
  expect([(await provisioned()).bot.id, (await provisioned()).bot.id]).toEqual([fixture_bot.id, fixture_bot.id])
  expect([(await store.scan_keys('provision:', 10)).length, await store.scan_keys('proof:', 10)]).toEqual([1, []])
  const a = await connect_bot(alice, fixture_bot)
  const b = await connect_bot(bob, other_bot)
  const c = await connect_bot(sibling, fixture_bot)
  const observed = await alice.call(a.access_token, 'bot_observe')
  expect((await bob.call(b.access_token, 'bot_observe')).structuredContent.bot_id).toBe(other_bot.id)
  const sibling_view = await sibling.call(c.access_token, 'bot_observe')
  expect([
    sibling_view.structuredContent.bot_id,
    sibling_view.structuredContent.grant_id === observed.structuredContent.grant_id,
  ]).toEqual([fixture_bot.id, false])
  await put(store, 'command:private-command', {
    id: 'private-command',
    grant_id: observed.structuredContent.grant_id,
    bot_id: fixture_bot.id,
    kind: 'gather',
    status: 'completed',
  })
  for (const token of [b.access_token, c.access_token])
    expect((await bob.call(token, 'bot_status', { command_id: 'private-command' })).structuredContent.error).toBe(
      'command_not_found'
    )
  await put(store, lane_key_for(fixture_bot), {
    ...empty_lane(fixture_bot),
    lease_until: Date.now() + 60000,
    needs_resync: false,
    observed_at: Date.now(),
    observation_revision: 1,
  })
  const grant = (await store.read<Grant>(`grant:${observed.structuredContent.grant_id}`))!
  const run = await create_behavior_control(store, fixture_config, Date.now).start_behavior(grant, {
    idempotency_key: 'alice-hero',
    decision_revision: 0,
    observation_revision: 1,
    script: {
      version: '1',
      objective: { title: 'Gather' },
      tree: {
        type: 'action',
        action: { type: 'gather', character_id: character.id, item_type: resource.item_type, order: 'nearest' },
      },
    },
  })
  const hero = { character_id: character.id }
  expect((await alice.call(a.access_token, 'bot_behavior_status', hero)).structuredContent.id).toBe(run.id)
  // Another account never reaches it; a second connector of the same wallet shares its owner's run.
  expect((await bob.call(b.access_token, 'bot_behavior_status', hero)).structuredContent.error).toBe(
    'behavior_run_not_found'
  )
  expect((await bob.call(b.access_token, 'bot_stop_behavior', hero)).isError).toBe(true)
  expect((await sibling.call(c.access_token, 'bot_stop_behavior', hero)).structuredContent.status).toBe('stopped')
  expect((await alice.call(a.access_token, 'bot_pause', { bot_id: other_bot.id })).structuredContent.error).toBe(
    'invalid_argument'
  )
  expect(await store.read(lane_key_for(other_bot))).toBeNull()
  const forged_token = `${b.access_token.split('.')[0]}.${a.access_token.split('.')[1]}`
  expect((await alice.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, forged_token)).status).toBe(401)
  const cross_refresh = {
    grant_type: 'refresh_token',
    refresh_token: b.refresh_token,
    client_id: a.client_id,
    resource: alice.config.resource,
  }
  expect((await alice.request('/oauth/token', cross_refresh)).status).toBe(400)
  // Forged and cross-browser owner proofs establish no session.
  const [x, y] = [http_fixture(store), http_fixture(store)]
  const proof = await x.json<HostedChallengeResponse>('/connect/challenge', {
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  const body = { challenge_id: proof.challenge_id, signature: x.signature(proof.message) }
  expect((await x.request('/connect/verify', { ...body, signature: 'forged' })).status).toBe(400)
  expect((await y.request('/connect/verify', body)).status).toBe(400)
  expect((await x.request('/connect/bots', { authorization_id: proof.authorization_id })).status).toBe(400)
  await x.json('/connect/verify', body)
  expect((await x.request('/connect/verify', body)).status).toBe(400)
})
