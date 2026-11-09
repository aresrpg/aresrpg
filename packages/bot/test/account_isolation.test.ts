// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import type { HostedChallengeResponse, HostedAuthorizeResponse } from '@aresrpg/protocol'

import type { Bot } from '../src/model.ts'
import type { ControlStore } from '../src/store.ts'
import { hash_secret, random_secret } from '../src/security.ts'
import { empty_lane, lane_key_for, type Command } from '../src/control.ts'

import { create_http_fixture } from './helpers/http_fixture.ts'
import { fixture_bot, memory_store, put } from './helpers/control_fixture.ts'
import { plan } from './helpers/profession_fixture.ts'

const other_google = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
const other_bot: Bot = {
  ...fixture_bot,
  id: 'other-bot',
  owner: other_google.toSuiAddress(),
  zklogin_public_identifier: other_google.toBase64(),
  address: `0x${'b'.repeat(64)}`,
  multisig_public_key: 'other-public-descriptor',
}
const browser_session = async (store: ControlStore, bot: Bot) => {
  const f = create_http_fixture(store, undefined, async (grant) => ({ bot_id: grant.bot_id, grant_id: grant.id }))
  const client = await f.json<{ client_id: string }>('/oauth/register', {
    client_name: 'Synthetic connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const started = await f.request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope: f.config.scopes.join(' '),
      resource: f.config.resource,
      state: 'fixture',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })}`
  )
  const authorization_id = new URL(started.headers.get('location')!).searchParams.get('authorization_id')!
  const identity = { authorization_id, owner: bot.owner, zklogin_public_identifier: bot.zklogin_public_identifier }
  const challenge = await f.json<HostedChallengeResponse>('/connect/challenge', { ...identity, purpose: 'session' })
  await f.json('/connect/verify', { challenge_id: challenge.challenge_id, signature: f.signature(challenge.message) })
  const consent_input = (selected: Bot) => ({
    ...identity,
    purpose: 'consent',
    bot_id: selected.id,
    generation: selected.generation,
    address: selected.address,
    multisig_public_key: selected.multisig_public_key,
    policy_revision: selected.policy.revision,
  })
  const tokens = async () => {
    const consent = await f.json<HostedChallengeResponse>('/connect/challenge', consent_input(bot))
    const authorized = await f.json<HostedAuthorizeResponse>('/connect/authorize', {
      challenge_id: consent.challenge_id,
      signature: f.signature(consent.message),
    })
    return f.json<{ access_token: string; refresh_token: string }>('/oauth/token', {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code: new URL(authorized.redirect_url).searchParams.get('code'),
      redirect_uri: 'https://client.example.test/callback',
      code_verifier: verifier,
      resource: f.config.resource,
    })
  }
  return { ...f, bot, identity, client, consent_input, tokens }
}
const accounts = async () => {
  const store = memory_store()
  for (const bot of [fixture_bot, other_bot]) {
    await put(store, `bot:${bot.id}`, bot)
    await put(store, `account:${bot.owner}`, {
      owner: bot.owner,
      zklogin_public_identifier: bot.zklogin_public_identifier,
      bot_ids: [bot.id],
    })
  }
  return { store, alice: await browser_session(store, fixture_bot), bob: await browser_session(store, other_bot) }
}
const pairing = (bot: Bot) => ({
  version: 1,
  network: 'mainnet',
  nonce: '11111111-1111-4111-8111-111111111111',
  owner: bot.owner,
  zklogin_public_identifier: bot.zklogin_public_identifier,
})

test('HTTP owner sessions cannot list, provision, consent or request proof for another account', async () => {
  const { store, alice, bob } = await accounts()
  const list = await alice.json<{ bots: { id: string }[] }>(
    `/connect/bots?authorization_id=${alice.identity.authorization_id}`
  )
  expect(list.bots.map((bot) => bot.id)).toEqual([fixture_bot.id])
  for (const path of ['/connect/request', '/connect/bots']) {
    const reply = await alice.request(`${path}?authorization_id=${bob.identity.authorization_id}`)
    expect(reply.status).toBe(400)
  }
  expect((await alice.request('/connect/bots', { authorization_id: bob.identity.authorization_id })).status).toBe(400)
  expect((await alice.request('/connect/challenge', alice.consent_input(other_bot))).status).toBe(400)
  for (const request of [pairing(fixture_bot), pairing(other_bot)]) {
    const reply = await alice.request('/connect/proof', {
      authorization_id: alice.identity.authorization_id,
      bot_id: other_bot.id,
      request,
    })
    expect(reply.status).toBe(400)
  }
  expect(await store.scan_keys('provision:', 10)).toEqual([])
  expect(await store.scan_keys('proof:', 10)).toEqual([])
  expect(await store.scan_keys('grant:', 10)).toEqual([])
})

test('provisioning ignores claimed owners and supports multiple bots for the verified wallet', async () => {
  const { store, alice } = await accounts()
  for (const creation_id of ['first', 'second']) {
    const reply = await alice.request('/connect/bots', {
      authorization_id: alice.identity.authorization_id,
      creation_id,
      owner: other_bot.owner,
      bot_id: other_bot.id,
    })
    expect(reply.status).toBe(202)
  }
  const keys = await store.scan_keys('provision:', 10)
  expect(keys).toHaveLength(2)
  for (const key of keys) expect(await store.read(key)).toMatchObject({ owner: fixture_bot.owner })
})

const call = (f: ReturnType<typeof create_http_fixture>, token: string, name: string, args: object) =>
  f.json<{ result: { isError: boolean; structuredContent: Record<string, unknown> } }>(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    token
  )

test('HTTP tokens and MCP references cannot cross accounts or grants, including same-wallet connectors', async () => {
  const { store, alice, bob } = await accounts()
  const sibling = await browser_session(store, fixture_bot)
  const a = await alice.tokens()
  const b = await bob.tokens()
  const c = await sibling.tokens()
  const observed = await call(alice, a.access_token, 'bot_observe', {})
  expect(observed.result.structuredContent.bot_id).toBe(fixture_bot.id)
  expect((await call(bob, b.access_token, 'bot_observe', {})).result.structuredContent.bot_id).toBe(other_bot.id)
  const sibling_observation = await call(sibling, c.access_token, 'bot_observe', {})
  expect(sibling_observation.result.structuredContent.bot_id).toBe(fixture_bot.id)
  expect(sibling_observation.result.structuredContent.grant_id).not.toBe(observed.result.structuredContent.grant_id)
  const command_id = 'private-command'
  await put(store, `command:${command_id}`, {
    id: command_id,
    grant_id: observed.result.structuredContent.grant_id,
    bot_id: fixture_bot.id,
    kind: 'gather',
    status: 'completed',
  })
  for (const token of [b.access_token, c.access_token]) {
    expect((await call(bob, token, 'bot_status', { command_id })).result.structuredContent.error).toBe(
      'command_not_found'
    )
    expect(
      (await call(bob, token, 'bot_validate_plan', { plan, observation_command_id: command_id })).result.isError
    ).toBe(true)
  }
  const lane_key = lane_key_for(fixture_bot)
  await put(store, lane_key, {
    ...empty_lane(fixture_bot),
    lease_until: Date.now() + 60000,
    needs_resync: false,
    observed_at: Date.now(),
    observation_revision: 1,
  })
  const started = await call(alice, a.access_token, 'bot_start_profession', {
    idempotency_key: 'run',
    plan: { ...plan, deadline_ms: Date.now() + 60000 },
    decision_revision: 0,
    observation_revision: 1,
  })
  const run = started.result.structuredContent.run as { id: string }
  expect(run.id).toBeTruthy()
  for (const token of [b.access_token, c.access_token]) {
    expect((await call(bob, token, 'bot_profession_status', { run_id: run.id })).result.structuredContent.error).toBe(
      'profession_run_not_found'
    )
    expect(
      (
        await call(bob, token, 'bot_resume_profession', {
          run_id: run.id,
          decision_revision: 1,
          observation_revision: 1,
        })
      ).result.isError
    ).toBe(true)
  }
  expect(
    (await call(alice, a.access_token, 'bot_pause', { bot_id: other_bot.id })).result.structuredContent.error
  ).toBe('invalid_argument')
  expect(await store.read(lane_key_for(other_bot))).toBeNull()
  const forged = `${b.access_token.split('.')[0]}.${a.access_token.split('.')[1]}`
  expect((await alice.request('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, forged)).status).toBe(401)
  expect(
    (
      await alice.request('/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: b.refresh_token,
        client_id: alice.client.client_id,
        resource: alice.config.resource,
      })
    ).status
  ).toBe(400)
  expect((await call(sibling, c.access_token, 'bot_observe', {})).result.isError).toBe(false)
  expect((await store.read<Command>(`command:${command_id}`))?.bot_id).toBe(fixture_bot.id)
})

test('forged owner signatures and cross-browser proofs establish no owner session', async () => {
  const store = memory_store()
  const alice = create_http_fixture(store)
  const bob = create_http_fixture(store)
  const challenge = await alice.json<HostedChallengeResponse>('/connect/challenge', {
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  const body = { challenge_id: challenge.challenge_id, signature: alice.signature(challenge.message) }
  expect((await alice.request('/connect/verify', { ...body, signature: 'forged' })).status).toBe(400)
  expect((await bob.request('/connect/verify', body)).status).toBe(400)
  expect((await alice.request('/connect/bots', { authorization_id: challenge.authorization_id })).status).toBe(400)
  expect(await store.scan_keys('provision:', 10)).toEqual([])
  await alice.json('/connect/verify', body)
  expect((await alice.request('/connect/verify', body)).status).toBe(400)
})
