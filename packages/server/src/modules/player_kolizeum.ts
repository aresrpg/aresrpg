// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_watcher } from '../pubsub_bus.ts'
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
    const { watch } = create_watcher(pubsub, signal)
    void watch(channels.kolizeum, forward)
      .then(() => {
        if (!signal.aborted) refresh()
      })
      .catch((error: Error) => log.error({ address, error: error.message }, 'kolizeum watch failed'))
  },
} satisfies PlayerModule
