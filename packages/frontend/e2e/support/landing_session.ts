// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page } from '@playwright/test'

const auth_chunk = /\/assets\/auth-[^/]+\.js$/
const SIGNED_IN_AUTH = `
const session = { address: '0x' + '7'.repeat(64), wallet_name: 'E2E Wallet', disconnect: async () => {}, dispose() {} }
export const create_auth = () => ({
  connect_google: async () => session,
  restore: async () => session,
  wallets: () => [],
  dispose() {},
})
export const create_external_auth = create_auth
`

/** The home page restores a remembered account before Play enters the game; the sign-in provider is replaced. */
export const remember_signed_in = async (page: Page): Promise<void> => {
  await page.route(auth_chunk, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: SIGNED_IN_AUTH })
  )
  await page.addInitScript(() => localStorage.setItem('last_wallet', 'E2E Wallet'))
}
