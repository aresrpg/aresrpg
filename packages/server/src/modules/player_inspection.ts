// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { PlayerModule } from '../player.ts'
import { read_inspection } from '../reads/get_player_profile.ts'
import logger from '../logger.ts'

const log = logger(import.meta)

export default {
  name: 'player_inspection',
  reduce: (state, action) => {
    if (action.type === 'packet/inspection_request') return { ...state, inspection: action }
    if (action.type === 'close') return { ...state, inspection: null }
    return state
  },
  observe: ({ events, get_state, graph, send, signal }) => {
    let running = false
    const refresh = (): void => {
      const request = get_state().inspection
      if (running || signal.aborted || !request?.query) return
      running = true
      const valid = (): boolean => !signal.aborted && get_state().inspection === request
      void read_inspection(graph, request.query)
        .then((result) => {
          if (valid()) send({ type: 'packet/inspection_result', id: request.id, result })
        })
        .catch((error: unknown) => {
          log.warn({ err: error }, 'player inspection failed')
          if (valid()) send({ type: 'packet/inspection_error', id: request.id })
        })
        .finally(() => {
          running = false
          // The reducer retains only the latest intent; superseded clicks never form a queue.
          if (get_state().inspection !== request) refresh()
        })
    }
    events.on('STATE_UPDATED', (state, previous) => {
      if (state.inspection !== previous.inspection) refresh()
    })
  },
} satisfies PlayerModule
