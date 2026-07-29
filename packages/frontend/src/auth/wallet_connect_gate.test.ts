// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { wallet_connect_enabled } from './wallet_connect_gate'

// #73 ACCEPTANCE — the wallet-connect visibility gate resolves from Vite's build mode, NOT a
// deployment-provider variable and NOT CSS. A production bundle must never enable the option, whether
// Vercel built it or not; a dev-mode bundle must.
describe('wallet_connect_enabled — build-time gate', () => {
  test('a production build NEVER enables the wallet-connect option (#73 acceptance)', () => {
    expect(wallet_connect_enabled(true)).toBe(false)
  })

  test('a development build enables it', () => {
    expect(wallet_connect_enabled(false)).toBe(true)
  })
})
