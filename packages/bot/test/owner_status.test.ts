// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { HostedChallengeResponse } from '@aresrpg/protocol'

import { empty_lane } from '../src/control.ts'
import type { Account, Grant } from '../src/model.ts'
import { read_owner_activity } from '../src/owner_activity.ts'
import { read_owner_status } from '../src/owner_status.ts'

import { authorize_fixture } from './oauth.test.ts'
import { create_http_fixture } from './helpers/http_fixture.ts'
import { fixture_bot, fixture_config, put } from './helpers/control_fixture.ts'

const owner_session = async () => {
  const f = create_http_fixture()
  const proof = await f.json<HostedChallengeResponse>('/connect/challenge', {
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  await f.json('/connect/verify', { challenge_id: proof.challenge_id, signature: f.signature(proof.message) })
  return { ...f, id: proof.authorization_id }
}

test('owner connection status requires proof and never infers authorization from a bot descriptor', async () => {
  const f = await owner_session()
  const response = await f.request(`/connect/status?authorization_id=${f.id}`)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ owner: fixture_bot.owner, status: 'disconnected', bot: null })
  expect((await f.request('/connect/status?authorization_id=invalid')).status).toBe(400)
})

const connected_fixture = async () => {
  const f = await owner_session()
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  await put(f.store, `account:${fixture_bot.owner}`, {
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
    bot_ids: [fixture_bot.id],
  })
  const grant: Grant = {
    id: 'status-grant',
    owner: fixture_bot.owner,
    bot_id: fixture_bot.id,
    client_id: 'client',
    authority_generation: fixture_config.authority_generation,
    network: 'mainnet',
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: 1,
    policy_revision: 1,
    resource: fixture_config.resource,
    scopes: fixture_config.scopes,
    revoked: false,
    code: {
      hash: 'private-code-hash',
      challenge: 'private-pkce',
      redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      expires_at: 0,
      used: true,
    },
    access: { hash: 'private-access-hash', expires_at: 0 },
    family: { hash: 'private-refresh-hash', expires_at: Date.now() + 60_000, generation: 1, used_hashes: [] },
  }
  await put(f.store, `grant:${grant.id}`, grant)
  const status = () => f.json(`/connect/status?authorization_id=${f.id}`)
  return { ...f, grant, status }
}

test('legacy authorization is indexed once and renewable access is distinct from presence', async () => {
  const f = await connected_fixture()
  const scan = spyOn(f.store, 'scan_keys')
  try {
    const response = await f.status()
    expect(response).toMatchObject({ status: 'connected', owner: fixture_bot.owner, bot: { id: fixture_bot.id } })
    expect(JSON.stringify(response)).not.toContain('private-')
    expect(JSON.stringify(response)).not.toContain('online')
    await f.status()
    expect(scan).toHaveBeenCalledTimes(1)
    expect(await f.store.read<Account>(`account:${fixture_bot.owner}`)).toMatchObject({
      grant_ids: [f.grant.id],
      grants_indexed: true,
    })
  } finally {
    scan.mockRestore()
  }
})

test.each(['revoked', 'expired', 'unexchanged', 'generation', 'policy', 'authority', 'owner'] as const)(
  'owner status refuses %s authority',
  async (reason) => {
    const f = await connected_fixture()
    await f.status()
    const changes: Partial<Grant> = {
      revoked: { revoked: true },
      expired: { family: { ...f.grant.family!, expires_at: Date.now() - 1 } },
      unexchanged: { code: { ...f.grant.code, used: false }, family: null },
      generation: { generation: 2 },
      policy: { policy_revision: 2 },
      authority: { authority_generation: 'retired' },
      owner: { owner: 'another-owner' },
    }[reason]
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, ...changes })
    expect(await f.status()).toMatchObject({ status: 'disconnected', expires_at: null })
  }
)

