// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE query exception (push model): a whitelisted address may ask for dashboard data.
// Everyone else's admin packet answers a refusal and touches nothing.

import { get_admin_stats } from '../reads/get_admin_stats.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerAction } from '../player.ts'
import type { Graph } from '../graph.ts'

const log = logger(import.meta)

const answers = {
  stats: get_admin_stats,
} satisfies Record<string, (graph: Graph) => Promise<unknown>>

export default {
  name: 'player_admin',
  // pure effect module — an admin answer never touches state, so it lives whole in the observer
  observe: ({ admin, graph, send, events }) => {
    events.on('packet/admin_request', ({ id, kind }: Extract<PlayerAction, { type: 'packet/admin_request' }>) => {
      if (!admin) {
        send({ type: 'packet/error', id, reason: 'not an admin' })
        return
      }
      answers[kind](graph)
        .then((result) => send({ type: 'packet/admin_response', id, result }))
        .catch((error: Error) => {
          log.error({ kind, error: error.message }, 'admin read failed')
          send({ type: 'packet/error', id, reason: error.message })
        })
    })
  },
} satisfies PlayerModule
