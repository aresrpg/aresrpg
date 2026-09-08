// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ITEM STREAM — one door, projection-driven (owner ruling 2026-08-21): the indexer
// publishes projected game-Item writes and pre-state removals (mint, craft, burn, split,
// transfer), and this module pushes the resulting row or deletion to the affected kiosk owner.
// The client never REQUESTS item state — its receipt only unlocks the next action. The
// pubsub envelope fires after the graph write of the same checkpoint, so the read never
// races its own projection. Claims are the same pattern over their own events.

import type { ServerPacket } from '@aresrpg/protocol'

import { channels, type EventEnvelope } from '../protocol.ts'
import { create_watcher } from '../pubsub_bus.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_items',
  observe: ({ pubsub, send, address, signal, dispatch }) => {
    const { watch } = create_watcher(pubsub, signal)
    void watch(channels.social(address), (payload: EventEnvelope) => {
      if (payload.type === 'ItemProjected') send(payload.data.packet as ServerPacket)
    }).catch((error: Error) => log.warn({ address, error: error.message }, 'item watch failed'))

    void watch(channels.economy, (payload: EventEnvelope) => {
      const owner = payload.type === 'GearCrushed' ? payload.data.crusher : payload.data.opener
      if (owner === address && ['LootBoxOpened', 'LootClaimed', 'GearCrushed'].includes(payload.type))
        dispatch({ type: 'action/refresh_account', domain: 'claims' })
    }).catch((error: Error) => log.warn({ address, error: error.message }, 'claim watch failed'))
  },
} satisfies PlayerModule
