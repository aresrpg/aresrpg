// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The primary shop is a standing push stream: subscribe first, load current graph truth,
// then forward exact remaining counts from transactions caused by other players.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_shop_state } from '../reads/get_shop_state.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_shop',
  observe: ({ pubsub, graph, send, address, signal }) => {
    const forward = (payload: EventEnvelope): void => {
      if (payload.type === 'SaleBought') {
        const { buyer, item_type, supply } = payload.data as {
          buyer: string
          item_type: string
          supply: string
        }
        if (buyer !== address) send({ type: 'packet/shop_supply', item_type, supply })
      }
      if (payload.type === 'AirdropClaimed') {
        const { claimer, drop_id, remaining } = payload.data as {
          claimer: string
          drop_id: string
          remaining: string
        }
        if (claimer !== address) send({ type: 'packet/airdrop_remaining', drop_id, eligible_count: Number(remaining) })
      }
    }

    pubsub.emitter.on(channels.economy, forward as (payload: unknown) => void)
    void pubsub
      .subscribe(channels.economy)
      .then(() => get_shop_state(graph, { address }))
      .then((state) => send({ type: 'packet/shop_state', ...state }))
      .catch((error: Error) => {
        log.error({ address, error: error.message }, 'shop snapshot failed')
        send({ type: 'packet/error', reason: 'shop load failed — reconnect' })
      })

    signal.addEventListener('abort', () => {
      pubsub.emitter.off(channels.economy, forward as (payload: unknown) => void)
      void pubsub.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
