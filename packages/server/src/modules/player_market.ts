// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MARKET STREAM. Two independent stakes on the ONE evt:economy channel (watched standing):
//   yours — a MarketPurchased whose indexed kiosk owner is YOU is money arriving: always forwarded;
//   browse — packet/market_observe folds the exact category window DIRECTLY;
//            the delta pushes its graph slice + retained history, then deltas stream while observed.
// A listed event names an id; the row the client renders is enriched from the graph.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_market_history } from '../reads/get_market_history.ts'
import { get_market_counts, get_market_listing, get_market_slice } from '../reads/get_market_slice.ts'
import { latest_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_market',

  reduce: (state, action) => {
    if (action.type === 'packet/market_observe') return { ...state, market_observation: action.observation }
    if (action.type === 'close') return state.market_observation ? { ...state, market_observation: null } : state
    return state
  },

  observe: ({ pubsub, graph, events, send, address, get_state, signal }) => {
    const read_latest_counts = latest_reader(
      () => get_market_counts(graph),
      (counts) => send({ type: 'packet/market_counts', counts })
    )
    const push_counts = (): void => {
      void read_latest_counts().catch((error: Error) =>
        log.warn({ error: error.message }, 'market counts refresh failed')
      )
    }
    const read_latest_history = latest_reader(
      () => get_market_history(graph, pubsub.graph, { address }),
      (history) => send({ type: 'packet/market_history', ...history })
    )
    const push_history = (): void => {
      void read_latest_history().catch((error: Error) =>
        log.warn({ address, error: error.message }, 'market history refresh failed')
      )
    }

    const forward_economy = (payload: EventEnvelope) => {
      const observed = get_state().market_observation
      if (observed && ['MarketListed', 'MarketDelisted', 'MarketPurchased'].includes(payload.type)) push_counts()
      if (payload.type === 'MarketPurchased') {
        const { seller, object, buyer, kind, name, item_type, amount, price_mist } = payload.data as {
          seller: string | null
          object: string
          buyer: string
          kind: 'item' | 'character'
          name: string
          item_type: string | null
          amount: number
          price_mist: string
        }
        if (seller === address) {
          send({
            type: 'packet/listing_sold',
            sale: {
              id: `${payload.ckpt}:${payload.tx}:${payload.evt}`,
              object,
              kind,
              name,
              item_type,
              amount,
              price_mist,
              counterparty: buyer,
              ts_ms: payload.ts_ms,
            },
          })
          push_history()
        }
        return
      }
      if (!observed) return
      if (payload.type === 'MarketListed') {
        const { object } = payload.data as { object: string }
        void get_market_listing(graph, { id: object })
          .then((listing) => {
            if (!listing) return
            const visible =
              listing.kind === 'character'
                ? observed.characters
                : !!listing.category && (observed.categories as readonly string[]).includes(listing.category)
            if (visible) send({ type: 'packet/market_listed', listing })
          })
          .catch((error: Error) => log.warn({ object, error: error.message }, 'listing enrichment failed'))
      }
      if (payload.type === 'MarketDelisted') {
        const { object } = payload.data as { object: string }
        send({ type: 'packet/market_delisted', object })
      }
    }

    pubsub.graph.emitter.on(channels.economy, forward_economy as (payload: unknown) => void)
    void pubsub.graph.subscribe(channels.economy)

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.market_observation === previous.market_observation || !state.market_observation) return
      const observation = state.market_observation
      push_counts()
      push_history()
      void get_market_slice(graph, { observation })
        .then((listings) => send({ type: 'packet/market_slice', observation, listings }))
        .catch((error: Error) => log.warn({ observation, error: error.message }, 'market slice failed'))
    })

    signal.addEventListener('abort', () => {
      pubsub.graph.emitter.off(channels.economy, forward_economy as (payload: unknown) => void)
      void pubsub.graph.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
