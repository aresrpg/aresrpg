// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE MARKET STREAM. Two independent stakes on the ONE evt:economy channel (watched standing):
//   yours — a MarketPurchased whose indexed kiosk owner is YOU is money arriving: always forwarded;
//   browse — packet/market_observe folds the exact category window DIRECTLY;
//            the delta pushes its graph slice + retained history, then deltas stream while observed.
// A listed event names an id; the row the client renders is enriched from the graph.

import { market_category } from '@aresrpg/protocol'

import { market_change_matches } from '../public_market.ts'
import { channels, type EventEnvelope } from '../protocol.ts'
import { get_market_history } from '../reads/get_market_history.ts'
import { get_market_slice } from '../reads/get_market_slice.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { observe_market_counts } from '../market_counts_observer.ts'
import { observe_market_prices } from '../market_prices_observer.ts'
import { latest_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_market',

  reduce: (state, action) => {
    if (action.type === 'packet/market_prices_observe')
      return { ...state, market_price_observation: action.observation }
    if (action.type === 'packet/market_observe') return { ...state, market_observation: action.observation }
    if (action.type === 'close') return { ...state, market_observation: null, market_price_observation: null }
    return state
  },

  observe: (context) => {
    const { pubsub, graph, events, send, address, get_state, signal, dispatch, public_market, drop } = context
    const price_event = observe_market_prices(context)
    observe_market_counts(context)
    let stop_types: (() => void) | null = null
    const watch_types = (): void => {
      stop_types?.()
      const observed = get_state().market_observation
      if (!observed || observed.kind === 'characters' || observed.kind === 'overview') return
      stop_types = public_market.watch(
        observed.category,
        (items) => {
          const observation = get_state().market_observation
          if (
            !signal.aborted &&
            observation &&
            observation.kind !== 'characters' &&
            observation.kind !== 'overview' &&
            observation.category === observed.category
          )
            send({ type: 'packet/market_types', observation, items })
        },
        (error) => {
          log.warn({ err: error }, 'market type discovery failed')
          drop('SNAPSHOT_FAILED')
        }
      )
    }
    signal.addEventListener('abort', () => stop_types?.(), { once: true })
    const read_latest_history = latest_reader(
      () => get_market_history(graph, pubsub.graph, { address }),
      (history) => send({ type: 'packet/market_history', ...history })
    )
    const push_history = (): void => {
      void read_latest_history().catch((error: Error) =>
        log.warn({ address, error: error.message }, 'market history refresh failed')
      )
    }

    let previous_kiosks: readonly string[] = []
    const read_slice = latest_reader(
      async () => {
        const observation = get_state().market_observation
        return observation && observation.kind !== 'types' && observation.kind !== 'overview'
          ? { observation, ...(await get_market_slice(graph, { observation, address, kiosks: previous_kiosks })) }
          : null
      },
      (result) => {
        if (!signal.aborted && result && get_state().market_observation === result.observation) {
          previous_kiosks = [...new Set(result.listings.map(({ kiosk }) => kiosk))]
          send({ type: 'packet/market_slice', ...result })
        }
      }
    )
    const push_slice = (): void => {
      void read_slice().catch((error: Error) => log.warn({ error: error.message }, 'market slice failed'))
    }
    const { watch } = create_watcher(pubsub, signal)

    const forward_economy = (payload: EventEnvelope) => {
      price_event(payload)
      const observed = get_state().market_observation
      if (payload.data.seller === address && ['MarketListed', 'MarketDelisted'].includes(payload.type))
        dispatch({ type: 'action/refresh_account', domain: 'listings' })
      if (observed && market_change_matches(payload, observed)) {
        push_slice()
      }
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
          dispatch({ type: 'action/refresh_account', domain: 'listings' })
        }
        return
      }
    }

    void watch(channels.economy, forward_economy as (payload: never) => void).catch((error: Error) =>
      log.warn({ error: error.message }, 'market watch failed')
    )

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.market_observation === previous.market_observation) return
      previous_kiosks = []
      if (market_category(state.market_observation) !== market_category(previous.market_observation)) watch_types()
      push_slice()
      if (!state.market_observation) return
      push_history()
    })
  },
} satisfies PlayerModule
