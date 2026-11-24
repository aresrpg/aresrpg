// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the fights ask of the server: previews, resyncs, the played character's actions and the fights it spectates.
import { fight_action_to_wire } from '@aresrpg/fight'

import type { AppContext } from '../store.ts'

import { spectator_changes } from './fight_identity.ts'

export const observe_fight_link = ({ events, dispatch, get_state }: AppContext): void => {
  events.on('fight/watch', ({ character_id, fight }) =>
    dispatch({ type: 'server/send', packet: { type: 'packet/fight_preview', character_id, fight } })
  )
  events.on('fight/resync', ({ fight }) =>
    dispatch({ type: 'server/send', packet: { type: 'packet/fight_resync', fight } })
  )
  events.on('fight/input', ({ fight, input, origin }) => {
    const state = get_state()
    if (state.session.agent_view.request || input.type === 'end_turn') return
    const action = fight_action_to_wire(input)
    if (origin !== 'local' || !fight || state.fight.environments[fight]?.transaction_pending || !action) return
    dispatch({ type: 'server/send', packet: { type: 'packet/fight_action', fight, action } })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const reconnected = state.session.link_status === 'ready' && previous.session.link_status !== 'ready'
    spectator_changes(state.fight.spectating_by_character, previous.fight.spectating_by_character, reconnected).forEach(
      (change) => dispatch({ type: 'server/send', packet: { type: 'packet/spectate', ...change } })
    )
  })
}
