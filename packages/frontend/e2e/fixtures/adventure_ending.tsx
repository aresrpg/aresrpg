// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { create_fight_state } from '@aresrpg/fight'

import { App } from '../../src/app.tsx'
import type { AuthSession } from '../../src/auth.ts'
import { AdventureRuntime } from '../../src/adventure/AdventureRuntime.tsx'
import { adventure_fight_setup } from '../../src/adventure/fight_setup.ts'
import { read_pose } from '../../src/game/core/pose_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store, observe_app, read_app_state } from '../../src/store.ts'
import source from '../../../../seed/content/adventure.json'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'low', render_distance: 2, music_enabled: false, footsteps_enabled: false })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const victory = new URLSearchParams(location.search).has('victory')
const settle = (winner: bigint) => {
  dispatch_app({ type: 'adventure/challenge' })
  const { character, companion, encounter } = read_app_state().adventure
  const checkpoint = create_fight_state(adventure_fight_setup(character!, encounter, companion))
  dispatch_app({
    type: 'adventure/settled',
    checkpoint: {
      ...checkpoint,
      contract: { ...checkpoint.contract, ended: true, winner, ended_ms: 10_000n },
    },
  })
  dispatch_app({ type: 'fight/closed', fight: null })
}
const finish_tutorial = () => {
  settle(0n)
  dispatch_app({ type: 'adventure/result_acknowledged', screen: 'level' })
  dispatch_app({ type: 'adventure/result_acknowledged', screen: 'result' })
  for (let step = 0; step <= source.dialogue.length; step++) dispatch_app({ type: 'adventure/talk' })
  dispatch_app({ type: 'adventure/invite' })
  dispatch_app({ type: 'adventure/select', character_id: source.companion.id })
  dispatch_app({ type: 'adventure/select', character_id: read_app_state().adventure.character!.id })
  dispatch_app({ type: 'adventure/follow', enabled: true })
  settle(0n)
  dispatch_app({ type: 'adventure/result_acknowledged', screen: 'result' })
  settle(victory ? 0n : 1n)
}
// Substitute only the external authentication/network boundary. Rendering and the player runtime stay real.
const activate_player = () => {
  const stop = observe_app(['navigation', 'settings', 'audio'])
  dispatch_app({ type: 'auth/ready', wallets: [] })
  return stop
}
declare global {
  interface Window {
    ending_probe: {
      snapshot: () => { phase: string; yaw: number | null; auth: unknown; ready: boolean }
      finish: typeof finish_tutorial
      fail_login: () => void
      accept_login: () => void
    }
  }
}
window.ending_probe = {
  snapshot: () => ({
    phase: read_app_state().adventure.phase,
    yaw: read_pose()?.yaw ?? null,
    auth: read_app_state().session.auth_request,
    ready: read_app_state().session.auth_ready,
  }),
  finish: finish_tutorial,
  fail_login: () => dispatch_app({ type: 'auth/failed', error: 'Google login cancelled' }),
  accept_login: () => {
    dispatch_app({ type: 'auth/connected', session: { address: '0x1' } as AuthSession })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/connection_accepted', address: '0x1' } })
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [] } })
  },
}
createRoot(document.getElementById('root')!).render(
  <AdventureRuntime copy={copy} Player={App} activate_player={activate_player} />
)
