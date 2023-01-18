import { on } from 'events'

import { aiter } from 'iterator-helper'

import { Entities } from '../data.js'
import { MobEvent, PlayerAction, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, client, dispatch }) {
    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      aiter(
        abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal }))
      ).reduce(
        (last_attack_sequence_number, [{ attack_sequence_number, target }]) => {
          if (
            target === client.uuid &&
            attack_sequence_number !== last_attack_sequence_number
          ) {
            dispatch(PlayerAction.RECEIVE_DAMAGE, {
              damage: Entities[mob.type].damage,
            })
          }
          return attack_sequence_number
        },
        0
      )
    })
  },
}
