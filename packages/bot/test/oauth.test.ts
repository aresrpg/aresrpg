// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_oauth_service } from '../src/oauth.ts'
import { create_connect_service } from '../src/connect.ts'
import { hash_secret, random_secret } from '../src/security.ts'

import { fixture_bot, fixture_config, memory_store, put } from './helpers/control_fixture.ts'

export const authorize_fixture = async (store = memory_store(), clock = { now: 1000 }) => {
  const now = () => clock.now
  const oauth = create_oauth_service(store, fixture_config, now)
  const connect = create_connect_service(
    store,
    fixture_config,
    async (_challenge, signature) => {
      if (signature !== 'fixture-owner-proof') throw new Error('invalid_owner_signature')
    },
    now
  )
  const client = await oauth.register({
    client_name: 'Fixture connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const started = await oauth.begin(
    new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      scope: fixture_config.scopes.join(' '),
      resource: fixture_config.resource,
      state: 'client-csrf',
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })
  )
  const authorization_id = new URL(started.location).searchParams.get('authorization_id')!
  const identity = {
    authorization_id,
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  }
  const first = await connect.challenge({ ...identity, purpose: 'session' }, started.session)
  await connect.verify(first.result.challenge_id, 'fixture-owner-proof', started.session)
  await put(store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = await connect.challenge(
    {
      ...identity,
      purpose: 'consent',
      generation: fixture_bot.generation,
      address: fixture_bot.address,
      multisig_public_key: fixture_bot.multisig_public_key,
      bot_id: fixture_bot.id,
      policy_revision: 1,
    },
    started.session
  )
  return { store, clock, oauth, connect, client, verifier, started, identity, consent }
}
const grant_fixture = async () => {
  const fixture = await authorize_fixture()
  const response = await fixture.connect.authorize(
    fixture.consent.result.challenge_id,
    'fixture-owner-proof',
    fixture.started.session
  )
  const url = new URL(response.redirect_url)
  return { ...fixture, url, code: url.searchParams.get('code')! }
}
const token_input = (fixture: Awaited<ReturnType<typeof grant_fixture>>) => ({
  grant_type: 'authorization_code',
  code: fixture.code,
  client_id: fixture.client.client_id,
  redirect_uri: fixture.client.redirect_uris[0],
  code_verifier: fixture.verifier,
  resource: fixture_config.resource,
})

test('PKCE grant pins resource, client, bot and policy; code consumed once', async () => {
  const fixture = await grant_fixture()
  expect(fixture.url.searchParams.get('iss')).toBe(fixture_config.issuer)
  expect(fixture.url.searchParams.get('state')).toBe('client-csrf')
  const input = token_input(fixture)
  await expect(fixture.oauth.exchange({ ...input, resource: 'https://attacker.test' })).rejects.toThrow()
  await expect(fixture.oauth.exchange({ ...input, code_verifier: random_secret() })).rejects.toThrow()
  const tokens = await fixture.oauth.exchange(input)
  const grant = await fixture.oauth.authenticate(tokens.access_token)
  expect(grant.bot_id).toBe(fixture_bot.id)
  await expect(fixture.oauth.exchange(input)).rejects.toThrow()
  await put(fixture.store, `bot:${fixture_bot.id}`, { ...fixture_bot, policy: { ...fixture_bot.policy, revision: 2 } })
  await expect(fixture.oauth.authenticate(tokens.access_token)).rejects.toThrow()
})

test('refresh rotates and replay durably revokes the entire family', async () => {
  const fixture = await grant_fixture()
  const first = await fixture.oauth.exchange(token_input(fixture))
  const refresh = {
    grant_type: 'refresh_token',
    refresh_token: first.refresh_token,
    client_id: fixture.client.client_id,
    resource: fixture_config.resource,
  }
  const second = await fixture.oauth.exchange(refresh)
  await expect(fixture.oauth.authenticate(first.access_token)).rejects.toThrow()
  expect((await fixture.oauth.authenticate(second.access_token)).owner).toBe(fixture_bot.owner)
  await expect(fixture.oauth.exchange(refresh)).rejects.toThrow()
  await expect(fixture.oauth.authenticate(second.access_token)).rejects.toThrow()
})

test('restored requests and signed consent cannot mint grants under a new generation', async () => {
  const fixture = await authorize_fixture()
  const restored = create_connect_service(
    fixture.store,
    { ...fixture_config, authority_generation: 'replacement-generation' },
    async () => {},
    () => fixture.clock.now
  )
  await expect(restored.details(fixture.identity.authorization_id, fixture.started.session)).rejects.toThrow(
    'invalid_session'
  )
  await expect(
    restored.authorize(fixture.consent.result.challenge_id, 'fixture-owner-proof', fixture.started.session)
  ).rejects.toThrow('invalid_challenge')
  expect(await fixture.store.scan_keys('grant:', 10)).toEqual([])
})

test('single-use challenge, wrong session and cancellation fail closed', async () => {
  const fixture = await authorize_fixture()
  const { challenge_id } = fixture.consent.result
  await expect(fixture.connect.authorize(challenge_id, 'fixture-owner-proof', random_secret())).rejects.toThrow(
    'invalid_session'
  )
  await fixture.connect.cancel(fixture.identity.authorization_id, fixture.started.session)
  await expect(fixture.connect.authorize(challenge_id, 'fixture-owner-proof', fixture.started.session)).rejects.toThrow(
    'invalid_session'
  )
})

test('consent without an allowance is single-use', async () => {
  const fixture = await authorize_fixture()
  const zero = await fixture.connect.challenge(
    {
      ...fixture.identity,
      purpose: 'consent',
      generation: fixture_bot.generation,
      address: fixture_bot.address,
      multisig_public_key: fixture_bot.multisig_public_key,
      bot_id: fixture_bot.id,
      policy_revision: 1,
    },
    fixture.started.session
  )
  const approved = await fixture.connect.authorize(
    zero.result.challenge_id,
    'fixture-owner-proof',
    fixture.started.session
  )
  expect(new URL(approved.redirect_url).searchParams.has('code')).toBe(true)
  await expect(
    fixture.connect.authorize(zero.result.challenge_id, 'fixture-owner-proof', fixture.started.session)
  ).rejects.toThrow()
})

test('existing access authority cannot cross a changed configured resource audience', async () => {
  const f = await grant_fixture()
  const tokens = await f.oauth.exchange(token_input(f))
  const other = create_oauth_service(
    f.store,
    { ...fixture_config, resource: 'https://other.example.test/mcp' },
    () => f.clock.now
  )
  await expect(other.authenticate(tokens.access_token)).rejects.toThrow('invalid_token')
  expect((await f.oauth.authenticate(tokens.access_token)).resource).toBe(fixture_config.resource)
})

test('legacy signed allowance consent cannot issue a no-allowance grant', async () => {
  const f = await authorize_fixture()
  const key = `challenge:${f.consent.result.challenge_id}`
  const proof = (await f.store.read<import('../src/model.ts').OwnerChallenge>(key))!
  const consent = { ...proof.consent!, budget_mist: '0' }
  const envelope = JSON.parse(proof.message.split('\n')[1]!)
  const message = `AresRPG hosted bot consent v1\n${JSON.stringify({ ...envelope, consent })}`
  await put(f.store, key, { ...proof, consent, message })
  await expect(f.connect.authorize(proof.id, 'fixture-owner-proof', f.started.session)).rejects.toThrow(
    'invalid_consent'
  )
  expect(await f.store.scan_keys('grant:', 10)).toEqual([])
})
