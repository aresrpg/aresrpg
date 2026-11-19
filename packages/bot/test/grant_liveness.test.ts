// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { READ_ONLY_TOOLS } from '@aresrpg/protocol/hosted-bot-client'

import { assert_live_grant, type Grant } from '../src/model.ts'
import { create_mcp_handler } from '../src/mcp.ts'
import { create_control_service } from '../src/control.ts'
import { hash_secret } from '../src/security.ts'

import { fixture_bot, fixture_config, memory_store, put } from './helpers/control_fixture.ts'
import { create_http_fixture } from './helpers/http_fixture.ts'

const grant: Grant = {
  id: 'grant',
  authority_generation: fixture_config.authority_generation,
  owner: fixture_bot.owner,
  client_id: 'client',
  bot_id: fixture_bot.id,
  network: 'mainnet',
  address: fixture_bot.address,
  descriptor: fixture_bot.multisig_public_key,
  generation: fixture_bot.generation,
  resource: fixture_config.resource,
  scopes: fixture_config.scopes,
  policy_revision: fixture_bot.policy.revision,
  revoked: false,
  code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
  family: null,
  access: null,
}
const refusal = (config = fixture_config, current: Grant = grant) => {
  try {
    assert_live_grant(config, current, fixture_bot, 1000)
    return null
  } catch (error) {
    return (error as Error).message
  }
}

test('recovery mode is a service state a client keeps its grant through; the three grant faults stay invalid', () => {
  expect(refusal()).toBeNull()
  // A service-wide temporary state says nothing about the grant.
  expect(refusal({ ...fixture_config, recovery_mode: true })).toBe('service_unavailable')
  expect(refusal(fixture_config, { ...grant, revoked: true })).toBe('invalid_token')
  expect(refusal(fixture_config, { ...grant, authority_generation: 'older' })).toBe('invalid_token')
  expect(refusal(fixture_config, { ...grant, budget_mist: '1' } as Grant)).toBe('invalid_token')
  // The service state is reported first: it never reveals or decides a grant's validity.
  expect(refusal({ ...fixture_config, recovery_mode: true }, { ...grant, revoked: true })).toBe('service_unavailable')
})

test('recovery answers 503 without a re-authorization challenge and a tool call names the same state', async () => {
  const store = memory_store()
  const [id, secret] = ['g'.repeat(43), 's'.repeat(43)]
  const live = { ...grant, id, access: { hash: hash_secret(secret), expires_at: Date.now() + 60_000 } }
  const token = `${id}.${secret}`
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  await put(store, `grant:${id}`, live)
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
  expect((await create_http_fixture(store).request('/mcp', list, token)).status).toBe(200)
  const recovering = { ...fixture_config, recovery_mode: true }
  const reply = await create_http_fixture(store, recovering).request('/mcp', list, token)
  expect(reply.status).toBe(503)
  expect(reply.headers.get('WWW-Authenticate')).toBeNull()
  expect(await reply.json()).toEqual({ error: 'service_unavailable' })
  // A revoked grant is still told to re-authorize once the service is back.
  await put(store, `grant:${id}`, { ...live, revoked: true })
  const revoked = await create_http_fixture(store).request('/mcp', list, token)
  expect(revoked.status).toBe(401)
  expect(revoked.headers.get('WWW-Authenticate')).toContain('invalid_token')
  const control = create_control_service(store, recovering, 60000, () => 1000)
  const mcp = create_mcp_handler(control, true, 'metadata')
  const call = { name: 'bot_pause', arguments: {} }
  const answer = (await mcp(live, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: call })) as {
    result: { structuredContent: { error: string }; _meta?: unknown }
  }
  expect(answer.result.structuredContent.error).toBe('service_unavailable')
  expect(answer.result._meta).toBeUndefined()
})

test('a tool is read-only in one place: the list clients resend from, checked against each tool scope', async () => {
  const control = create_control_service(memory_store(), fixture_config, 60000, () => 1000)
  const mcp = create_mcp_handler(control, true, 'metadata')
  const listed = (await mcp(grant, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    result: {
      tools: readonly Readonly<{
        name: string
        annotations: { readOnlyHint: boolean; destructiveHint: boolean }
        securitySchemes: readonly { scopes: readonly string[] }[]
      }>[]
    }
  }
  const { tools } = listed.result
  const hinted = tools.filter(({ annotations }) => annotations.readOnlyHint).map(({ name }) => name)
  expect(hinted.toSorted()).toEqual([...READ_ONLY_TOOLS].toSorted())
  // A tool's scope is declared beside the tool, independently of the list: a read needs only
  // observe, and a tool that needs play or pause must never be resent.
  for (const { name, annotations, securitySchemes } of tools) {
    const reads = securitySchemes[0]!.scopes[0] === 'bot:observe'
    expect([name, READ_ONLY_TOOLS.has(name), annotations.destructiveHint]).toEqual([name, reads, !reads])
  }
})
