// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterEach, expect, test } from 'bun:test'

import { LightPageGate } from '../../src/components/LightPage.tsx'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { dispatch_app, initialize_app_store, read_app_state } from '../../src/store.ts'
import { render_english } from '../i18n/render.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

const copy = en as AppCopy
const TITLE = 'Sign in to stake'
const BODY = 'Staking uses your game account.'
const reset = () => initialize_app_store(automation_fixture().settings)
afterEach(reset)
const gate = () => render_english(<LightPageGate copy={copy} title={TITLE} body={BODY} />)
/** The card that asks for the account: its title, its request and the Google button. */
const asks_to_sign_in = (html: string): boolean =>
  [TITLE, BODY, copy.continue_google].every((text) => html.includes(text))

test('a first-time visitor reads the sign-in card', () => {
  reset()
  const html = gate()
  expect(asks_to_sign_in(html)).toBe(true)
  expect(html).not.toContain(copy.dapp_page.signing_in)
  expect(html).not.toContain('aria-busy')
})

test('while the session restores the gate says it is signing in and asks for nothing', () => {
  reset()
  // What the session observer dispatches for a remembered wallet, before the first render.
  dispatch_app({ type: 'auth/connecting' })
  expect(read_app_state().session.auth_status).toBe('connecting')
  const html = gate()
  expect(html).toContain(`${copy.dapp_page.signing_in}</p>`)
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-busy="true"')
  for (const text of [TITLE, BODY, copy.continue_google, copy.loading_universe, '<button'])
    expect(html).not.toContain(text)
})

test('a failed restore returns the sign-in card', () => {
  reset()
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/failed', error: 'The remembered wallet is unavailable' })
  const html = gate()
  expect(asks_to_sign_in(html)).toBe(true)
  expect(html).not.toContain(copy.dapp_page.signing_in)
  // Raw failure text never reaches the card.
  expect(html).not.toContain('The remembered wallet is unavailable')
})
