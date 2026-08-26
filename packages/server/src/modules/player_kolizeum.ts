// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { latest_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import { channels } from '../protocol.ts'
import { get_kolizeums } from '../reads/get_kolizeums.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_kolizeum',
  observe: ({ pubsub, send, signal, graph, address }) => {
    const push = latest_reader(
      () => get_kolizeums(graph, { address }),
      (lobbies) => send({ type: 'packet/kolizeums', lobbies })
    )
    const refresh = (): void => {
      void push().catch((error: Error) => log.error({ address, error: error.message }, 'kolizeum board read failed'))
    }
    const forward = (): void => refresh()
    pubsub.graph.emitter.on(channels.kolizeum, forward)
    void pubsub.graph
      .subscribe(channels.kolizeum)
      .then(refresh)
      .catch((error: Error) => log.error({ address, error: error.message }, 'kolizeum watch failed'))
    signal.addEventListener('abort', () => {
      pubsub.graph.emitter.off(channels.kolizeum, forward)
      void pubsub.graph.unsubscribe(channels.kolizeum)
    })
  },
} satisfies PlayerModule
