// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app.tsx'
import { dispatch_app, initialize_app_store, observe_app } from './store.ts'
import { env } from './env.ts'
import { load_game_settings } from './game/core/settings.ts'
import { load_locale } from './i18n/locale.ts'
import { register_service_worker } from './pwa.ts'
import './tailwind.css'

const requested_quality = import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('quality') : null
initialize_app_store(load_game_settings(env.engine_quality, requested_quality))
dispatch_app({ type: 'locale/changed', locale: load_locale() })
observe_app()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

register_service_worker()
