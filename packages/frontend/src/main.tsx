// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { dispatch_app, initialize_app_store, observe_app } from './store.ts'
import { DEMO_APP_MODULES, PLAYER_APP_MODULES } from './app_modules.ts'
import { env } from './env.ts'
import { load_game_settings } from './game/core/settings.ts'
import { load_locale } from './i18n/locale.ts'
import { load_app_copy } from './i18n/copy.ts'
import { register_service_worker } from './pwa.ts'
import './tailwind.css'

const requested_quality = import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('quality') : null
initialize_app_store(load_game_settings(env.engine_quality, requested_quality))
const locale = load_locale()
dispatch_app({ type: 'locale/changed', locale })
const root = createRoot(document.getElementById('root')!)
const demo_route = globalThis.location.pathname.replace(/\/+$/, '') === '/demo'

const boot = async (): Promise<void> => {
  if (demo_route) {
    const [{ DemoPage }, copy] = await Promise.all([import('./demo/DemoPage.tsx'), load_app_copy(locale)])
    dispatch_app({ type: 'locale/loaded', locale, copy })
    observe_app(DEMO_APP_MODULES)
    root.render(
      <StrictMode>
        <DemoPage copy={copy} />
      </StrictMode>
    )
    return
  }
  const { App } = await import('./app.tsx')
  observe_app(PLAYER_APP_MODULES)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void register_service_worker()
  .then(boot)
  .catch((error: unknown) => {
    console.error('The application failed to boot.', error)
    root.render(<main className="fixed inset-0 bg-[#0a0a0f]" />)
  })
