// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A hosted bot's own status, published from its game seat for the owners observing its account.
// A status speaks only for the address that signed this socket; the server relays it and keeps nothing.

import type { AgentStatus } from '@aresrpg/protocol'

import { create_watcher } from '../pubsub_bus.ts'
import { mesh } from '../protocol.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_agent_status',
  // The first shared status marks this socket as a hosted bot for the cluster's population count.
  reduce: (state, action) =>
    action.type === 'packet/agent_status' && !state.agent ? { ...state, agent: true } : state,
  observe: ({ address, events, pubsub, send, signal }) => {
    const relay = (status: AgentStatus | null) => {
      void pubsub.mesh.publish(mesh.agent_status(address), status)
    }
    events.on('packet/agent_status', ({ status }: { status: AgentStatus }) => relay(status))
    // From its first status on, this socket answers owners who start watching, and says when it closes.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (!state.agent || previous.agent) return
      void create_watcher(pubsub, signal)
        .watch(mesh.agent_status_wanted(address), () => send({ type: 'packet/agent_status_wanted' }))
        .catch((error: unknown) => log.warn({ err: error }, 'agent status request watch failed'))
      signal.addEventListener('abort', () => relay(null), { once: true })
    })
  },
} satisfies PlayerModule
