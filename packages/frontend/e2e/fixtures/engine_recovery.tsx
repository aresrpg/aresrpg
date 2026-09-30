// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { App } from '../../src/app.tsx'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { initialize_app_store, observe_app, read_app_state, dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    read_engine_recovery: () => ReturnType<typeof read_app_state>['engine']
  }
}

initialize_app_store(load_game_settings('high'))
window.read_engine_recovery = () => read_app_state().engine
observe_app(['engine', 'settings', 'locale'])
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: '0xfixture' } as AuthSession })
createRoot(document.getElementById('root')!).render(<App />)
