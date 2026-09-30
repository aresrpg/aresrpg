// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { AdventurePage } from '../../src/adventure/AdventurePage.tsx'
import { read_pose } from '../../src/game/core/pose_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { ADVENTURE_APP_MODULES, dispatch_app, initialize_app_store, observe_app } from '../../src/store.ts'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'low', render_distance: 2, music_enabled: false, footsteps_enabled: false })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
observe_app(ADVENTURE_APP_MODULES)
declare global {
  interface Window {
    adventure_pose: typeof read_pose
  }
}
window.adventure_pose = read_pose
createRoot(document.getElementById('root')!).render(<AdventurePage copy={copy} />)
