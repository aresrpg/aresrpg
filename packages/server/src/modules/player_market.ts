// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MARKET STREAM. Two independent stakes on the ONE evt:economy channel (watched standing):
//   yours — a MarketPurchased whose kiosk is one of YOURS is money arriving: always forwarded;
//   browse — packet/market_observe folds the category DIRECTLY (no validation, reducer law);
//            the delta pushes the slice, then listings/delistings stream while observed.
// A listed event names an id; the row the client renders is enriched from the graph.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_market_slice } from '../reads/get_market_slice.ts'
import { get_kiosks } from '../reads/get_user_economy.ts'
import { get_item } from '../reads/get_item.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_market',

  reduce: (state, action) => {
    if (action.type === 'packet/market_observe') return { ...state, market_category: action.category }
    if (action.type === 'close') return state.market_category ? { ...state, market_category: null } : state
    return state
  },

  observe: ({ pubsub, graph, events, send, address, get_state, signal }) => {
    /** the user's kiosk ids — the "is this sale MINE" test (loaded once; kiosks are for life) */
    const mine = new Set<string>()
    void get_kiosks(graph, { address })
      .then((kiosks) => {
        for (const kiosk of kiosks) mine.add(kiosk)
      })
      .catch((error: Error) => log.warn({ address, error: error.message }, 'kiosk census failed'))

    const forward_economy = (payload: EventEnvelope) => {
      const observed = get_state().market_category
      if (payload.type === 'MarketPurchased') {
        const { kiosk, object, price_mist } = payload.data as { kiosk: string; object: string; price_mist: string }
        if (mine.has(kiosk)) send({ type: 'packet/listing_sold', object, price_mist })
        return
      }
      if (!observed) return
      if (payload.type === 'MarketListed') {
        const { object, price_mist } = payload.data as { object: string; price_mist: string }
        const { kiosk } = payload.data as { kiosk: string }
        void get_item(graph, { id: object })
          .then((item) => {
            if (!item || item.category !== observed) return
            send({
              type: 'packet/market_listed',
              listing: { ...item, price_mist, kiosk, at_ms: payload.ts_ms },
            })
          })
          .catch((error: Error) => log.warn({ object, error: error.message }, 'listing enrichment failed'))
      }
      if (payload.type === 'MarketDelisted') {
        const { object } = payload.data as { object: string }
        send({ type: 'packet/market_delisted', object })
      }
    }

    pubsub.emitter.on(channels.economy, forward_economy as (payload: unknown) => void)
    void pubsub.subscribe(channels.economy)

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.market_category === previous.market_category || !state.market_category) return
      const category = state.market_category
      void get_market_slice(graph, { category })
        .then((listings) => send({ type: 'packet/market_slice', category, listings }))
        .catch((error: Error) => log.warn({ category, error: error.message }, 'market slice failed'))
    })

    signal.addEventListener('abort', () => {
      pubsub.emitter.off(channels.economy, forward_economy as (payload: unknown) => void)
      void pubsub.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
