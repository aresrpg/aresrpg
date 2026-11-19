// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore } from 'zustand/vanilla'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { InterfaceActions, LandingAccountContext } from '../../src/landing/LandingChooser.tsx'
import {
  initial_landing_account,
  type LandingAccountRuntime,
  type LandingAccountState,
} from '../../src/landing/landing_account.ts'
import { landing_links } from '../../src/landing/presentation.ts'

const links = landing_links('https://app.test', 'https://discord.test/invite')
const signed_in: LandingAccountState = { ...initial_landing_account, status: 'signed_in', address: '0x7a3f' }
// A static render reads a store's initial state, so each rendered state gets its own store.
const account_in = (state: LandingAccountState) =>
  ({
    store: createStore<LandingAccountState>(() => state),
    join_waitlist: async () => undefined,
    warm: () => undefined,
  }) as unknown as LandingAccountRuntime
const telegram_step = async (code: (typeof LOCALES)[number]['code'], state: LandingAccountState | null) => {
  const copy = (await load_app_copy(code)).landing_page
  const step = (
    <InterfaceActions
      agent_connect_url="https://app.test/world"
      copy={copy}
      id="telegram"
      links={links}
      on_play={() => undefined}
    />
  )
  const html = renderToStaticMarkup(
    state ? <LandingAccountContext.Provider value={account_in(state)}>{step}</LandingAccountContext.Provider> : step
  )
  return { copy, html }
}

test('the Telegram step is an inert button at build time and never a link out of the page', async () => {
  const { copy, html } = await telegram_step('en', null)
  expect(html).toBe(
    `<button class="aui-button aui-button--primary cta" disabled="" type="button">${copy.chooser.items.telegram.cta}</button>`
  )
  expect(copy.chooser.items.telegram).toMatchObject({ status: 'Waitlist', cta: 'Join the waitlist' })
})

for (const { code } of LOCALES)
  test(`the Telegram step shows one waitlist state at a time in ${code}`, async () => {
    const { copy, html: idle } = await telegram_step(code, signed_in)
    const { waitlist, items } = copy.chooser
    expect(idle).toContain(`type="button">${items.telegram.cta}</button>`)
    expect(idle).not.toContain('disabled')
    // Signed out, the same action is offered: it signs in first.
    expect((await telegram_step(code, initial_landing_account)).html).toBe(idle)
    const signing_in = (await telegram_step(code, { ...initial_landing_account, status: 'connecting' })).html
    expect(signing_in).toContain(`disabled="" type="button">${copy.account.logging_in}</button>`)
    const joining = (await telegram_step(code, { ...signed_in, waitlist: 'joining' })).html
    expect(joining).toContain(`aria-busy="true"`)
    expect(joining).toContain(`disabled="" type="button">${waitlist.joining}</button>`)
    const joined = (await telegram_step(code, { ...signed_in, waitlist: 'joined' })).html
    expect(joined).toBe(`<span class="if-note" role="status">${waitlist.joined}</span>`)
    const failed = (await telegram_step(code, { ...signed_in, waitlist: 'failed' })).html
    expect(failed).toContain(`type="button">${items.telegram.cta}</button>`)
    expect(failed).not.toContain('disabled')
    expect(failed).toContain(`<span class="if-note" data-tone="error" role="alert">${waitlist.failed}</span>`)
    for (const text of [items.telegram.status, items.telegram.cta, ...Object.values(waitlist)])
      expect(text.trim()).not.toBe('')
  })
