// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Claim invalidations reuse the account reader. The shared inventory reader owns item streaming.

import { channels, type EventEnvelope } from '../protocol.ts'
import { create_watcher } from '../pubsub_bus.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_items',
  observe: ({ pubsub, address, signal, dispatch }) => {
    const { watch } = create_watcher(pubsub, signal)
    void watch(channels.economy, (payload: EventEnvelope) => {
      const owner = payload.type === 'GearCrushed' ? payload.data.crusher : payload.data.opener
      if (owner === address && ['LootBoxOpened', 'LootClaimed', 'GearCrushed'].includes(payload.type))
        dispatch({ type: 'action/refresh_account', domain: 'claims' })
    }).catch((error: Error) => log.warn({ address, error: error.message }, 'claim watch failed'))
  },
} satisfies PlayerModule
