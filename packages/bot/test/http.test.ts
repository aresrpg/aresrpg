// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedChallengeResponse, HostedAuthorizeResponse } from '@aresrpg/protocol'

import type { Observe } from '../src/control.ts'
import { hash_secret, random_secret } from '../src/security.ts'

import { create_http_fixture } from './helpers/http_fixture.ts'
import { fixture_bot, memory_store, put } from './helpers/control_fixture.ts'

const authenticated_http = async (
  before_authorize = async (_fixture: ReturnType<typeof create_http_fixture>) => {},
  observe?: Observe
) => {
  const f = create_http_fixture(undefined, undefined, observe)
  const client = await f.json<{ client_id: string }>('/oauth/register', {
    client_name: 'Fixture connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const redirect = await f.request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope: f.config.scopes.join(' '),
      resource: f.config.resource,
      state: 'fixture-state',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })}`
  )
  const authorization_id = new URL(redirect.headers.get('location')!).searchParams.get('authorization_id')!
  const identity = {
    authorization_id,
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  }
  const challenge = await f.json<HostedChallengeResponse>('/connect/challenge', { ...identity, purpose: 'session' })
  await f.json('/connect/verify', { challenge_id: challenge.challenge_id, signature: f.signature(challenge.message) })
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = await f.json<HostedChallengeResponse>('/connect/challenge', {
    ...identity,
    purpose: 'consent',
    bot_id: fixture_bot.id,
    generation: fixture_bot.generation,
    address: fixture_bot.address,
    multisig_public_key: fixture_bot.multisig_public_key,
    policy_revision: fixture_bot.policy.revision,
  })
  await before_authorize(f)
  const authorized = await f.json<HostedAuthorizeResponse>('/connect/authorize', {
    challenge_id: consent.challenge_id,
    signature: f.signature(consent.message),
  })
  const code = new URL(authorized.redirect_url).searchParams.get('code')!
  const tokens = await f.json<{ access_token: string; refresh_token: string }>('/oauth/token', {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: 'https://client.example.test/callback',
    code_verifier: verifier,
    resource: f.config.resource,
  })
  return { ...f, ...tokens, client }
}

test('real HTTP handlers issue exact consent and OAuth token, MCP returns direct live observations without commands', async () => {
  let ready = false
  const f = await authenticated_http(undefined, async () =>
    ready ? { state: 'awaiting_ai', observation_revision: 7 } : { status: 'pending' }
  )
  const initialized = await f.json<{ result: { instructions: string } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    },
    f.access_token
  )
  expect(initialized.result.instructions).toContain('work in progress')
  expect(initialized.result.instructions).toContain('over the coming months')
  expect(initialized.result.instructions).toContain('https://discord.gg/aresrpg')
  expect(initialized.result.instructions).toContain('At first use')
  expect(initialized.result.instructions).toContain('Do not repeat it during normal play')
  const listed = await f.json<{ result: { tools: { name: string }[] } }>(
    '/mcp',
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    f.access_token
  )
  expect(listed.result.tools.some((tool) => tool.name === 'bot_observe')).toBe(true)
  const accepted = await f.json<{ result: { structuredContent: { status: string } } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'bot_observe', arguments: {} },
    },
    f.access_token
  )
  expect(accepted.result.structuredContent).toEqual({ status: 'pending' })
  ready = true
  const observed = await f.json<{ result: { structuredContent: unknown } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'bot_observe', arguments: {} },
    },
    f.access_token
  )
  expect(observed.result.structuredContent).toEqual({ state: 'awaiting_ai', observation_revision: 7 })
  expect(JSON.stringify(observed)).not.toContain('discord.gg')
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
  await f.json('/oauth/revoke', { client_id: f.client.client_id, token: f.access_token })
  const denied = await f.request('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/list' }, f.access_token)
  expect(denied.status).toBe(401)
  expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=')
})

test('MCP protocol errors remain JSON-RPC and ordinary tool failures remain error results', async () => {
  const f = await authenticated_http()
  const invalid = await f.json<{ error: { code: number } }>(
    '/mcp',
    { jsonrpc: '1.0', id: 1, method: 'tools/list' },
    f.access_token
  )
  expect(invalid.error.code).toBe(-32600)
  const unknown = await f.json<{ result: { isError: boolean; structuredContent: { error: string } } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'arbitrary_sign', arguments: {} },
    },
    f.access_token
  )
  expect(unknown.result.isError).toBe(true)
  expect(unknown.result.structuredContent.error).toBe('unknown_tool')
})

test('browser Origin and actual streaming body size fail closed', async () => {
  const f = create_http_fixture()
  const denied = await f.ingress(
    new Request(`${f.config.issuer}/connect/challenge`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      body: '{}',
    })
  )
  expect(denied.status).toBe(403)
  const oversized = await f.request('/oauth/register', { payload: 'x'.repeat(f.config.max_body_bytes) })
  expect(oversized.status).toBe(400)
  expect(await oversized.json()).toEqual({ error: 'request_too_large' })
})

test('signed consent refuses a descriptor replacement between review and authorization', async () => {
  await expect(
    authenticated_http(async (f) => {
      await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, generation: fixture_bot.generation + 1 })
    })
  ).rejects.toThrow('HTTP 400')
})

test('malformed MCP JSON produces a JSON-RPC parse error, not an OAuth error', async () => {
  const f = await authenticated_http()
  const reply = await f.ingress(
    new Request(`${f.config.issuer}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${f.access_token}` },
      body: '{"jsonrpc":',
    })
  )
  expect(reply.status).toBe(400)
  expect(await reply.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
})

test('tool-level scope challenge includes provider relink description and required scope', async () => {
  const f = await authenticated_http()
  const key = `grant:${f.access_token.split('.')[0]}`
  const grant = await f.store.read<import('../src/model.ts').Grant>(key)
  await put(f.store, key, { ...grant!, scopes: ['bot:observe'] })
  const reply = await f.json<{ result: { isError: boolean; _meta: Record<string, string[]> } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'bot_pause', arguments: {} },
    },
    f.access_token
  )
  expect(reply.result.isError).toBe(true)
  const challenge = reply.result._meta['mcp/www_authenticate']![0]!
  expect(challenge).toContain('error="insufficient_scope"')
  expect(challenge).toContain('error_description=')
  expect(challenge).toContain('scope="bot:pause"')
})

test('authenticated token refuses a bot record substituted under another bot ID', async () => {
  const f = await authenticated_http()
  await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, id: 'different-bot' })
  const reply = await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, f.access_token)
  expect(reply.status).toBe(401)
})

for (const patch of [
  { owner: 'foreign-owner' },
  { address: 'foreign-address' },
  { multisig_public_key: 'foreign-descriptor' },
  { generation: 2 },
  { status: 'paused' as const },
]) {
  test(`HTTP token rejects changed bot binding ${Object.keys(patch)[0]}`, async () => {
    const f = await authenticated_http()
    await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, ...patch })
    expect((await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, f.access_token)).status).toBe(401)
  })
}

test('legacy allowance consent cannot silently become an unrestricted access token', async () => {
  const f = await authenticated_http()
  const key = `grant:${f.access_token.split('.')[0]}`
  const grant = await f.store.read<import('../src/model.ts').Grant>(key)
  await put(f.store, key, { ...grant!, budget_mist: '0' })
  expect((await f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, f.access_token)).status).toBe(401)
  expect(
    (
      await f.request('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: f.refresh_token,
        client_id: f.client.client_id,
        resource: f.config.resource,
      })
    ).status
  ).toBe(401)
})

test('health rejects a lost durable store instead of advertising a healthy service', async () => {
  const store = memory_store()
  let disconnected = false
  const f = create_http_fixture({
    ...store,
    read: async (key) => {
      if (disconnected) throw new Error('Redis connection closed')
      return store.read(key)
    },
  })
  expect((await f.request('/health')).status).toBe(200)
  disconnected = true
  const unhealthy = await f.request('/health')
  expect(unhealthy.status).toBe(503)
  expect(await unhealthy.json()).toEqual({ error: 'storage_unavailable' })
})

test('MCP reports unavailable observation runtime and rejects retired command parameters', async () => {
  const f = await authenticated_http()
  for (const [args, error] of [
    [{}, 'observation_unavailable'],
    [{ idempotency_key: 'old' }, 'invalid_argument'],
  ] as const) {
    const reply = await f.json<{ result: { isError: boolean; structuredContent: { error: string } } }>(
      '/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'bot_observe', arguments: args },
      },
      f.access_token
    )
    expect(reply.result.isError).toBe(true)
    expect(reply.result.structuredContent.error).toBe(error)
  }
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
})

test('MCP forwards changes view and its cursor pair while rejecting invalid view types', async () => {
  const f = await authenticated_http(undefined, async (_grant, payload) => payload)
  const call = async (args: unknown) =>
    f.json<{ result: { isError: boolean; structuredContent: unknown } }>(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bot_observe', arguments: args } },
      f.access_token
    )
  const payload = { view: 'changes', after_cursor: 8, after_fence: 2 }
  expect((await call(payload)).result.structuredContent).toEqual(payload)
  for (const view of ['unknown', ['changes'], null, 1]) {
    expect((await call({ view })).result).toMatchObject({
      isError: true,
      structuredContent: { error: 'invalid_argument' },
    })
  }
})

test('MCP forwards spell discovery and rejects invalid or unknown spell IDs', async () => {
  const f = await authenticated_http(undefined, async (_grant, payload) => payload)
  const call = async (spells: unknown) =>
    f.json<{ result: { isError: boolean; structuredContent: unknown } }>(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bot_observe', arguments: { spells } } },
      f.access_token
    )
  expect((await call([])).result.structuredContent).toEqual({ spells: [] })
  expect((await call(['Tricky Trap', 'Tricky Trap'])).result.structuredContent).toEqual({ spells: ['Tricky Trap'] })
  for (const spells of [null, 'Tricky Trap', [1], ['']])
    expect((await call(spells)).result).toMatchObject({
      isError: true,
      structuredContent: { error: 'invalid_argument' },
    })
  expect((await call(['invented spell'])).result).toMatchObject({
    isError: true,
    structuredContent: { error: 'unknown_combat_spell' },
  })
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
})

test('MCP forwards read-only fight prefixes and rejects malformed or changes-only planning', async () => {
  const f = await authenticated_http(undefined, async (_grant, payload) => payload)
  const fight_plan = {
    character_id: `0x${'2'.repeat(64)}`,
    fight: `0x${'3'.repeat(64)}`,
    fighter_idx: '0',
    checkpoint_id: 'observed',
    actions: [],
  }
  const call = async (args: unknown) =>
    f.json<{ result: { isError: boolean; structuredContent: unknown } }>(
      '/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'bot_observe', arguments: args } },
      f.access_token
    )
  expect((await call({ fight_plan })).result.structuredContent).toEqual({ fight_plan })
  for (const args of [
    { fight_plan: null },
    { fight_plan: { ...fight_plan, actions: [{ type: 'end_turn' }] } },
    { view: 'changes', fight_plan },
  ])
    expect((await call(args)).result.isError).toBe(true)
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
})
