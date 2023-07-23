import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobEvent, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, client, dispatch }) {
    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      aiter(
        abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal })),
      ).reduce(
        (last_attack_sequence_number, [{ attack_sequence_number, target }]) => {
          if (
            target === client.uuid &&
            attack_sequence_number !== last_attack_sequence_number
          ) {
            const { damage } = Entities[mob.type]
            events.emit(PlayerEvent.RECEIVE_DAMAGE, { damage })
          }
          return attack_sequence_number
        },
        0,
      )
    })
  },
}
