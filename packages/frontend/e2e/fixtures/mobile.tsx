// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { App } from '../../src/app.tsx'
import { adventure_character } from '../../src/adventure/character.ts'
import { adventure_fight_setup } from '../../src/adventure/fight_setup.ts'
import type { AuthSession } from '../../src/auth.ts'
import { TUTORIAL_IDS } from '../../src/tutorial/tutorial.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { initialize_app_store, dispatch_app, read_app_state, observe_app } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import { MobileApp } from '../../../mobile/src/MobileApp.tsx'
import '../../src/tailwind.css'
import '../../../mobile/src/mobile.css'

// Exercise the real player shell and local fight lifecycle without network or GPU observers.
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
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/party',
    character_id: character().id,
    party: {
      id: 'fixture-party',
      invited: [],
      members: [
        { character_id: character().id, name: 'Leader' },
        ...['Companion', 'Rin', 'Kaori', 'Moka', 'Haru'].map((name) => ({ character_id: name, name })),
      ],
    },
  },
})
declare global {
  interface Window {
    mobile_fight: (mounted: boolean) => void
    mobile_fight_active: () => boolean
  }
}
observe_app(['fight'])
window.mobile_fight = (mounted) =>
  dispatch_app(
    mounted
      ? { type: 'fight/opened', mode: 'local', setup: adventure_fight_setup(adventure_character(), 0), seed: 42n }
      : { type: 'fight/closed', fight: null }
  )
window.mobile_fight_active = () => read_app_state().fight.mounted
const Surface = new URLSearchParams(location.search).has('desktop') ? App : MobileApp
createRoot(document.getElementById('root')!).render(<Surface />)
