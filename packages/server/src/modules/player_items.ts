// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ITEM STREAM — one door, projection-driven (owner ruling 2026-08-21): the indexer
// publishes `ItemWritten` for EVERY projected game-Item write (mint, craft roll, scribe,
// feed, trade claim — the object output is the trigger, no Move event required), and this
// module re-reads the projected row and pushes it to the players whose kiosk holds it.
// The client never REQUESTS item state — its receipt only unlocks the next action. The
// pubsub envelope fires after the graph write of the same checkpoint, so the read never
// races its own projection. Claims are the same pattern over their own events.

import type { EventEnvelope } from '../protocol.ts'
import { channels } from '../protocol.ts'
import { get_item_row } from '../reads/get_item_row.ts'
import { get_claims, get_kiosks } from '../reads/get_user_economy.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_items',
  observe: ({ pubsub, graph, send, address, signal }) => {
    /** the user's kiosk ids — the "is this item MINE" test (kiosks are for life) */
    const mine = new Set<string>()
    void get_kiosks(graph, { address })
      .then((kiosks) => {
        for (const kiosk of kiosks) mine.add(kiosk)
      })
      .catch((error: Error) => log.warn({ address, error: error.message }, 'kiosk census failed'))

    const push_item = (id: string) =>
      get_item_row(graph, { id })
        .then((item) => {
          if (item && mine.has(item.kiosk)) send({ type: 'packet/item_updated', item })
        })
        .catch((error: Error) => log.warn({ id, error: error.message }, 'item stream read failed'))

    const push_claims = () =>
      get_claims(graph, { address })
        .then((claims) => send({ type: 'packet/claims', claims }))
        .catch((error: Error) => log.warn({ address, error: error.message }, 'claims refresh failed'))

    const forward_economy = (payload: EventEnvelope) => {
      if (payload.type === 'ItemWritten') {
        // holder scoping happens at the read: get_item_row only matches kiosk-HELD items
        // and `mine` filters to this player — an equipped or foreign write stays silent
        void push_item(String((payload.data as { item: string }).item))
        return
      }
      if (payload.type === 'LootBoxOpened') {
        if ((payload.data as { opener: string }).opener === address) void push_claims()
        return
      }
      if (payload.type === 'LootClaimed') {
        if ((payload.data as { opener: string }).opener === address) void push_claims()
        return
      }
      if (payload.type === 'GearCrushed') {
        if ((payload.data as { crusher: string }).crusher === address) void push_claims()
      }
    }

    pubsub.graph.emitter.on(channels.economy, forward_economy as (payload: unknown) => void)
    void pubsub.graph.subscribe(channels.economy)
    signal.addEventListener('abort', () => {
      pubsub.graph.emitter.off(channels.economy, forward_economy as (payload: unknown) => void)
      void pubsub.graph.unsubscribe(channels.economy)
    })
  },
} satisfies PlayerModule
