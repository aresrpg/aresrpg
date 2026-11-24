// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every owned character's visible slots fold back into its presence from the shared equipment
// projection, so the players around it see what it wears.

import { VISIBLE_SLOTS } from '@aresrpg/protocol'

import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_equipment',
  observe: ({ public_world, events, signal, dispatch, get_state, drop }) => {
    const watches = new Map<string, () => void>()
    const watch_equipment = (character_id: string): void => {
      watches.set(
        character_id,
        public_world.equipment.watch(
          character_id,
          (equipment) => {
            if (signal.aborted || !get_state().characters[character_id]) return
            VISIBLE_SLOTS.forEach((slot) =>
              dispatch({ type: 'action/equip', character_id, slot, item_type: equipment[slot] })
            )
          },
          (error) => {
            log.warn({ character_id, err: error }, 'own equipment refresh failed')
            drop('SNAPSHOT_FAILED')
          }
        )
      )
    }
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.roster === previous.roster) return
      Object.keys(previous.roster).forEach((character_id) => {
        if (state.roster[character_id]) return
        watches.get(character_id)?.()
        watches.delete(character_id)
      })
      Object.keys(state.roster).forEach((character_id) => {
        if (!previous.roster[character_id]) watch_equipment(character_id)
      })
    })
    signal.addEventListener('abort', () => watches.forEach((stop) => stop()), { once: true })
  },
} satisfies PlayerModule
