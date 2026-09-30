// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import type { AuthSession } from '../../src/auth.ts'
import { TUTORIAL_IDS } from '../../src/tutorial/tutorial.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initialize_app_store, dispatch_app } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import { MobileApp } from '../../../mobile/src/MobileApp.tsx'
import '../../src/tailwind.css'
import '../../../mobile/src/mobile.css'

// Exercise the actual canvas owner and orientation guard without network or GPU observers.
initialize_app_store({ quality: 'low', music_enabled: false, render_distance: 2, completed_tutorials: TUTORIAL_IDS })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: 'fixture' } as AuthSession })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character()] } })
dispatch_app({ type: 'character/select', character_id: character().id })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/server_info',
    online: 1,
    indexing_lag: 0,
    current_epoch: '1',
    chain_timestamp_ms: Date.now(),
    chain_sample_age_ms: 0,
  },
})
createRoot(document.getElementById('root')!).render(<MobileApp />)
