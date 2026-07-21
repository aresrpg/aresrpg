// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #dappkit-modal ACCEPTANCE — mirrors wallet_connect_gate.test.ts at the COMPONENT level. The pure gate
// (auth/wallet_connect_gate.test.ts) already proves wallet_connect_enabled() folds correctly per
// deployment environment; this proves the CONNECT WALLET trigger itself is actually absent/present in the
// rendered markup, not just that the boolean is right — a production release must never ship the picker,
// preview/dev builds must. __DEPLOY_ENV__ is a vite build-time `define` (never present under bun:test),
// so it is mocked via globalThis — the SAME pattern this repo already uses for other build-time globals
// (game/screens/hud/world/engine_flags_pref.test.js, world-shell/kiosk_resolve.test.js).
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import i18n from '../i18n'
// auth/dapp_kit_providers.tsx needs ../auth's SUI_NETWORK without evaluating the real module (it assumes
// `window`, absent in bun:test) — the shared process-global mock supplies it. See auth/components.test.tsx.
import { reset_auth_mock } from '../test_helpers/auth_mock.js'

reset_auth_mock()

// pages/auth.tsx's SpectateOverlay/SpectateLanding render the read-only world chat overlay, which pulls in
// world-shell's dungeon run store — a pre-existing import-cycle landmine (a `use_auth` TDZ ReferenceError)
// that only manifests when auth.tsx is imported cold, outside main.tsx's normal boot order (nothing has
// unit-tested this file directly before this ticket). The chat is unrelated decoration for the
// wallet-connect gate under test; neutralize it so the REAL pages/auth.tsx still loads and runs unmodified
// — same dependency-isolation technique as the auth mock above, scoped to one unrelated component.
mock.module('../game/screens/hud/world/WorldChat.jsx', () => ({ WorldChat: () => null }))

const { DappKitProviders } = await import('../auth/dapp_kit_providers')
const { LoginPopup } = await import('./auth')

const noop = () => {}

const render_login_popup = () =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DappKitProviders>
        <LoginPopup on_login={noop} on_connect_wallet={noop} on_spectate={noop} loading={false} />
      </DappKitProviders>
    </I18nextProvider>
  )

describe('LoginPopup — the #dappkit-modal CONNECT WALLET trigger honors the #73 build-time gate', () => {
  afterEach(() => {
    // no residue for other files sharing this bun:test process
    delete (globalThis as Record<string, unknown>).__DEPLOY_ENV__
  })

  test('a Vercel production deployment never renders the trigger (#73 acceptance, component level)', () => {
    ;(globalThis as Record<string, unknown>).__DEPLOY_ENV__ = 'production'
    const html = render_login_popup()
    expect(html).not.toContain('Connect wallet')
  })

  test('a Vercel preview deployment renders the trigger (zkLogin cannot complete on preview URLs)', () => {
    ;(globalThis as Record<string, unknown>).__DEPLOY_ENV__ = 'preview'
    const html = render_login_popup()
    expect(html).toContain('Connect wallet')
  })

  test('a local build (no VERCEL_ENV) renders the trigger', () => {
    delete (globalThis as Record<string, unknown>).__DEPLOY_ENV__
    const html = render_login_popup()
    expect(html).toContain('Connect wallet')
  })

  test('the Google button and Spectate option render in every environment (unaffected by the gate)', () => {
    ;(globalThis as Record<string, unknown>).__DEPLOY_ENV__ = 'production'
    const html = render_login_popup()
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Watch the live world')
  })
})
