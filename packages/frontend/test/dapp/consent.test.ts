// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { PendingAuthorization } from '@aresrpg/protocol/hosted-bot-client'

import { empty_hosted, type HostedState } from '../../src/agents/hosted_state.ts'
import { own_request, silent_step } from '../../src/dapp/consent.ts'

const origin = 'https://game.example.test'
const pending: PendingAuthorization = {
  client_id: 'dapp-client',
  redirect_uri: `${origin}/dapp`,
  scope: 'bot:observe bot:play bot:pause',
  state: 's',
  verifier: 'v',
  expires_at: 9_999,
}
const consent = {
  client_id: 'dapp-client',
  redirect_uri: `${origin}/dapp`,
  scopes: ['bot:play'],
} as unknown as HostedConnectRequest
const bot = { id: 'bot' } as unknown as HostedBotDescriptor
const state = (values: Partial<HostedState<HostedBotDescriptor>>): HostedState<HostedBotDescriptor> => ({
  ...empty_hosted<HostedBotDescriptor>(),
  session: {},
  ...values,
})
const ready = state({ phase: 'ready', consent, bots: [bot], selected: 'bot', verified: 'bot' })

test('the dapp connects by itself: owner proof first, then approval of its own request', () => {
  expect(silent_step(state({ phase: 'idle' }), pending, origin)).toBe('authenticating')
  expect(silent_step(state({ phase: 'authenticating' }), pending, origin)).toBeNull()
  expect(silent_step(ready, pending, origin)).toBe('authorizing')
  expect(silent_step(state({ phase: 'authorizing' }), pending, origin)).toBeNull()
})

test('nothing starts without a signed-in player, a request of this tab, or a verified bot', () => {
  expect(silent_step({ ...state({ phase: 'idle' }), session: null }, pending, origin)).toBeNull()
  expect(silent_step(state({ phase: 'idle' }), null, origin)).toBeNull()
  expect(silent_step({ ...ready, verified: '' }, pending, origin)).toBeNull()
})

test("another client's request is never approved silently", () => {
  const foreign = (values: Partial<HostedConnectRequest>) => ({ ...consent, ...values }) as HostedConnectRequest
  for (const other of [
    foreign({ client_id: 'assistant' }),
    foreign({ redirect_uri: 'https://assistant.example/callback' }),
    foreign({ redirect_uri: `${origin}/other` }),
  ]) {
    expect(own_request(other, pending, origin)).toBe(false)
    expect(silent_step({ ...ready, consent: other }, pending, origin)).toBe('refused')
  }
  // the redirect must return to this origin even when the stored request agrees with it
  const elsewhere = { ...pending, redirect_uri: 'https://evil.example/dapp' }
  expect(own_request(foreign({ redirect_uri: elsewhere.redirect_uri }), elsewhere, origin)).toBe(false)
  expect(own_request(consent, pending, origin)).toBe(true)
})
