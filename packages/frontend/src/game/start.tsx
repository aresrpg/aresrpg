// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Starts the game document: the world, or one of the two pages that need the engine without a seat.
import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../i18n/copy.ts'
import { load_locale } from '../i18n/locale.ts'
import { MOBILE_VIEWPORT_QUERY, uses_mobile_overlays } from '../player_layout.ts'
import { register_service_worker } from '../pwa.ts'
import { react_error_handlers } from '../reporting.ts'
import { RELOAD_CHECK } from '../startup_recovery.ts'
import { read_app_state, start_app, type AppModule } from '../store.ts'
import { start_telemetry } from '../telemetry.ts'
import { ExternalWalletHost } from '../wallet/ExternalWalletHost.tsx'
import '../tailwind.css'

type Surface = Readonly<{ modules: readonly AppModule[]; seat: boolean; Root: ComponentType }>

/** The fight practice page: the engine and a local fight, no account. */
const practice = async (): Promise<Surface> => {
  const [{ PracticePage }, { PRACTICE_MODULES }] = await Promise.all([
    import('../practice/PracticePage.tsx'),
    import('../practice/modules.ts'),
  ])
  const copy = await load_app_copy(load_locale())
  return { modules: PRACTICE_MODULES, seat: false, Root: () => <PracticePage copy={copy} /> }
}

/** The workshop: the interface parts and the editor, no account. */
const demo = async (): Promise<Surface> => {
  const [{ DemoPage }, { DEMO_MODULES }] = await Promise.all([
    import('../demo/DemoPage.tsx'),
    import('../demo/modules.ts'),
  ])
  const copy = await load_app_copy(load_locale())
  return { modules: DEMO_MODULES, seat: false, Root: () => <DemoPage copy={copy} /> }
}

/** The game itself, on the surface its page has for this window. */
const game = async (): Promise<Surface> => {
  const { GAME_MODULES } = await import('./game_modules.ts')
  if (uses_mobile_overlays(location.pathname, globalThis.matchMedia(MOBILE_VIEWPORT_QUERY).matches)) {
    const { MobileApp } = await import('../mobile/MobileApp.tsx')
    document.documentElement.classList.add('mobile-client')
    return { modules: GAME_MODULES, seat: true, Root: MobileApp }
  }
  const { App } = await import('../app.tsx')
  return { modules: GAME_MODULES, seat: true, Root: App }
}

const SURFACES: Readonly<Record<string, () => Promise<Surface>>> = {
  '/world/practice': practice,
  '/world/demo': demo,
}

/** A reload for an update waits while a sign-in or a transaction is in flight. */
const hold_reload_while_busy = (): void =>
  addEventListener(RELOAD_CHECK, (event) => {
    const { session, external_wallet } = read_app_state()
    try {
      if (
        session.sign_in.status === 'connecting' ||
        external_wallet.request ||
        [session.wallet, external_wallet.session].some((wallet) => wallet && !wallet.is_transaction_idle())
      )
        event.preventDefault()
    } catch (error) {
      event.preventDefault()
      console.warn('App reload safety check failed.', error)
    }
  })

export const start_game = async (): Promise<void> => {
  start_telemetry()
  await register_service_worker()
  const { modules, seat, Root } = await (SURFACES[location.pathname.replace(/\/+$/, '')] ?? game)()
  start_app(modules, { seat })
  hold_reload_while_busy()
  createRoot(document.getElementById('root')!, react_error_handlers).render(
    <StrictMode>
      <ExternalWalletHost />
      <Root />
    </StrictMode>
  )
}
