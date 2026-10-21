// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PlayerAction, PlayerModule } from '../player.ts'

export default {
  name: 'player_allocation',
  observe: ({ events, address, allocation, send, signal }) => {
    let pending = false
    events.on('packet/allocation_request', (packet: Extract<PlayerAction, { type: 'packet/allocation_request' }>) => {
      if (pending || !allocation) {
        send({
          type: 'packet/allocation_response',
          id: packet.id,
          result: { action: 'error', error: pending ? 'rate_limited' : 'unavailable' },
        })
        return
      }
      pending = true
      void allocation
        .request(address, packet.request)
        .then((result) => {
          if (!signal.aborted) send({ type: 'packet/allocation_response', id: packet.id, result })
        })
        .catch(() => {
          if (!signal.aborted)
            send({
              type: 'packet/allocation_response',
              id: packet.id,
              result: { action: 'error', error: 'unavailable' },
            })
        })
        .finally(() => {
          pending = false
        })
    })
  },
} satisfies PlayerModule
