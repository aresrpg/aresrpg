// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_item_packet } from '@aresrpg/protocol/inventory'
import type { ServerPacket } from '@aresrpg/protocol'

import type { PlayerContext } from './player.ts'
import { create_watcher } from './pubsub_bus.ts'
import { channels, type EventEnvelope } from './protocol.ts'
import { get_items } from './reads/get_items.ts'

/** Both account views subscribe before their indexed baseline and consume the same item deltas. */
export const create_inventory_reader = ({
  graph,
  pubsub,
  address,
  signal,
  send,
}: Pick<PlayerContext, 'graph' | 'pubsub' | 'address' | 'signal' | 'send'>) => {
  const { watch } = create_watcher(pubsub, signal)
  let revision = 0
  const forward = (payload: EventEnvelope) => {
    if (payload.type !== 'ItemProjected' || signal.aborted) return
    const packet = payload.data.packet as ServerPacket
    if (is_item_packet(packet)) {
      revision += 1
      send(packet)
    }
  }
  let subscribed: Promise<void> | null = null
  const read = async () => {
    subscribed ??= watch(channels.social(address), forward)
    await subscribed
    while (!signal.aborted) {
      const before = revision
      const items = await get_items(graph, { address })
      if (before === revision) return items
    }
    return []
  }
  return { read, revision: () => revision }
}
