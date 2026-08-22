// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MARKET STREAM. Two independent stakes on the ONE evt:economy channel (watched standing):
//   yours — a MarketPurchased whose kiosk is one of YOURS is money arriving: always forwarded;
//   browse — packet/market_observe folds the exact category window DIRECTLY;
//            the delta pushes its graph slice + retained history, then deltas stream while observed.
// A listed event names an id; the row the client renders is enriched from the graph.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_market_history } from '../reads/get_market_history.ts'
import { get_market_listing, get_market_slice } from '../reads/get_market_slice.ts'
import { get_characters } from '../reads/get_characters.ts'
import { get_kiosks } from '../reads/get_user_economy.ts'
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

  observe: ({ pubsub, graph, events, send, address, get_state, dispatch, signal }) => {
    /** the user's kiosk ids — the "is this sale MINE" test (loaded once; kiosks are for life) */
    const mine = new Set<string>()
    void get_kiosks(graph, { address })
      .then((kiosks) => {
        for (const kiosk of kiosks) mine.add(kiosk)
      })
      .catch((error: Error) => log.warn({ address, error: error.message }, 'kiosk census failed'))

    const forward_economy = (payload: EventEnvelope) => {
      const observed = get_state().market_observation
      if (payload.type === 'MarketPurchased') {
        const { kiosk, object, buyer, kind, price_mist } = payload.data as {
          kiosk: string
          object: string
          buyer: string
          kind: 'item' | 'character'
          price_mist: string
        }
        if (mine.has(kiosk)) {
          send({ type: 'packet/listing_sold', object, price_mist })
          void get_market_history(graph, pubsub.graph, { address })
            .then((history) => send({ type: 'packet/market_history', ...history }))
            .catch((error: Error) => log.warn({ address, error: error.message }, 'market history refresh failed'))
        }
        if (kind === 'character' && (buyer === address || mine.has(kiosk)))
          void get_characters(graph, { address })
            .then((characters) => {
              dispatch({ type: 'action/character_roster', characters })
              send({ type: 'packet/characters', characters })
            })
            .catch((error: Error) => log.warn({ address, error: error.message }, 'market character roster failed'))
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
      void Promise.all([get_market_slice(graph, { observation }), get_market_history(graph, pubsub.graph, { address })])
        .then(([listings, history]) => {
          send({ type: 'packet/market_slice', observation, listings })
          send({ type: 'packet/market_history', ...history })
        })
        .catch((error: Error) => log.warn({ observation, error: error.message }, 'market slice failed'))
    })

    signal.addEventListener('abort', () => {
      pubsub.graph.emitter.off(channels.economy, forward_economy as (payload: unknown) => void)
      void pubsub.graph.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
