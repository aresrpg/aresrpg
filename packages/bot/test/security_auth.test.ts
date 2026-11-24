// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Authentication and authorization: OAuth, signed consent, browser sessions, the HTTP door, MCP and
// account isolation.
import { expect, test } from 'bun:test'

import { create_connect_service } from '../src/connect.ts'
import { create_control_service } from '../src/control.ts'
import { create_mcp_handler } from '../src/mcp.ts'
import { create_oauth_service } from '../src/oauth.ts'
import { random_secret, type Grant, type OwnerChallenge } from '../src/model.ts'

import {
  consented,
  connect_bot,
  fixture_bot,
  fixture_config,
  grant_of,
  http_fixture,
  memory_store,
  put,
} from './fixture.ts'

test('S1 PKCE binds redirect, resource, client and verifier; a code and a consent are single-use; a changed policy or audience refuses the token', async () => {
  const f = await consented()
  const url = await f.authorize()
  expect([url.searchParams.get('iss'), url.searchParams.get('state')]).toEqual([fixture_config.issuer, 'client-csrf'])
  const input = f.token_input(url.searchParams.get('code')!)
  await expect(f.oauth.exchange({ ...input, resource: 'https://attacker.test' })).rejects.toThrow()
  await expect(f.oauth.exchange({ ...input, code_verifier: random_secret() })).rejects.toThrow()
  const tokens = await f.oauth.exchange(input)
  expect((await f.oauth.authenticate(tokens.access_token)).bot_id).toBe(fixture_bot.id)
  await expect(f.oauth.exchange(input)).rejects.toThrow()
  await expect(f.authorize()).rejects.toThrow()
  const elsewhere = create_oauth_service(
    f.store,
    { ...fixture_config, resource: 'https://other.example.test/mcp' },
    () => f.clock.now
  )
  await expect(elsewhere.authenticate(tokens.access_token)).rejects.toThrow('invalid_token')
  await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, policy: { ...fixture_bot.policy, revision: 2 } })
  await expect(f.oauth.authenticate(tokens.access_token)).rejects.toThrow()
})

test('S2 refresh rotates, and a replayed refresh revokes the whole family', async () => {
  const f = await consented()
  const first = await f.oauth.exchange(f.token_input((await f.authorize()).searchParams.get('code')!))
  const refresh = {
    grant_type: 'refresh_token',
    refresh_token: first.refresh_token,
    client_id: f.client.client_id,
    resource: fixture_config.resource,
  }
  const second = await f.oauth.exchange(refresh)
  await expect(f.oauth.authenticate(first.access_token)).rejects.toThrow()
  expect((await f.oauth.authenticate(second.access_token)).owner).toBe(fixture_bot.owner)
  await expect(f.oauth.exchange(refresh)).rejects.toThrow()
  await expect(f.oauth.authenticate(second.access_token)).rejects.toThrow()
})

test('S3 a new authority generation, a wrong session, a cancelled request or a legacy allowance consent mints no grant', async () => {
  const f = await consented()
  const restored = create_connect_service(
    f.store,
    { ...fixture_config, authority_generation: 'replacement-generation' },
    async () => {},
    () => f.clock.now
  )
  await expect(restored.details(f.identity.authorization_id, f.started.session)).rejects.toThrow('invalid_session')
  await expect(
    restored.authorize(f.first.result.challenge_id, 'fixture-owner-proof', f.started.session)
  ).rejects.toThrow('invalid_challenge')
  await expect(
    f.connect.authorize(f.first.result.challenge_id, 'fixture-owner-proof', random_secret())
  ).rejects.toThrow('invalid_session')
  const key = `challenge:${f.first.result.challenge_id}`
  const proof = (await f.store.read<OwnerChallenge>(key))!
  const consent = { ...proof.consent!, budget_mist: '0' }
  const envelope = JSON.parse(proof.message.split('\n')[1]!)
  const message = `AresRPG hosted bot consent v1\n${JSON.stringify({ ...envelope, consent })}`
  await put(f.store, key, { ...proof, consent, message })
  await expect(f.authorize()).rejects.toThrow('invalid_consent')
  await f.connect.cancel(f.identity.authorization_id, f.started.session)
  await expect(f.authorize((await f.consent().catch(() => f.first)).result.challenge_id)).rejects.toThrow(
    'invalid_session'
  )
  expect(await f.store.scan_keys('grant:', 10)).toEqual([])
})

