// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentSetupResult } from '@aresrpg/protocol'

import type { PlayerAction, PlayerModule } from '../player.ts'

export default {
  name: 'player_agent_setup',
  observe: ({ events, address, agent_pairing, send, signal }) => {
    const pending = new Set<'read' | 'cancel'>()
    const reply = (id: number, result: AgentSetupResult) => {
      if (!signal.aborted) send({ type: 'packet/agent_setup_response', id, result })
    }
    events.on('packet/agent_setup_request', (packet: Extract<PlayerAction, { type: 'packet/agent_setup_request' }>) => {
      // Revocation must not queue behind a read; both lanes remain single-flight.
      const lane = packet.request.action === 'cancel' ? 'cancel' : 'read'
      if (pending.has(lane) || !agent_pairing) {
        reply(packet.id, { action: 'error', error: pending.has(lane) ? 'rate_limited' : 'unavailable' })
        return
      }
      pending.add(lane)
      void agent_pairing
        .request(address, packet.request)
        .then((result) => reply(packet.id, result))
        .catch(() => {
          const failure = { action: 'error', error: 'unavailable' } as const
          reply(packet.id, failure)
          return { ok: false, error: failure.error }
        })
        .finally(() => {
          pending.delete(lane)
        })
    })
  },
} satisfies PlayerModule
