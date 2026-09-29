// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

import {
  dispatch_app,
  initialize_app_store,
  observe_app,
  ADVENTURE_APP_MODULES,
  DEMO_APP_MODULES,
  PLAYER_APP_MODULES,
  type AppModuleName,
} from './store.ts'
import { load_app_copy } from './i18n/copy.ts'
import { load_locale, type Locale } from './i18n/locale.ts'
import { env } from './env.ts'
import { load_game_settings } from './game/core/settings.ts'
import { register_service_worker } from './pwa.ts'
import { react_error_handlers, report_error } from './reporting.ts'
import { MOBILE_VIEWPORT_QUERY, uses_mobile_overlays } from './player_layout.ts'

const load_surface = async (
  locale: Locale
): Promise<Readonly<{ Surface: ComponentType; modules: readonly AppModuleName[] }>> => {
  const route = globalThis.location.pathname.replace(/\/+$/, '')
  if (route === '/play-demo') {
    const [{ AdventurePage }, copy] = await Promise.all([
      import('./adventure/AdventurePage.tsx'),
      load_app_copy(locale),
    ])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: () => <AdventurePage copy={copy} />, modules: ADVENTURE_APP_MODULES }
  }
  if (route === '/demo') {
    const [{ DemoPage }, copy] = await Promise.all([import('./demo/DemoPage.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    return { Surface: () => <DemoPage copy={copy} />, modules: DEMO_APP_MODULES }
  }
  if (uses_mobile_overlays(globalThis.location.pathname, globalThis.matchMedia(MOBILE_VIEWPORT_QUERY).matches)) {
    const { MobileApp } = await import('../../mobile/src/MobileApp.tsx')
    document.documentElement.classList.add('mobile-client')
    return { Surface: MobileApp, modules: PLAYER_APP_MODULES }
  }
  const { App } = await import('./app.tsx')
  return { Surface: App, modules: PLAYER_APP_MODULES }
}

export const boot_game = (): void => {
  const requested_quality = import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('quality') : null
  initialize_app_store(load_game_settings(env.engine_quality, requested_quality))
  const locale = load_locale()
  dispatch_app({ type: 'locale/changed', locale })
  const root = createRoot(document.getElementById('root')!, react_error_handlers)
  void register_service_worker()
    .then(async () => {
      const { Surface, modules } = await load_surface(locale)
      observe_app(modules)
      root.render(
        <StrictMode>
          <Surface />
        </StrictMode>
      )
    })
    .catch((error: unknown) => {
      report_error(error, { area: 'boot' })
      root.render(<main className="fixed inset-0 bg-bg" />)
    })
}
