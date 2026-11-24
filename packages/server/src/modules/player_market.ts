// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PUBLIC MARKET STREAM (every stage), on the ONE evt:economy channel (watched standing):
//   catalogue — while any market observation is open, the pod's sampled listed types push when
//               they change, checked on every market event and every sample interval;
//   page      — an `offers` or `characters` observation pushes its graph slice, then its deltas.
// A listed event names an id; the row the client renders is enriched from the graph. The page
// arrives as this socket's viewer sees it (an address leaves its own listings out); the seller's
// own stream (listings, sales, history) is in `account_streams`.

import { has_market_page, type MarketType } from '@aresrpg/protocol'

import { is_market_change, market_change_matches, MARKET_TYPES_SAMPLE_MS } from '../public_market.ts'
import { channels, type EventEnvelope } from '../protocol.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { observe_market_prices } from '../market_prices_observer.ts'
import { coalesced_reader } from '../latest_read.ts'
import { get_market_slice } from '../reads/get_market_slice.ts'
import logger from '../logger.ts'
import type { PublicModule, PlayerState } from '../player.ts'

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
    const { pubsub, graph, events, send, get_state, signal, public_market, viewer } = context
    const price_event = observe_market_prices(context)

    let sent_types: readonly MarketType[] | null = null
    let types_timer: ReturnType<typeof setInterval> | null = null
    const push_types = (): void => {
      if (!get_state().market_observation) return
      void public_market()
        .then((items) => {
          if (signal.aborted || !get_state().market_observation || items === sent_types) return
          sent_types = items
          send({ type: 'packet/market_types', items })
        })
        .catch((error: Error) => log.warn({ error: error.message }, 'market types read failed'))
    }
    /** The catalogue follows whether a market surface is open, not which page it shows. */
    const follow_types = (open: boolean): void => {
      if (types_timer) clearInterval(types_timer)
      types_timer = open ? setInterval(push_types, MARKET_TYPES_SAMPLE_MS) : null
      sent_types = null
      push_types()
    }
    signal.addEventListener('abort', () => follow_types(false), { once: true })

    let previous_kiosks: readonly string[] = []
    const read_slice = coalesced_reader(
      async () => {
        const observation = get_state().market_observation
        return has_market_page(observation)
          ? {
              observation,
              ...(await get_market_slice(graph, { observation, address: viewer, kiosks: previous_kiosks })),
            }
          : null
      },
      (result) => {
        if (!signal.aborted && result && get_state().market_observation === result.observation) {
          previous_kiosks = [...new Set(result.listings.map(({ kiosk }) => kiosk))]
          send({ type: 'packet/market_slice', ...result })
        }
      },
      signal
    )
    const push_slice = (): void => {
      void read_slice().catch((error: Error) => log.warn({ error: error.message }, 'market slice failed'))
    }
    const { watch } = create_watcher(pubsub, signal)

    const forward_economy = (payload: EventEnvelope) => {
      price_event(payload)
      if (is_market_change(payload)) push_types()
      const observed = get_state().market_observation
      if (has_market_page(observed) && market_change_matches(payload, observed)) push_slice()
    }

    void watch(channels.economy, forward_economy as (payload: never) => void).catch((error: Error) =>
      log.warn({ error: error.message }, 'market watch failed')
    )

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.market_observation === previous.market_observation) return
      previous_kiosks = []
      const open = state.market_observation !== null
      if (open !== (previous.market_observation !== null)) follow_types(open)
      push_slice()
    })
  },
} satisfies PublicModule
