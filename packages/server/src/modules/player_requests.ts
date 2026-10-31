// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Narrow correlated reads for facts the client cannot derive: current custody and public asking prices.

import { get_market_floor } from '../reads/get_market_floor.ts'
import { get_character_owner } from '../reads/get_character_owner.ts'
import logger from '../logger.ts'
import type { PlayerAction, PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_requests',
  observe: ({ events, graph, send, signal }) => {
    events.on(
      'packet/market_floor_request',
      ({ id, item_type }: Extract<PlayerAction, { type: 'packet/market_floor_request' }>) => {
        void get_market_floor(graph, item_type)
          .then((prices) => {
            if (!signal.aborted) send({ type: 'packet/market_floor', id, prices })
          })
          .catch((error: Error) => {
            log.warn({ item_type, error: error.message }, 'market floor read failed')
            if (!signal.aborted) send({ type: 'packet/error', id, reason: 'market floor lookup failed' })
          })
      }
    )
    events.on(
      'packet/character_owner_request',
      ({ id, character_id }: Extract<PlayerAction, { type: 'packet/character_owner_request' }>) => {
        void get_character_owner(graph, { character_id })
          .then((character) => {
            if (!character) return send({ type: 'packet/error', id, reason: 'character not found' })
            send({ type: 'packet/character_owner_response', id, ...character })
          })
          .catch((error: Error) => {
            log.error({ character_id, error: error.message }, 'character owner read failed')
            send({ type: 'packet/error', id, reason: 'character lookup failed' })
          })
      }
    )
  },
} satisfies PlayerModule
