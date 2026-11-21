// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedChallengeResponse, HostedAuthorizeResponse } from '@aresrpg/protocol'
import { PLAY_SCOPE, create_bot_client, same_scope } from '@aresrpg/protocol/hosted-bot-client'

import { create_http_fixture } from '../../bot/test/helpers/http_fixture.ts'
import { fixture_bot, put } from '../../bot/test/helpers/control_fixture.ts'
import { create_links } from '../src/link.ts'
import { secure_records } from '../src/secure_records.ts'

import { memory_backend } from './helpers/memory_backend.ts'

test('Telegram PKCE client composes real hosted HTTP Google-consent and token handlers', async () => {
  const service = create_http_fixture()
  const client = create_bot_client({
    issuer: service.config.issuer,
    fetch: (url, init) => service.ingress(new Request(url, init)),
    now: Date.now,
    timeout_ms: 1000,
  })
  const links = create_links(
    secure_records(memory_backend(), 'ab'.repeat(32)),
    client,
    'https://companion.example/oauth/callback',
    60000
  )
  const link = await links.begin(42)
  const browser = await links.browser(new URL(link).pathname.slice(6))
  const authorize = new URL(browser.location)
  const response = await service.request(`${authorize.pathname}${authorize.search}`)
  const authorization_id = new URL(response.headers.get('location')!).searchParams.get('authorization_id')!
  const owner = {
    authorization_id,
    owner: fixture_bot.owner,
    zklogin_public_identifier: fixture_bot.zklogin_public_identifier,
  }
  const challenge = await service.json<HostedChallengeResponse>('/connect/challenge', { ...owner, purpose: 'session' })
  await service.json('/connect/verify', {
    challenge_id: challenge.challenge_id,
    signature: service.signature(challenge.message),
  })
  await put(service.store, `bot:${fixture_bot.id}`, fixture_bot)
  const consent = await service.json<HostedChallengeResponse>('/connect/challenge', {
    ...owner,
    purpose: 'consent',
    bot_id: fixture_bot.id,
    generation: fixture_bot.generation,
    address: fixture_bot.address,
    multisig_public_key: fixture_bot.multisig_public_key,
    policy_revision: fixture_bot.policy.revision,
  })
  const approved = await service.json<HostedAuthorizeResponse>('/connect/authorize', {
    challenge_id: consent.challenge_id,
    signature: service.signature(consent.message),
  })
  // The real bot's redirect proves the account; the chat that asked is linked when it sends the token back.
  const token = await links.callback(new URL(approved.redirect_url).searchParams, browser.cookie)
  expect(await links.current(42)).toBeNull()
  expect(await links.confirm(42, token)).toBe(true)
  // The real bot issued the scope the one login asks for: observe, play and pause.
  expect(same_scope((await links.current(42))!.scope, PLAY_SCOPE)).toBe(true)
  expect((await links.current(42))?.identity).toMatchObject({
    owner: fixture_bot.owner,
    address: fixture_bot.address,
    descriptor: fixture_bot.multisig_public_key,
    generation: fixture_bot.generation,
  })
  await links.authenticate(42)
  const grant = (await links.current(42))!
  await links.revoke(42)
  // The real hosted handler answers a revoked token with HTTP 401; the client names it a dead login.
  expect(await client.verify(grant, null)).toEqual({ ok: false, error: 'invalid_token' })
})
