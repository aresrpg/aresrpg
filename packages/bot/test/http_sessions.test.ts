// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { HostedChallengeResponse } from '@aresrpg/protocol'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { hash_secret, random_secret } from '../src/security.ts'
import type { AuthorizationRequest, OwnerChallenge, Grant } from '../src/model.ts'

import { create_http_fixture } from './helpers/http_fixture.ts'
import { fixture_bot, put } from './helpers/control_fixture.ts'

type Fixture = ReturnType<typeof create_http_fixture>
const begin = async (f: Fixture) => {
  const client = await f.json<{ client_id: string }>('/oauth/register', {
    client_name: 'Fixture connector',
    redirect_uris: ['https://client.example.test/callback'],
    token_endpoint_auth_method: 'none',
  })
  const verifier = random_secret()
  const response = await f.request(
    `/authorize?${new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope: 'bot:observe',
      resource: f.config.resource,
      state: 'fixture-state',
      code_challenge_method: 'S256',
      code_challenge: hash_secret(verifier),
    })}`
  )
  expect(response.status).toBe(302)
  const id = new URL(response.headers.get('location')!).searchParams.get('authorization_id')!
  const header = response.headers.get('set-cookie')!
  return { id, header, cookie: header.split(';')[0]!, client_id: client.client_id, verifier }
}
const details = (f: Fixture, id: string) => f.request(`/connect/request?authorization_id=${id}`)
const challenge = (f: Fixture, id?: string) =>
  f.json<HostedChallengeResponse>('/connect/challenge', {
    authorization_id: id,
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
const raw = (f: Fixture, path: string, cookie: string, body?: unknown) =>
  f.ingress(
    new Request(f.config.issuer + path, {
      method: body ? 'POST' : 'GET',
      headers: { origin: f.config.web_origin, cookie, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  )

test('starting another OAuth attempt preserves both browser-bound requests', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  expect((await details(f, a.id)).status).toBe(200)
  const b = await begin(f)
  expect((await details(f, b.id)).status).toBe(200)
  expect((await details(f, a.id)).status).toBe(200)
  expect(a.cookie.split('=')[0] === b.cookie.split('=')[0]).toBe(false)
})

test('cancelling one attempt cannot clear another attempt cookie or permit late verification', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  const proof = await challenge(f, a.id)
  const b = await begin(f)
  expect((await f.request('/connect/cancel', { authorization_id: a.id })).status).toBe(200)
  expect((await details(f, b.id)).status).toBe(200)
  expect((await details(f, a.id)).status).toBe(400)
  const rejected = await f.request('/connect/verify', {
    challenge_id: proof.challenge_id,
    signature: f.signature(proof.message),
  })
  expect(rejected.status).toBe(400)
})

test('standalone setup cannot displace an in-progress OAuth request', async () => {
  const f = create_http_fixture()
  const oauth = await begin(f)
  const standalone = await challenge(f)
  expect((await details(f, oauth.id)).status).toBe(200)
  expect((await details(f, standalone.authorization_id)).status).toBe(200)
})

test('missing, foreign, and tampered cookies cannot read or verify another request', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  const proof = await challenge(f, a.id)
  const b = await begin(f)
  const name = a.cookie.split('=')[0]!
  for (const cookie of ['', b.cookie, `${name}=${random_secret()}`, `${name}=${b.cookie.split('=')[1]}`]) {
    expect((await raw(f, `/connect/request?authorization_id=${a.id}`, cookie)).status).toBe(400)
    expect(
      (
        await raw(f, '/connect/verify', cookie, {
          challenge_id: proof.challenge_id,
          signature: f.signature(proof.message),
        })
      ).status
    ).toBe(400)
  }
  expect(
    (await f.request('/connect/verify', { challenge_id: proof.challenge_id, signature: f.signature(proof.message) }))
      .status
  ).toBe(200)
})

test('cookie deadline follows the request and cannot be extended by a challenge', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  const request = (await f.store.read<AuthorizationRequest>(`request:${a.id}`))!
  const issued = await f.request('/connect/challenge', {
    authorization_id: a.id,
    purpose: 'session',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  })
  const header = issued.headers.get('set-cookie')!
  const expiry = (value: string) => Date.parse(/Expires=([^;]+)/.exec(value)?.[1] ?? '')
  expect(expiry(a.header)).toBe(Math.floor(request.expires_at / 1000) * 1000)
  expect(expiry(header)).toBe(expiry(a.header))
  for (const attribute of ['Path=/', 'Secure', 'HttpOnly', 'SameSite=None'])
    expect(header.includes(attribute)).toBe(true)
})

test.each(['request', 'challenge'] as const)('expired %s stays rejected with its cookie present', async (kind) => {
  const f = create_http_fixture()
  const a = await begin(f)
  const proof = await challenge(f, a.id)
  const b = await begin(f)
  const key = kind === 'request' ? `request:${a.id}` : `challenge:${proof.challenge_id}`
  await f.store.transaction([key], async (tx) => {
    const record = (await tx.get<AuthorizationRequest | OwnerChallenge>(key))!
    await tx.put(key, { ...record, expires_at: Date.now() - 1 })
  })
  expect(
    (await f.request('/connect/verify', { challenge_id: proof.challenge_id, signature: f.signature(proof.message) }))
      .status
  ).toBe(400)
  expect((await details(f, b.id)).status).toBe(200)
})

test('a second request and cancellation cannot substitute the original consent client or its PKCE proof', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  const owner = await challenge(f, a.id)
  expect(
    (await f.request('/connect/verify', { challenge_id: owner.challenge_id, signature: f.signature(owner.message) }))
      .status
  ).toBe(200)
  await put(f.store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = await f.json<HostedChallengeResponse>('/connect/challenge', {
    authorization_id: a.id,
    purpose: 'consent',
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
    bot_id: fixture_bot.id,
    generation: fixture_bot.generation,
    address: fixture_bot.address,
    multisig_public_key: fixture_bot.multisig_public_key,
    policy_revision: fixture_bot.policy.revision,
  })
  const b = await begin(f)
  const body = { challenge_id: consent.challenge_id, signature: f.signature(consent.message) }
  expect((await raw(f, '/connect/authorize', b.cookie, body)).status).toBe(400)
  expect((await f.request('/connect/cancel', { authorization_id: b.id })).status).toBe(200)
  const authorized = await f.json<{ redirect_url: string }>('/connect/authorize', body)
  const redirect = new URL(authorized.redirect_url)
  expect(redirect.origin + redirect.pathname).toBe('https://client.example.test/callback')
  const code = redirect.searchParams.get('code')!
  const grant = (await f.store.read<Grant>(`grant:${code.split('.')[0]}`))!
  expect(grant.client_id).toBe(a.client_id)
  expect(grant.owner).toBe(fixture_bot.owner)
  expect(grant.scopes).toEqual(['bot:observe'])
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

test('rejection diagnostics retain only safe route, status and public error code', async () => {
  const f = create_http_fixture()
  const messages: unknown[][] = []
  const log = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    messages.push(args)
  })
  try {
    const response = await raw(f, '/connect/request?authorization_id=fixture-private-query', 'fixture-private-cookie')
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(messages).toEqual([
      ['Hosted request rejected', JSON.stringify({ path: '/connect/request', status: 400, code: body.error })],
    ])
    expect(JSON.stringify(messages)).not.toContain('fixture-private')
  } finally {
    log.mockRestore()
  }
})

test('one browser can verify separate owners without moving either request to the other owner', async () => {
  const f = create_http_fixture()
  const a = await begin(f)
  const first = await challenge(f, a.id)
  await f.json('/connect/verify', { challenge_id: first.challenge_id, signature: f.signature(first.message) })
  const b = await begin(f)
  const identity = toZkLoginPublicIdentifier(2n, 'https://accounts.google.com', { legacyAddress: false })
  const second = await f.json<HostedChallengeResponse>('/connect/challenge', {
    authorization_id: b.id,
    purpose: 'session',
    owner: identity.toSuiAddress(),
    zklogin_public_identifier: identity.toBase64(),
  })
  const body = { challenge_id: second.challenge_id, signature: f.signature(second.message) }
  expect((await raw(f, '/connect/verify', a.cookie, body)).status).toBe(400)
  await f.json('/connect/verify', body)
  expect((await f.json<{ owner: string }>(`/connect/bots?authorization_id=${a.id}`)).owner).toBe(fixture_bot.owner)
  expect((await f.json<{ owner: string }>(`/connect/bots?authorization_id=${b.id}`)).owner).toBe(
    identity.toSuiAddress()
  )
})

test('closing standalone setup after provider authorization starts cannot cancel the provider return', async () => {
  const f = create_http_fixture()
  const standalone = await challenge(f)
  const oauth = await begin(f)
  expect((await f.request('/connect/cancel', { authorization_id: standalone.authorization_id })).status).toBe(200)
  expect((await details(f, oauth.id)).status).toBe(200)
  expect((await details(f, standalone.authorization_id)).status).toBe(400)
})
