// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ITEM STREAM — one door, projection-driven (owner ruling 2026-08-21): the indexer
// publishes projected game-Item writes and pre-state removals (mint, craft, burn, split,
// transfer), and this module pushes the resulting row or deletion to the affected kiosk owner.
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

    let kiosk_refresh: Promise<void> | null = null
    const refresh_kiosks = (): Promise<void> => {
      if (kiosk_refresh) return kiosk_refresh
      kiosk_refresh = get_kiosks(graph, { address })
        .then((kiosks) => {
          for (const kiosk of kiosks) mine.add(kiosk)
        })
        .finally(() => {
          kiosk_refresh = null
        })
      return kiosk_refresh
    }
    const owns_kiosk = async (kiosk: string): Promise<boolean> => {
      if (mine.has(kiosk)) return true
      await refresh_kiosks()
      return mine.has(kiosk)
    }
    const push_item = (id: string, previous_holder?: string | null) =>
      get_item_row(graph, { id })
        .then(async (item) => {
          if (item && (await owns_kiosk(item.kiosk))) send({ type: 'packet/item_updated', item })
          else if (previous_holder && (await owns_kiosk(previous_holder)))
            send({ type: 'packet/item_removed', item: id })
        })
        .catch((error: Error) => log.warn({ id, error: error.message }, 'item stream read failed'))

    const push_claims = () =>
      get_claims(graph, { address })
        .then((claims) => send({ type: 'packet/claims', claims }))
        .catch((error: Error) => log.warn({ address, error: error.message }, 'claims refresh failed'))

    const forward_item_event = (payload: EventEnvelope): boolean => {
      if (payload.type === 'ItemWritten') {
        const { item, previous_holder } = payload.data as { item: string; previous_holder?: string | null }
        void push_item(String(item), previous_holder)
        return true
      }
      if (payload.type !== 'ItemRemoved') return false
      const { item, holder } = payload.data as { item: string; holder: string }
      if (mine.has(holder)) send({ type: 'packet/item_removed', item })
      return true
    }

    const forward_economy = (payload: EventEnvelope) => {
      if (forward_item_event(payload)) return
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