test('S4 signed consent binds the reviewed descriptor: a replacement before authorization is refused', async () => {
  const f = http_fixture()
  await expect(
    connect_bot(f, fixture_bot, async () => {
      await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, generation: fixture_bot.generation + 1 })
    })
  ).rejects.toThrow('HTTP 400')
})

test('40 HTTP consent and token reach MCP: initialize, list, observe without commands, identity without credentials, then revoke', async () => {
  let ready = false
  const f = http_fixture(undefined, undefined, async () =>
    ready ? { state: 'awaiting_ai', observation_revision: 7 } : { status: 'pending' }
  )
  const c = await connect_bot(f)
  const rpc = (body: object, token: string | undefined = c.access_token) =>
    f.json<{ result: { instructions: string; tools: unknown }; error?: { code: number } }>('/mcp', body, token)
  const initialized = await rpc({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25' },
  })
  for (const part of [
    'work in progress',
    'over the coming months',
    'https://discord.gg/aresrpg',
    'At first use',
    'Do not repeat it during normal play',
  ])
    expect(initialized.result.instructions).toContain(part)
  const listed = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  expect((listed.result.tools as { name: string }[]).some((tool) => tool.name === 'bot_observe')).toBe(true)
  expect((await f.call(c.access_token, 'bot_observe')).structuredContent).toEqual({ status: 'pending' })
  ready = true
  const observed = await f.call(c.access_token, 'bot_observe')
  expect(observed.structuredContent).toEqual({ state: 'awaiting_ai', observation_revision: 7 })
  expect(JSON.stringify(observed)).not.toContain('discord.gg')
  expect((await rpc({ jsonrpc: '1.0', id: 1, method: 'tools/list' })).error!.code).toBe(-32600)
  expect(await f.call(c.access_token, 'arbitrary_sign')).toMatchObject({
    isError: true,
    structuredContent: { error: 'unknown_tool' },
  })
  const parse = await f.ingress(
    new Request(`${f.config.issuer}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.access_token}` },
      body: '{"jsonrpc":',
    })
  )
  expect([parse.status, await parse.json()]).toEqual([
    400,
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  ])
  // S12: the identity derives from the current grant only and exposes no credential.
  expect((await f.call(c.access_token, 'bot_identity')).structuredContent).toEqual({
    owner: fixture_bot.owner,
    bot_id: fixture_bot.id,
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: fixture_bot.generation,
    grant_id: c.access_token.split('.')[0],
    network: 'mainnet',
    expires_at: expect.any(Number),
  })
  expect((await f.call(c.access_token, 'bot_identity', { owner: 'attacker' })).isError).toBe(true)
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
  await f.json('/oauth/revoke', { client_id: c.client_id, token: c.access_token })
  const denied = await f.request('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/list' }, c.access_token)
  expect(denied.status).toBe(401)
  expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=')
})

