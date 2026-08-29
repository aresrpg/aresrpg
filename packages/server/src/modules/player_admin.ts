// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE query exception (push model): a whitelisted address may ask for dashboard data.
// Everyone else's admin packet answers a refusal and touches nothing.

import { get_admin_overview, get_admin_overview_section, get_admin_shop_sales } from '../reads/get_admin_overview.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerAction } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_admin',
  // pure effect module — an admin answer never touches state, so it lives whole in the observer
  observe: ({ admin, graph, pubsub, send, events }) => {
    events.on('packet/admin_request', (request: Extract<PlayerAction, { type: 'packet/admin_request' }>) => {
      const { id, kind } = request
      if (!admin) {
        send({ type: 'packet/error', id, reason: 'not an admin' })
        return
      }
      const answer = (() => {
        if (kind === 'overview')
          return get_admin_overview(graph, pubsub.graph, pubsub.mesh, {
            revenue_days: request.revenue_days,
            players_days: request.players_days,
            transactions_days: request.transactions_days,
            online_days: request.online_days,
            addresses_days: request.addresses_days,
            characters_days: request.characters_days,
          }).then((result) => ({ type: 'packet/admin_response' as const, id, kind, result }))
        if (kind === 'overview_section')
          return get_admin_overview_section(graph, pubsub.graph, pubsub.mesh, request.section, request.days).then(
            (result) => ({ type: 'packet/admin_response' as const, id, kind, result })
          )
        return get_admin_shop_sales(pubsub.graph, { days: request.days, cursor: request.cursor }).then((result) => ({
          type: 'packet/admin_response' as const,
          id,
          kind,
          result,
        }))
      })()
      answer.then(send).catch((error: Error) => {
        log.error({ kind, error: error.message }, 'admin read failed')
        send({ type: 'packet/error', id, reason: error.message })
      })
    })
  },
} satisfies PlayerModule
