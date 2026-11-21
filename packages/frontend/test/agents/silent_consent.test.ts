// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'

import { create_hosted_client, read_hosted_request } from '../../src/agents/hosted_client.ts'
import { empty_hosted, type HostedState } from '../../src/agents/hosted_state.ts'
import { silent_step, telegram_request } from '../../src/agents/silent_consent.ts'
import { telegram_possible } from '../../src/agents/useTelegramRequest.ts'
import { resolve_env } from '../../src/env.ts'

const service = 'https://bot.example.test'
const callback = 'https://companion.example.test/oauth/callback'
const request = (values: Partial<HostedConnectRequest> = {}): HostedConnectRequest => ({
  authorization_id: 'request',
  client_id: 'telegram-client',
  client_name: 'AresRPG Telegram',
  redirect_uri: callback,
  scopes: ['bot:observe', 'bot:play', 'bot:pause'],
  resource: `${service}/mcp`,
  network: 'mainnet',
  ...values,
})
const bot = { id: 'bot' } as unknown as HostedBotDescriptor
const state = (values: Partial<HostedState<HostedBotDescriptor>>): HostedState<HostedBotDescriptor> => ({
  ...empty_hosted<HostedBotDescriptor>(),
  session: {},
  ...values,
})
const ready = (consent: HostedConnectRequest) =>
  state({ phase: 'ready', consent, bots: [bot], selected: 'bot', verified: 'bot' })
const telegram = (asked: Readonly<HostedConnectRequest>) => telegram_request(asked, callback)

test('a request is Telegram’s only when its registered redirect is exactly the configured callback', () => {
  expect(telegram_request(request(), callback)).toBe(true)
  for (const redirect_uri of [
    'https://assistant.example/callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://companion.example.test/oauth/callback/extra',
    'https://companion.example.test/oauth',
    'https://companion.example.test/oauth/callback?next=https://evil.example',
    'https://companion.example.test.evil.example/oauth/callback',
    'http://companion.example.test/oauth/callback',
    'not a url',
    '',
  ])
    expect(telegram_request(request({ redirect_uri }), callback)).toBe(false)
  // The name a client gives itself is never the rule: only the redirect the bot registered is.
  expect(
    telegram_request(request({ client_name: 'AresRPG Telegram', redirect_uri: 'https://evil.example/cb' }), callback)
  ).toBe(false)
  // Without the setting no request is Telegram's, the real one included.
  expect(telegram_request(request(), '')).toBe(false)
})

test('a Telegram request links by itself: owner proof first, then approval, with no click between', () => {
  expect(silent_step(state({ phase: 'idle' }), telegram)).toBe('authenticating')
  expect(silent_step(state({ phase: 'authenticating' }), telegram)).toBeNull()
  expect(silent_step(ready(request()), telegram)).toBe('authorizing')
  expect(silent_step(state({ phase: 'authorizing' }), telegram)).toBeNull()
  expect(silent_step(state({ phase: 'complete' }), telegram)).toBeNull()
})

test('an assistant’s request is never approved by the Telegram rule, and no rule approves nothing', () => {
  const assistant = request({ client_id: 'assistant', redirect_uri: 'https://assistant.example/callback' })
  expect(silent_step(ready(assistant), telegram)).toBe('refused')
  // No trusted rule: nothing starts, not even the owner proof.
  expect(silent_step(state({ phase: 'idle' }), null)).toBeNull()
  expect(silent_step(ready(request()), null)).toBeNull()
  // No signed-in player, or a bot that is not the verified one: nothing is approved.
  expect(silent_step({ ...state({ phase: 'idle' }), session: null }, telegram)).toBeNull()
  expect(silent_step({ ...ready(request()), verified: '' }, telegram)).toBeNull()
})

test('the bot is asked what a request is only when a request and both peer addresses exist', () => {
  const configured = { bot_service_url: service, telegram_callback_url: callback }
  expect(telegram_possible('request', configured)).toBe(true)
  expect(telegram_possible(null, configured)).toBe(false)
  // Unset: the page never asks and treats every request as an assistant's.
  expect(telegram_possible('request', { ...configured, telegram_callback_url: '' })).toBe(false)
  expect(telegram_possible('request', { ...configured, bot_service_url: '' })).toBe(false)
})

test('the request is read from the bot with one unsigned GET, and a mismatched answer is refused', async () => {
  const calls: { url: string; method: string }[] = []
  const answers: { body: unknown } = { body: request() }
  const fetcher = (async (url: URL, init: RequestInit) => {
    calls.push({ url: url.href, method: String(init.method) })
    return Response.json(answers.body)
  }) as unknown as typeof fetch
  const app = { get_state: () => ({}) as never, dispatch: () => {} }
  const client = create_hosted_client(service, new AbortController().signal, app, fetcher)
  const read = await read_hosted_request(client, 'request')
  expect(telegram_request(read, callback)).toBe(true)
  // Nothing is signed and nothing is provisioned to learn what the request is.
  expect(calls).toEqual([{ url: `${service}/connect/request?authorization_id=request`, method: 'GET' }])
  for (const body of [
    null,
    request({ authorization_id: 'another-request' }),
    request({ resource: 'https://other.example.test/mcp' }),
    request({ network: 'testnet' as 'mainnet' }),
    request({ redirect_uri: 'http://companion.example.test/oauth/callback' }),
  ]) {
    answers.body = body
    await expect(read_hosted_request(client, 'request')).rejects.toThrow()
  }
})

test('the Telegram callback setting accepts only the HTTPS /oauth/callback address; unset is empty', () => {
  expect(resolve_env({}).telegram_callback_url).toBe('')
  expect(resolve_env({ VITE_TELEGRAM_CALLBACK_URL: '' }).telegram_callback_url).toBe('')
  expect(resolve_env({ VITE_TELEGRAM_CALLBACK_URL: callback }).telegram_callback_url).toBe(callback)
  // The stored value is the normalized address a registered redirect is compared with.
  expect(
    resolve_env({ VITE_TELEGRAM_CALLBACK_URL: 'https://Companion.Example.test:443/oauth/callback' })
      .telegram_callback_url
  ).toBe(callback)
  for (const invalid of [
    'http://companion.example.test/oauth/callback',
    'https://companion.example.test/',
    'https://companion.example.test/oauth/callback/',
    'https://companion.example.test/oauth/callback?x=1',
    'https://companion.example.test/oauth/callback#x',
    'https://user:secret@companion.example.test/oauth/callback',
    'companion.example.test/oauth/callback',
  ])
    expect(() => resolve_env({ VITE_TELEGRAM_CALLBACK_URL: invalid })).toThrow()
})
