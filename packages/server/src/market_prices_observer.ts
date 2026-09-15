// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { PlayerContext, PlayerState } from './player.ts'
import type { EventEnvelope } from './protocol.ts'
import logger from './logger.ts'

const log = logger(import.meta)

/** One bounded reader for the selected item; the periodic refresh repairs missed pub/sub and UTC rollover. */
export const observe_market_prices = ({ pubsub, events, send, get_state, signal }: PlayerContext) => {
  let running = false
  let queued = false
  let last_started = 0
  const refresh = (): void => {
    if (signal.aborted || !get_state().market_price_observation) return
    if (running) {
      queued = true
      return
    }
    const observation = get_state().market_price_observation!
    const current = (): boolean => !signal.aborted && get_state().market_price_observation === observation
    running = true
    last_started = Date.now()
    void (async () => {
      if (!pubsub.graph.market_prices) throw new Error('marketplace price reader unavailable')
      return pubsub.graph.market_prices(observation.item_type, Date.now())
    })()
      .then((history) => {
        if (current()) send({ type: 'packet/market_prices', observation, history })
      })
      .catch((error: Error) => {
        log.warn({ error: error.message }, 'marketplace price refresh failed')
        if (current()) send({ type: 'packet/market_prices', observation, history: null })
      })
      .finally(() => {
        running = false
        if (!queued) return
        queued = false
        refresh()
      })
  }
  events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
    if (state.market_price_observation !== previous.market_price_observation) refresh()
  })
  const timer = setInterval(refresh, 30_000)
  signal.addEventListener('abort', () => clearInterval(timer), { once: true })
  return (payload: EventEnvelope): void => {
    if (
      payload.type === 'MarketPurchased' &&
      payload.data.item_type === get_state().market_price_observation?.item_type &&
      Date.now() - last_started >= 5_000
    )
      refresh()
  }
}
