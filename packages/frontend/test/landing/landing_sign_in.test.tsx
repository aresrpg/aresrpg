// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore } from 'zustand/vanilla'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { LandingAccount } from '../../src/landing/LandingAccount.tsx'
import {
  initial_landing_account,
  type LandingAccountRuntime,
  type LandingAccountState,
} from '../../src/landing/landing_account.ts'

const account_in = (state: LandingAccountState, wallet_names: LandingAccountRuntime['wallet_names']) =>
  ({
    store: createStore<LandingAccountState>(() => state),
    wallet_names,
    warm: () => undefined,
  }) as unknown as LandingAccountRuntime
const no_wallets = async (): Promise<readonly string[]> => []

for (const { code } of LOCALES)
  test(`the sign-in menu and its development hint exist only where wallets are offered in ${code}`, async () => {
    const copy = (await load_app_copy(code)).landing_page.account
    const render = (state: LandingAccountState, names: LandingAccountRuntime['wallet_names']) =>
      renderToStaticMarkup(<LandingAccount auth={account_in(state, names)} copy={copy} />)
    const production = render(initial_landing_account, null)
    expect(production).toBe(`<button class="landing-account" type="button">${copy.login}</button>`)
    const dev = render(initial_landing_account, no_wallets)
    expect(dev).toContain('popover="auto"')
    // The hint is about the wallets: it shows with them, never beside Google alone.
    expect(copy.dev_only.length).toBeGreaterThan(0)
    expect(dev).not.toContain(copy.dev_only)
    // A sign-in in flight shows the one busy control, never a menu.
    const busy = render({ ...initial_landing_account, status: 'connecting' }, no_wallets)
    expect(busy).not.toContain('popover')
    expect(busy).toContain(copy.logging_in)
  })
