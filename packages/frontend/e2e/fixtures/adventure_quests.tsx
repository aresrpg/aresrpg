// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { create_fight, create_fight_state } from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'

import { capture_audio, type AudioPlayback } from '../support/audio_capture.ts'
import { AdventureHud, AdventurePartyFrame } from '../../src/adventure/AdventureHud.tsx'
import { WorldSocialDock } from '../../src/game/hud/WorldSocialDock.tsx'
import { CompanionInteraction } from '../../src/adventure/CompanionInteraction.tsx'
import { adventure_fight_setup } from '../../src/adventure/fight_setup.ts'
import { dispatch_app, observe_app, read_app_state } from '../../src/store.ts'
import { publish_pose } from '../../src/game/core/pose_feed.ts'
import type { create_world } from '../../src/game/core/world.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const audio_events: AudioPlayback[] = []
capture_audio((record) => audio_events.push(record))
declare global {
  interface Window {
    adventure_audio: readonly AudioPlayback[]
  }
}
window.adventure_audio = audio_events
observe_app(['settings', 'audio', 'adventure', 'fight'])
dispatch_app({ type: 'adventure/entered' })
publish_pose({ character_id: 'adventure_senshi', x: 129, y: 80, z: 196, yaw: Math.PI, time_of_day: 0.3, riding: false })
const captions = document.createElement('div')
captions.setAttribute('data-speech', '')
captions.style.setProperty('position', 'fixed')
captions.style.setProperty('top', '400px')
captions.style.setProperty('left', '400px')
document.body.append(captions)
const world = {
  set_world_label: (_id: string, element: HTMLElement | null) => {
    if (element) {
      element.style.setProperty('position', 'fixed')
      element.style.setProperty('left', '400px')
      element.style.setProperty('top', '300px')
      document.body.append(element)
    }
  },
  set_entity_caption: (_id: string, caption: Readonly<{ speech?: string }> | null) => {
    captions.textContent = caption?.speech ?? ''
  },
} as unknown as ReturnType<typeof create_world>

const finish = (boss = false) => {
  dispatch_app({ type: 'adventure/challenge' })
  const state = read_app_state()
  const setup = adventure_fight_setup(state.adventure.character!, state.adventure.encounter, state.adventure.companion)
  const game = create_fight({ state: create_fight_state(setup), mode: 'local', seed: 42n })
  if (boss) {
    setup.players.forEach((_, index) => game.apply({ type: 'ready', fighter: BigInt(index) }))
    game.apply({ type: 'start', observed_ms: 60000n })
    for (let turn = 0; turn < 24 && !game.state().contract.ended; turn++)
      game.simulate_turn({ observed_ms: game.state().contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms })
  }
  const checkpoint = game.state()
  dispatch_app({
    type: 'adventure/settled',
    checkpoint: boss
      ? checkpoint
      : { ...checkpoint, contract: { ...checkpoint.contract, ended: true, winner: 0n, ended_ms: 10000n } },
  })
  dispatch_app({ type: 'fight/closed', fight: null })
}

createRoot(document.getElementById('root')!).render(
  <>
    <WorldSocialDock copy={copy}>
      <AdventurePartyFrame copy={copy} />
    </WorldSocialDock>
    <div style={{ position: 'fixed', bottom: 10, right: 10, zIndex: 200 }}>
      <button data-win onClick={() => finish()}>
        Win encounter
      </button>
      <button data-boss onClick={() => finish(true)}>
        Resolve boss
      </button>
    </div>
    <AdventureHud copy={copy} challenge={() => dispatch_app({ type: 'adventure/challenge' })} />
    <CompanionInteraction copy={copy} world={world} canvas={null} />
  </>
)
