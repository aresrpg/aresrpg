// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppShell } from '../../src/components/AppShell.tsx'
import type { AuthSession } from '../../src/auth.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_session_state } from '../../src/modules/session.ts'

test('the account card sits below navigation and above language with row actions', async () => {
  const copy = await load_app_copy('en')
  const wallet = Object.freeze({
    address: '0x123456789',
    wallet_name: 'Google',
    sign_personal_message: async () => ({ bytes: '', signature: '' }),
    read_sui_balance: async () => 0n,
    gas_spent_24h: () => 0n,
    derive_character_id: () => '',
    is_character_name_claimed: async () => false,
    resolve_suins_address: async () => null,
    estimate_sui_transfer: async () => 0n,
    send_sui: async () => ({ digest: null }),
    create_seed_admin: async () => {
      throw new Error('not used while rendering')
    },
    read_marketplace_royalties: async () => [],
    claim_marketplace_royalties: async () => ({ digest: '', amount_mist: 0n, policies: [] }),
    disconnect: async () => undefined,
  }) satisfies AuthSession
  const html = renderToStaticMarkup(
    <AppShell
      change_locale={() => undefined}
      copy={copy}
      disconnect={() => undefined}
      locale="en"
      open_page={() => undefined}
      open_path={() => undefined}
      page="world"
      pathname="/"
      select_character={() => undefined}
      session={Object.freeze({
        ...initial_session_state(),
        wallet,
        sui_balance_mist: 1_250_000_000n,
        gas_spent_mist: 20_000_000n,
      })}
    />
  )

  expect(html.indexOf('data-app-sidebar')).toBeLessThan(html.indexOf('data-wallet-card'))
  expect(html.indexOf('data-wallet-card')).toBeLessThan(html.indexOf('data-language-card'))
  expect(html).toContain('data-wallet-actions=""')
  expect(html).toContain('class="flex flex-col gap-1"')
  const simulator_button = html.match(/<button[^>]*data-page="simulator"[^>]*>/)?.[0]
  expect(simulator_button).toBeDefined()
  expect(simulator_button).not.toContain('disabled')
})
