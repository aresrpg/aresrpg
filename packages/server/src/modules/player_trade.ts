// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE TRADE STREAM. Address-scoped (trades survive re-embodies): the snapshot arms one watch
// per open trade; a TradeCreated beacon on the social channel (mirrored to BOTH parties) arms
// a new one live. Every chain fact pushes the FULL enriched row — the client never diffs
// manifests, it re-renders what the escrow says. TradeDestroyed disarms its own watch.
// Pure effect module: nothing here touches player state.

import { channels, type EventEnvelope } from '../protocol.ts'
import { get_trades, get_trade } from '../reads/get_trades.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

export default {
  name: 'player_trade',
  observe: ({ pubsub, graph, send, address, signal }) => {
    const { watch, unwatch, watched } = create_watcher(pubsub)

    const push_trade = (trade_id: string) =>
      get_trade(graph, { trade_id })
        .then((trade) => {
          if (trade) send({ type: 'packet/trade', trade })
        })
        .catch((error: Error) => log.warn({ trade_id, error: error.message }, 'trade read failed'))

    const forward_trade_event = (payload: EventEnvelope) => {
      const { trade } = payload.data as { trade: string }
      if (payload.type === 'TradeDestroyed') {
        unwatch(channels.trade(trade))
        send({ type: 'packet/trade_destroyed', trade })
        return
      }
      // Changed / Accepted / Locked — one answer for all: the full fresh row
      void push_trade(trade)
    }

    const arm = (trade_id: string) => watch(channels.trade(trade_id), forward_trade_event as (payload: never) => void)

    // the snapshot: every open trade, armed + pushed once
    void get_trades(graph, { address })
      .then((trades) => {
        send({ type: 'packet/trades', trades })
        for (const trade of trades) arm(trade.id)
      })
      .catch((error: Error) => log.error({ address, error: error.message }, 'trade snapshot failed'))

    // the birth beacon (mirrored to both parties' social channels by the indexer)
    const forward_birth = (payload: EventEnvelope) => {
      if (payload.type !== 'TradeCreated') return
      const { trade } = payload.data as { trade: string }
      arm(trade)
      void push_trade(trade)
    }
    watch(channels.social(address), forward_birth as (payload: never) => void)

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
