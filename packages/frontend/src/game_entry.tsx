// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { ExternalWalletHost } from './wallet/ExternalWalletHost.tsx'
import {
  dispatch_app,
  read_app_state,
  useAppStore,
  initialize_app_store,
  observe_app,
  DEMO_APP_MODULES,
  PRACTICE_APP_MODULES,
  PLAYER_APP_MODULES,
  DAPP_APP_MODULES,
  ACCOUNT_APP_MODULES,
  type AppModuleName,
} from './store.ts'
import { DAPP_ROUTE, dapp_consent_requested, read_pending, session_storage } from './dapp/oauth.ts'
import { load_app_copy, type AppCopy } from './i18n/copy.ts'
import { load_locale, type Locale } from './i18n/locale.ts'
import { env } from './env.ts'
import { is_agent_entry } from './agents/entry_intent.ts'
import { load_game_settings } from './game/core/settings.ts'
import { RELOAD_CHECK } from './startup_recovery.ts'
import { register_service_worker } from './pwa.ts'
import { react_error_handlers, report_error } from './reporting.ts'
import { MOBILE_VIEWPORT_QUERY, uses_mobile_overlays } from './player_layout.ts'
import { show_boot_failure } from './boot_loading.ts'

const load_player_surface = async (pathname: string): Promise<ComponentType> => {
  if (uses_mobile_overlays(pathname, globalThis.matchMedia(MOBILE_VIEWPORT_QUERY).matches)) {
    const { MobileApp } = await import('../../mobile/src/MobileApp.tsx')
    document.documentElement.classList.add('mobile-client')
    return MobileApp
  }
  const { App } = await import('./app.tsx')
  return App
}

/** A page follows the store's copy and locale, so a language change repaints it without a reload. */
const live = (initial: AppCopy, render: (copy: AppCopy, locale: Locale) => ReactNode): ComponentType =>
  function LivePage() {
    const copy = useAppStore((state) => state.copy) ?? initial
    const locale = useAppStore((state) => state.locale)
    return render(copy, locale)
  }

const load_surface = async (
  locale: Locale
): Promise<Readonly<{ Surface: ComponentType; modules: readonly AppModuleName[] }>> => {
  const route = globalThis.location.pathname.replace(/\/+$/, '')
  if (route === '/practice') {
    const [{ PracticePage }, copy] = await Promise.all([import('./practice/PracticePage.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: () => <PracticePage copy={copy} />, modules: PRACTICE_APP_MODULES }
  }
  // The engine-less dapp also receives the bot's consent redirect when this tab started that request.
  if (
    route === DAPP_ROUTE ||
    dapp_consent_requested(globalThis.location, read_pending(session_storage(), Date.now()))
  ) {
    const [{ DappPage }, copy] = await Promise.all([import('./dapp/DappPage.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return {
      Surface: live(copy, (now, language) => <DappPage copy={now} locale={language} />),
      modules: DAPP_APP_MODULES,
    }
  }
  // Connect Your Agent is a page of its own: neither its entry link nor a consent link loads the world.
  if (is_agent_entry(globalThis.location)) {
    const [{ ConnectAgentRoute }, copy] = await Promise.all([
      import('./agents/ConnectAgentRoute.tsx'),
      load_app_copy(locale),
    ])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: live(copy, (now) => <ConnectAgentRoute copy={now} />), modules: ACCOUNT_APP_MODULES }
  }
  if (route === '/kares') {
    const [{ KaresRoute }, copy] = await Promise.all([import('./kares/KaresRoute.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: live(copy, (now) => <KaresRoute copy={now} />), modules: ACCOUNT_APP_MODULES }
  }
  if (route === '/demo') {
    const [{ DemoPage }, copy] = await Promise.all([import('./demo/DemoPage.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: () => <DemoPage copy={copy} />, modules: DEMO_APP_MODULES }
  }
  const [Surface, copy] = await Promise.all([load_player_surface(globalThis.location.pathname), load_app_copy(locale)])
  dispatch_app({ type: 'locale/loaded', locale, copy })
  return { Surface, modules: PLAYER_APP_MODULES }
}

export const boot_game = (): void => {
  const requested_quality = import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('quality') : null
  initialize_app_store(load_game_settings(env.engine_quality, requested_quality))
  addEventListener(RELOAD_CHECK, (event) => {
    const { session, external_wallet } = read_app_state()
    try {
      if (
        session.auth_request ||
        external_wallet.request ||
        [session.wallet, external_wallet.session].some((wallet) => wallet && !wallet.is_transaction_idle())
      )
        event.preventDefault()
    } catch (error) {
      event.preventDefault()
      console.warn('App reload safety check failed.', error)
    }
  })
  const locale = load_locale()
  dispatch_app({ type: 'locale/changed', locale })
  const root = createRoot(document.getElementById('root')!, react_error_handlers)
  void register_service_worker()
    .then(async () => {
      const { Surface, modules } = await load_surface(locale)
      observe_app(modules)
      root.render(
        <StrictMode>
          <ExternalWalletHost />
          <Surface />
        </StrictMode>
      )
    })
    .catch((error: unknown) => {
      report_error(error, { area: 'boot' })
      show_boot_failure()
    })
}
