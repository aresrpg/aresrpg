// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Airdrops are a standing push stream: subscribe first, load current graph truth, then
// forward exact remaining counts from claims caused by other players.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_airdrop_state } from '../reads/get_airdrop_state.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_airdrop',
  observe: ({ pubsub, graph, send, address, signal }) => {
    const forward = (payload: EventEnvelope): void => {
      if (payload.type === 'AirdropClaimed') {
        const { claimer, drop_id, remaining } = payload.data as {
          claimer: string
          drop_id: string
          remaining: string
        }
        if (claimer !== address) send({ type: 'packet/airdrop_remaining', drop_id, eligible_count: Number(remaining) })
      }
    }

    pubsub.graph.emitter.on(channels.economy, forward as (payload: unknown) => void)
    void pubsub.graph
      .subscribe(channels.economy)
      .then(() => get_airdrop_state(graph, { address }))
      .then((airdrops) => send({ type: 'packet/airdrop_state', airdrops: [...airdrops] }))
      .catch((error: Error) => {
        log.error({ address, error: error.message }, 'airdrop snapshot failed')
        send({ type: 'packet/error', reason: 'airdrop load failed — reconnect' })
      })

    signal.addEventListener('abort', () => {
      pubsub.graph.emitter.off(channels.economy, forward as (payload: unknown) => void)
      void pubsub.graph.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
