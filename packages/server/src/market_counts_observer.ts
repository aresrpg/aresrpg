// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { MarketTypeCounts } from '@aresrpg/protocol'

import type { PlayerContext, PlayerState } from './player.ts'

/** Counts are public, so category changes reuse the same shared subscription and sampled catalogue. */
export const observe_market_counts = ({
  public_market,
  events,
  signal,
  send,
  get_state,
}: Pick<PlayerContext, 'public_market' | 'events' | 'signal' | 'send' | 'get_state'>): void => {
  let stop: (() => void) | null = null
  const deliver = (counts: MarketTypeCounts | null): void => {
    const observation = get_state().market_observation
    if (!signal.aborted && observation) send({ type: 'packet/market_counts', observation, counts })
  }
  events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
    if (state.market_observation === previous.market_observation) return
    if (!state.market_observation) {
      stop?.()
      stop = null
      return
    }
    if (!stop) {
      stop = public_market.counts.watch('all', deliver, () => deliver(null))
      return
    }
    const counts = public_market.counts.get('all')
    if (counts !== undefined) deliver(counts)
  })
  signal.addEventListener('abort', () => stop?.(), { once: true })
}