test('two distinct owned bots remain explicit recovery choices; neither is silently selected', async () => {
  const f = await connected_fixture()
  const second = { ...fixture_bot, id: 'another-bot', address: '0x' + 'b'.repeat(64) }
  await put(f.store, `bot:${second.id}`, second)
  await put(f.store, `account:${fixture_bot.owner}`, {
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
    bot_ids: [fixture_bot.id, second.id],
  })
  expect(await f.status()).toMatchObject({
    status: 'ambiguous',
    bot: null,
    recovery_bots: [{ id: fixture_bot.id }, { id: second.id }],
  })
})

test('code exchange atomically indexes its grant; consent alone is not a connected client', async () => {
  const f = await authorize_fixture()
  const account = (await f.store.read<Account>(`account:${fixture_bot.owner}`))!
  await put(f.store, `account:${fixture_bot.owner}`, { ...account, bot_ids: [fixture_bot.id] })
  const approved = await f.connect.authorize(f.consent.result.challenge_id, 'fixture-owner-proof', f.started.session)
  const code = new URL(approved.redirect_url).searchParams.get('code')!
  expect(await read_owner_status(f.store, fixture_config, fixture_bot, f.clock.now)).toMatchObject({
    status: 'disconnected',
  })
  await f.oauth.exchange({
    grant_type: 'authorization_code',
    code,
    client_id: f.client.client_id,
    redirect_uri: f.client.redirect_uris[0],
    code_verifier: f.verifier,
    resource: fixture_config.resource,
  })
  expect(await read_owner_status(f.store, fixture_config, fixture_bot, f.clock.now)).toMatchObject({
    status: 'connected',
  })
  expect((await f.store.read<Account>(`account:${fixture_bot.owner}`))!.grant_ids).toEqual([code.split('.')[0]!])
})

test('different OAuth clients share one owner wallet and revoke independently', async () => {
  const first = await authorize_fixture()
  const account = (await first.store.read<Account>(`account:${fixture_bot.owner}`))!
  await put(first.store, `account:${fixture_bot.owner}`, { ...account, bot_ids: [fixture_bot.id] })
  const exchange = async (f: Awaited<ReturnType<typeof authorize_fixture>>) => {
    const approved = await f.connect.authorize(f.consent.result.challenge_id, 'fixture-owner-proof', f.started.session)
    const code = new URL(approved.redirect_url).searchParams.get('code')!
    return f.oauth.exchange({
      grant_type: 'authorization_code',
      code,
      client_id: f.client.client_id,
      redirect_uri: f.client.redirect_uris[0],
      code_verifier: f.verifier,
      resource: fixture_config.resource,
    })
  }
  const a = await exchange(first)
  const second = await authorize_fixture(first.store, first.clock)
  const b = await exchange(second)
  expect(first.client.client_id).not.toBe(second.client.client_id)
  expect((await first.store.read<Account>(`account:${fixture_bot.owner}`))!.bot_ids).toEqual([fixture_bot.id])
  expect((await first.store.read<Account>(`account:${fixture_bot.owner}`))!.grant_ids).toHaveLength(2)
  await first.oauth.revoke({ client_id: first.client.client_id, token: a.refresh_token })
  expect(await read_owner_status(first.store, fixture_config, fixture_bot, first.clock.now)).toMatchObject({
    status: 'connected',
    bot: { id: fixture_bot.id },
  })
  await second.oauth.revoke({ client_id: second.client.client_id, token: b.refresh_token })
  expect(await read_owner_status(first.store, fixture_config, fixture_bot, first.clock.now)).toMatchObject({
    status: 'disconnected',
    bot: { id: fixture_bot.id },
  })
  expect(await first.store.scan_keys('bot:', 10)).toEqual([`bot:${fixture_bot.id}`])
})