test('15 MCP arguments are checked once against each tool schema; reads and refusals create no command', async () => {
  const f = http_fixture(undefined, undefined, async (_grant, payload) => payload)
  const { access_token: token } = await connect_bot(f)
  const refused = (error = 'invalid_argument') => ({ isError: true, structuredContent: { error } })
  expect((await f.call(token, 'bot_observe', {})).structuredContent).toEqual({})
  for (const view of ['full', 'inventory', null])
    expect(await f.call(token, 'bot_observe', { view })).toMatchObject(refused())
  expect(await f.call(token, 'bot_observe', { idempotency_key: 'old' })).toMatchObject(refused())
  expect((await f.call(token, 'bot_inventory', { category: 'resource' })).structuredContent).toEqual({
    view: 'inventory',
    category: 'resource',
  })
  expect((await f.call(token, 'bot_item_stacks', { item_type: 'wheat', limit: 5 })).structuredContent).toEqual({
    view: 'stacks',
    item_type: 'wheat',
    limit: 5,
  })
  expect((await f.call(token, 'bot_zones', { nearby: true, mobs: true })).structuredContent).toEqual({
    view: 'zones',
    nearby: true,
    mobs: true,
  })
  for (const [name, args] of [
    ['bot_item_stacks', {}],
    ['bot_item_stacks', { item_type: 'wheat', limit: 0 }],
    ['bot_item_stacks', { item_type: 'wheat', limit: 201 }],
    ['bot_zones', { mobs: 'yes' }],
    ['bot_observe', { spells: null }],
    ['bot_observe', { spells: [1] }],
    ['bot_observe', { spells: [''] }],
  ] as const)
    expect(await f.call(token, name, args)).toMatchObject(refused())
  expect((await f.call(token, 'bot_observe', { spells: ['Tricky Trap', 'Tricky Trap'] })).structuredContent).toEqual({
    spells: ['Tricky Trap'],
  })
  expect(await f.call(token, 'bot_observe', { spells: ['invented spell'] })).toMatchObject(
    refused('unknown_combat_spell')
  )
  expect(await f.call(token, 'bot_observe', { recipes: ['invented recipe'] })).toMatchObject(refused('unknown_recipe'))
  const fight_plan = {
    character_id: `0x${'2'.repeat(64)}`,
    fight: `0x${'3'.repeat(64)}`,
    fighter_idx: '0',
    checkpoint_id: 'observed',
    actions: [],
  }
  expect((await f.call(token, 'bot_observe', { fight_plan })).structuredContent).toEqual({ fight_plan })
  // The market is read by bot_market alone; bot_observe no longer takes a market or a price question.
  for (const args of [{ market: null }, { market: { kind: 'types', request: 0 } }, { prices: null }])
    expect(await f.call(token, 'bot_observe', args)).toMatchObject(refused())
  expect(
    (await f.call(token, 'bot_market', { item_type: 'wheat', limit: 50, history: true })).structuredContent
  ).toEqual({ view: 'market', item_type: 'wheat', limit: 50, history: true })
  for (const args of [
    { item_type: 'Wheat' },
    { item_type: '' },
    { limit: 0 },
    { limit: 201 },
    { heroes: 'yes' },
    { request: 1 },
    { kind: 'offers' },
  ])
    expect(await f.call(token, 'bot_market', args)).toMatchObject(refused())
  for (const plan of [null, { ...fight_plan, actions: [{ type: 'end_turn' }] }])
    expect((await f.call(token, 'bot_observe', { fight_plan: plan })).isError).toBe(true)
  // A gameplay tool refuses an unknown field, a malformed id and an action of another kind.
  const envelope = { idempotency_key: 'k', decision_revision: 0, observation_revision: 0 }
  expect(await f.call(token, 'bot_gather', { ...envelope, action: {}, extra: 1 })).toMatchObject(refused())
  expect(
    await f.call(token, 'bot_fight_forfeit', { ...envelope, action: { character_id: 'not-an-id' } })
  ).toMatchObject(refused('invalid_gameplay_payload'))
  expect(await f.call(token, 'bot_resume', { decision_revision: -1, observation_revision: 0 })).toMatchObject(refused())
  // Without an observation runtime a read is refused as such, never answered from storage.
  expect(await http_fixture(f.store).call(token, 'bot_observe')).toMatchObject(refused('observation_unavailable'))
  expect(await f.store.scan_keys('command:', 100)).toEqual([])
})

