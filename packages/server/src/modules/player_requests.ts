// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Narrow correlated reads for facts the client cannot derive. Registry + name already produced
// the Character ID; only current wallet custody reaches this graph door.

import { get_character_owner } from '../reads/get_character_owner.ts'
import { get_airdrop_state } from '../reads/get_airdrop_state.ts'
import logger from '../logger.ts'
import type { PlayerAction, PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_requests',
  observe: ({ events, graph, send }) => {
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
    events.on(
      'packet/airdrop_eligibility_request',
      ({ address: holder }: Extract<PlayerAction, { type: 'packet/airdrop_eligibility_request' }>) => {
        void get_airdrop_state(graph, { address: holder })
          .then((airdrops) => send({ type: 'packet/airdrop_eligibility', address: holder, airdrops: [...airdrops] }))
          .catch((error: Error) => {
            log.error({ holder, error: error.message }, 'airdrop eligibility read failed')
            send({ type: 'packet/error', reason: 'airdrop eligibility failed — retry' })
          })
      }
    )
  },
} satisfies PlayerModule
