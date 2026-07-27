// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #dappkit-modal ACCEPTANCE — the hand-rolled per-wallet button list is gone; WalletConnectSection now
// opens the REAL @mysten/dapp-kit ConnectModal. Two things are asserted here:
//  1. bridge_wallet_name — the PURE connection -> session-bridge decision (no jsdom/RTL in this repo, so
//     dapp-kit's async connect handshake can't be driven through a live click; the decision is extracted
//     so it is unit-testable on its own, same pattern as image_retry.test.jsx's reducer split).
//  2. The gothic trigger renders (structural smoke test) with the right label/disabled behavior, proving
//     ConnectModal mounts cleanly under DappKitProviders in a closed (unopened) state via
//     renderToStaticMarkup — no live wallet or DOM interaction required.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import i18n from '../i18n'
// auth/dapp_kit_providers.tsx reads SUI_NETWORK from ../auth (auth/index.ts), whose module body registers
// the real Enoki wallet — that needs `window`, which this bare bun:test runtime does not provide. The
// shared process-global mock (established pattern — see roster/boot_roster.test.js) supplies SUI_NETWORK
// without evaluating the real module; the dynamic imports below run AFTER it registers.
import { reset_auth_mock } from '../test_helpers/auth_mock.js'

reset_auth_mock()

const { DappKitProviders } = await import('./dapp_kit_providers')
const { bridge_wallet_name, WalletConnectSection } = await import('./components')

describe('bridge_wallet_name — the dapp-kit connection -> use_auth session seam', () => {
  test('a connected wallet resolves its name', () => {
    expect(bridge_wallet_name({ isConnected: true, currentWallet: { name: 'Slush' } })).toBe('Slush')
  })

  test('connecting (not yet connected) never bridges', () => {
    expect(bridge_wallet_name({ isConnected: false, currentWallet: null })).toBeNull()
  })

  test('disconnected never bridges even if a stale wallet object lingers', () => {
    expect(bridge_wallet_name({ isConnected: false, currentWallet: { name: 'Phantom' } })).toBeNull()
  })
})

const render = (loading?: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DappKitProviders>
        <WalletConnectSection on_connect={() => {}} loading={loading} />
      </DappKitProviders>
    </I18nextProvider>
  )

describe('WalletConnectSection — the real dapp-kit ConnectModal trigger', () => {
  test('renders the gothic "Connect wallet" trigger, closed by default', () => {
    const html = render()
    expect(html).toContain('Connect wallet')
    expect(html).toContain('<button')
  })

  test('the trigger disables while another auth action is loading (parity with the old per-wallet buttons)', () => {
    const html = render(true)
    expect(html).toContain('disabled')
  })
})