test('S10 S11 a changed bot, a legacy allowance or a revoked grant answers 401; a missing scope names it; recovery answers 503 and keeps the grant', async () => {
  const f = http_fixture()
  const c = await connect_bot(f)
  const list = () => f.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, c.access_token)
  const key = `grant:${c.access_token.split('.')[0]}`
  const grant = (await f.store.read<Grant>(key))!
  await put(f.store, key, { ...grant, scopes: ['bot:observe'] })
  const scoped = await f.call(c.access_token, 'bot_pause')
  const challenge = (scoped._meta as Record<string, string[]>)['mcp/www_authenticate']![0]!
  for (const part of ['error="insufficient_scope"', 'error_description=', 'scope="bot:pause"'])
    expect(challenge).toContain(part)
  await put(f.store, key, grant)
  for (const patch of [
    { id: 'different-bot' },
    { owner: 'foreign-owner' },
    { address: 'foreign-address' },
    { multisig_public_key: 'foreign-descriptor' },
    { generation: 2 },
    { status: 'paused' as const },
  ]) {
    await put(f.store, `bot:${fixture_bot.id}`, { ...fixture_bot, ...patch })
    expect([Object.keys(patch)[0], (await list()).status]).toEqual([Object.keys(patch)[0], 401])
  }
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  const recovering = http_fixture(f.store, { ...fixture_config, recovery_mode: true })
  const reply = await recovering.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, c.access_token)
  expect([reply.status, reply.headers.get('WWW-Authenticate'), await reply.json()]).toEqual([
    503,
    null,
    { error: 'service_unavailable' },
  ])
  const mcp = create_mcp_handler(
    create_control_service(f.store, { ...fixture_config, recovery_mode: true }, 60000),
    true,
    'metadata'
  )
  const answer = (await mcp(grant, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'bot_pause', arguments: {} },
  })) as {
    result: { structuredContent: { error: string }; _meta?: unknown }
  }
  expect([answer.result.structuredContent.error, answer.result._meta]).toEqual(['service_unavailable', undefined])
  expect((await list()).status).toBe(200)
  await put(f.store, key, { ...grant, budget_mist: '0' })
  expect((await list()).status).toBe(401)
  const refresh = {
    grant_type: 'refresh_token',
    refresh_token: c.refresh_token,
    client_id: c.client_id,
    resource: f.config.resource,
  }
  expect((await f.request('/oauth/token', refresh)).status).toBe(401)
  await put(f.store, key, { ...grant, revoked: true })
  const revoked = await list()
  expect([revoked.status, revoked.headers.get('WWW-Authenticate')?.includes('invalid_token')]).toEqual([401, true])
})

test('S11 each tool declares its scope once; a tool reads only when that scope is observe', async () => {
  const mcp = create_mcp_handler(create_control_service(memory_store(), fixture_config, 60000), true, 'metadata')
  const listed = (await mcp(grant_of(fixture_bot), { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: {
      tools: {
        name: string
        annotations: { readOnlyHint: boolean; destructiveHint: boolean }
        securitySchemes: { scopes: string[] }[]
      }[]
    }
  }
  const reads = listed.result.tools.filter(({ annotations }) => annotations.readOnlyHint).map(({ name }) => name)
  expect(reads.toSorted()).toEqual(
    [
      'bot_identity',
      'bot_observe',
      'bot_inventory',
      'bot_item_stacks',
      'bot_zones',
      'bot_market',
      'bot_arenas',
      'bot_status',
      'bot_behavior_status',
      'bot_validate_behavior',
      'bot_validate_combat_profile',
    ].toSorted()
  )
  for (const { name, annotations, securitySchemes } of listed.result.tools) {
    const observe = securitySchemes[0]!.scopes[0] === 'bot:observe'
    expect([name, annotations.readOnlyHint, annotations.destructiveHint]).toEqual([name, observe, !observe])
  }
  const off = create_mcp_handler(create_control_service(memory_store(), fixture_config, 60000), false, 'metadata')
  const play_off = (await off(grant_of(fixture_bot), { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as typeof listed
  expect(play_off.result.tools.every(({ securitySchemes }) => securitySchemes[0]!.scopes[0] !== 'bot:play')).toBe(true)
})
