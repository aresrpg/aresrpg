// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { App } from '../../src/app.tsx'
import type { AuthSession } from '../../src/auth.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, observe_app, read_app_state } from '../../src/store.ts'
import { initialize_automation_app } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

initialize_automation_app({ dispatch: dispatch_app }, { address: '0x1' } as AuthSession)
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
observe_app(['engine', 'run_to'])
Reflect.set(window, 'background_run_state', () => ({ pose: read_pose(), run: read_app_state().run_to.run }))
Reflect.set(window, 'background_run_start', () =>
  dispatch_app({ type: 'run_to/position', world: 'nauvis', x: 50_050, z: 50_000 })
)
Reflect.set(window, 'background_run_page', () => dispatch_app({ type: 'page/open', page: 'marketplace' }))
createRoot(document.getElementById('root')!).render(<App />)
