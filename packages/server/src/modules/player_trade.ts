// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE TRADE STREAM. Address-scoped and bounded in one place: every Trade object write reaches
// both participants' social channel, then one latest-wins read pushes the complete roster.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_trades } from '../reads/get_trades.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { latest_reader } from '../latest_read.ts'

const log = logger(import.meta)

export default {
  name: 'player_trade',
  observe: ({ pubsub, graph, send, address, signal }) => {
    const { watch, unwatch, watched } = create_watcher(pubsub)

    const refresh = latest_reader(
      () => get_trades(graph, { address }),
      (trades) => send({ type: 'packet/trades', trades })
    )
    const reread = (): void => {
      void refresh().catch((error: Error) => log.warn({ address, error: error.message }, 'trade roster read failed'))
    }
    const forward = (payload: EventEnvelope) => {
      if (payload.type === 'TradeDestroyed' && typeof payload.data.trade === 'string')
        send({ type: 'packet/trade_destroyed', trade: payload.data.trade })
      if (payload.type === 'TradeChanged' || payload.type === 'TradeDestroyed') reread()
    }
    void watch(channels.social(address), forward as (payload: never) => void)
      .then(refresh)
      .catch((error: Error) => log.error({ address, error: error.message }, 'trade snapshot failed'))

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
