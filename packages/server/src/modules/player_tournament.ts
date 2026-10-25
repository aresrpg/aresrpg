// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ServerPacket } from '@aresrpg/protocol'

import { create_watcher } from '../pubsub_bus.ts'
import { latest_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import { channels } from '../protocol.ts'
import { get_tournaments } from '../reads/get_tournaments.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)
export default {
  name: 'player_tournament',
  observe: ({ pubsub, send, signal, graph, address }) => {
    const unavailable = (): ServerPacket => ({ type: 'packet/tournaments_error', reason: 'unavailable' })
    const push = latest_reader(
      async (): Promise<ServerPacket> => {
        try {
          return { type: 'packet/tournaments', tournaments: await get_tournaments(graph, address) }
        } catch (error) {
          log.error({ err: error }, 'tournament read failed')
          return unavailable()
        }
      },
      (packet) => {
        if (!signal.aborted) send(packet)
      }
    )
    const refresh = (): void => {
      void push().catch((error: Error) => log.error({ error: error.message }, 'tournament read failed'))
    }
    const { watch } = create_watcher(pubsub, signal)
    void watch(channels.tournament, refresh)
      .then(() => {
        if (!signal.aborted) refresh()
      })
      .catch((error: Error) => {
        log.error({ error: error.message }, 'tournament watch failed')
        if (!signal.aborted) send(unavailable())
      })
  },
} satisfies PlayerModule