test('owner activity projects only the current lane run, including its authored objective', async () => {
  const f = await connected_fixture()
  const lane_key = `lane:mainnet:${fixture_bot.address}`
  const lane = { ...empty_lane(fixture_bot), lease_until: Date.now() + 60_000, profession_run_id: 'current' }
  const objective = {
    title: 'Herbalist level 30',
    description: 'Gather, then craft.',
    steps: ['Gather plants', 'Craft potions'],
  }
  const run = {
    id: 'current',
    bot_id: fixture_bot.id,
    grant_id: f.grant.id,
    lane_key,
    status: 'active',
    plan: { character_id: 'hero', deadline_ms: Date.now() + 60_000, objective },
  }
  await put(f.store, lane_key, lane)
  await put(f.store, 'profession:current', run)
  expect(await f.status()).toMatchObject({ activity: { status: 'active', character_ids: ['hero'], objective } })
  await put(f.store, 'profession:current', { ...run, status: 'completed' })
  expect(await f.status()).toMatchObject({ activity: { status: 'idle', objective: null } })
  await put(f.store, 'profession:current', { ...run, bot_id: 'foreign' })
  expect(await f.status()).toMatchObject({ activity: { status: 'unavailable', objective: null } })
  await put(f.store, 'profession:current', { ...run, status: 'awaiting_ai' })
  expect(await f.status()).toMatchObject({ activity: { status: 'awaiting_ai', objective } })
  await put(f.store, 'profession:current', { ...run, plan: { ...run.plan, deadline_ms: 1 } })
  expect(await f.status()).toMatchObject({ activity: { status: 'idle', objective: null } })
  await put(f.store, lane_key, { ...lane, profession_run_id: null })
  expect(await f.status()).toMatchObject({ activity: { status: 'idle', objective: null } })
  await put(f.store, lane_key, { ...lane, profession_run_id: null, paused: true })
  expect(await f.status()).toMatchObject({ activity: { status: 'paused', objective: null } })
})

test('owner activity distinguishes blocked commands and expired standalone actor leases from work', async () => {
  const f = await connected_fixture()
  const lane_key = `lane:mainnet:${fixture_bot.address}`
  const lane = { ...empty_lane(fixture_bot), active_command: 'work', lease_until: Date.now() + 60_000 }
  const command = {
    id: 'work',
    bot_id: fixture_bot.id,
    grant_id: f.grant.id,
    lane_key,
    kind: 'gather',
    payload: { character_id: 'hero' },
    status: 'accepted',
    waiting_for_resume: true,
  }
  await put(f.store, lane_key, lane)
  await put(f.store, 'command:work', command)
  expect(await f.status()).toMatchObject({ activity: { status: 'waiting', character_ids: ['hero'], objective: null } })
  await put(f.store, 'command:work', { ...command, waiting_for_resume: false })
  expect(await f.status()).toMatchObject({ activity: { status: 'active' } })
  await put(f.store, lane_key, { ...lane, lease_until: 1 })
  expect(await f.status()).toMatchObject({ activity: { status: 'unavailable' } })
})

test('an activity snapshot race cannot fail the owner connection refresh', async () => {
  const f = await connected_fixture()
  const store = {
    ...f.store,
    transaction: async () => {
      throw new Error('control_transaction_conflict')
    },
  }
  expect(await read_owner_activity(store, fixture_bot, [f.grant], Date.now())).toEqual({
    status: 'unavailable',
    character_ids: [],
    objective: null,
  })
})

test('blocked behavior retains objective and instruction reason in owner activity', async () => {
  const f = await connected_fixture()
  const lane_key = `lane:mainnet:${fixture_bot.address}`
  await put(f.store, lane_key, {
    ...empty_lane(fixture_bot),
    lease_until: Date.now() + 60000,
    run_ref: { kind: 'behavior', id: 'blocked' },
  })
  const objective = { title: 'Authored objective' }
  await put(f.store, 'behavior:blocked', {
    id: 'blocked',
    bot_id: fixture_bot.id,
    grant_id: f.grant.id,
    lane_key,
    status: 'awaiting_ai',
    issue: 'Supplies unavailable',
    script: { version: '1', objective, tree: { type: 'replan', reason: 'Supplies unavailable' } },
  })
  expect(await f.status()).toMatchObject({
    activity: { status: 'awaiting_ai', objective, issue: 'Supplies unavailable' },
  })
})
