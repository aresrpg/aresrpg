// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, spyOn, test } from 'bun:test'
import { createElement } from 'react'
import type { HostedBotDescriptor, HostedConnectRequest } from '@aresrpg/protocol'
import type { PendingAuthorization } from '@aresrpg/protocol/hosted-bot-client'

import { empty_hosted, type HostedState, type HostedStep } from '../../src/agents/hosted_state.ts'
import { silent_step } from '../../src/agents/silent_consent.ts'
import * as hosted from '../../src/agents/useHostedConnect.ts'
import type { AuthSession } from '../../src/auth.ts'
import { consent_label, own_request } from '../../src/dapp/consent.ts'
import { DappConsent } from '../../src/dapp/DappConsent.tsx'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { dispatch_app, initialize_app_store, read_app_state } from '../../src/store.ts'
import { render_english } from '../i18n/render.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

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
/** The rule the dapp gives the shared silent consent: a request is trusted when this tab began it. */
const own = (stored: PendingAuthorization | null) =>
  stored ? (asked: HostedConnectRequest) => own_request(asked, stored, origin) : null

test('the dapp connects by itself: owner proof first, then approval of its own request', () => {
  expect(silent_step(state({ phase: 'idle' }), own(pending))).toBe('authenticating')
  expect(silent_step(state({ phase: 'authenticating' }), own(pending))).toBeNull()
  expect(silent_step(ready, own(pending))).toBe('authorizing')
  expect(silent_step(state({ phase: 'authorizing' }), own(pending))).toBeNull()
})

test('nothing starts without a signed-in player, a request of this tab, or a verified bot', () => {
  expect(silent_step({ ...state({ phase: 'idle' }), session: null }, own(pending))).toBeNull()
  expect(silent_step(state({ phase: 'idle' }), own(null))).toBeNull()
  expect(silent_step({ ...ready, verified: '' }, own(pending))).toBeNull()
})

test("another client's request is never approved silently", () => {
  const foreign = (values: Partial<HostedConnectRequest>) => ({ ...consent, ...values }) as HostedConnectRequest
  for (const other of [
    foreign({ client_id: 'assistant' }),
    foreign({ redirect_uri: 'https://assistant.example/callback' }),
    foreign({ redirect_uri: `${origin}/other` }),
  ]) {
    expect(own_request(other, pending, origin)).toBe(false)
    expect(silent_step({ ...ready, consent: other }, own(pending))).toBe('refused')
  }
  // the redirect must return to this origin even when the stored request agrees with it
  const elsewhere = { ...pending, redirect_uri: 'https://evil.example/dapp' }
  expect(own_request(foreign({ redirect_uri: elsewhere.redirect_uri }), elsewhere, origin)).toBe(false)
  expect(own_request(consent, pending, origin)).toBe(true)
})

const copy = en as AppCopy
const text = copy.dapp_page
const STEPS: readonly HostedStep[] = ['proving', 'creating', 'checking', 'naming', 'approving', 'returning']

test('each wait of a connection reads a sentence the copy has; the sign-in before them has its own', () => {
  for (const step of STEPS) {
    expect(text[consent_label(step, false)]).toBeString()
    // A step in progress is named by itself, whatever the sign-in is doing.
    expect(consent_label(step, true)).toBe(consent_label(step, false))
  }
  expect(consent_label(null, true)).toBe('signing_in')
  expect(consent_label(null, false)).toBe('connect_busy')
})

const globals = ['location', 'history'].map(
  (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
)
const spies: { mockRestore: () => void }[] = []
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  initialize_app_store(automation_fixture().settings)
})
/** The dapp's consent page: its address, the session so far, and what the consent step has reached. */
const consent_page = (
  values: Partial<HostedState<HostedBotDescriptor>>,
  session: 'restoring' | 'signed_in' = 'signed_in'
) => {
  const page = { navigated: [] as string[], replaced: [] as string[] }
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      origin,
      search: '?intent=connect-agent&authorization_id=request',
      assign: (url: string) => void (page.navigated = [...page.navigated, url]),
    },
  })
  Object.defineProperty(globalThis, 'history', {
    configurable: true,
    value: { state: null, replaceState: (_: unknown, __: string, path: string) => void (page.replaced = [path]) },
  })
  initialize_app_store(automation_fixture().settings)
  dispatch_app({ type: 'auth/connecting' })
  if (session === 'signed_in')
    dispatch_app({ type: 'auth/connected', session: { address: 'owner', identity: 'zklogin' } as AuthSession })
  const hook = spyOn(hosted, 'useHostedConnect').mockReturnValue({
    state: state(values),
    dispatch: () => undefined,
    eligible: true,
  })
  spies.push(hook)
  const html = render_english(createElement(DappConsent, { copy, linked: null }))
  // The fourth argument is what receives the approved redirect.
  return { html, page, arrive: hook.mock.calls[0]![3]! }
}

test('the consent page names what it waits for, and a request it does not finish says so', () => {
  expect(consent_page({ phase: 'idle', session: null }, 'restoring').html).toContain(text.signing_in)
  for (const step of STEPS) {
    const { html } = consent_page({ phase: step === 'approving' ? 'authorizing' : 'authenticating', step })
    // The server renderer escapes the apostrophe of "your bot's".
    expect(html).toContain(text[consent_label(step, false)]!.replaceAll("'", '&#x27;'))
    expect(html).toContain('aria-busy="true"')
  }
  const failed = consent_page({ phase: 'failed', failure: 'retry' }).html
  expect(failed).toContain(text.error_consent_failed)
  expect(failed).toContain(`href="/dapp"`)
})

// Owner complaint 2026-11-21: the approved request sent the browser to `/dapp?code=…`, a third page load.
test('the approved answer of the dapp’s own request stays on this page; any other redirect leaves it', () => {
  const own = consent_page({ phase: 'authorizing', step: 'approving' })
  own.arrive(`${origin}/dapp?code=g.code&state=s&iss=issuer`)
  expect(own.page.navigated).toEqual([])
  expect(own.page.replaced).toEqual(['/dapp?code=g.code&state=s&iss=issuer'])
  // The dapp's link takes it from the address: the module exchanges it with this tab's request.
  expect(read_app_state().dapp.link).toEqual({ phase: 'exchanging' })
  const other = consent_page({ phase: 'authorizing', step: 'approving' })
  other.arrive('https://assistant.example/callback?code=g.code&state=s')
  expect(other.page.navigated).toEqual(['https://assistant.example/callback?code=g.code&state=s'])
  expect(other.page.replaced).toEqual([])
  expect(read_app_state().dapp.link.phase).not.toBe('exchanging')
})
