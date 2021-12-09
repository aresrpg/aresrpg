import { on } from 'events'

import { aiter } from 'iterator-helper'

import { Context, Mob, Action } from '../events.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, client, dispatch }) {
    events.on(Context.MOB_SPAWNED, ({ mob, signal }) => {
      aiter(abortable(on(mob.events, Mob.STATE, { signal }))).reduce(
        (last_attack_sequence_number, [{ attack_sequence_number, target }]) => {
          if (
            target === client.uuid &&
            attack_sequence_number !== last_attack_sequence_number
          ) {
            dispatch(Action.DAMAGE, { damage: Entities[mob.mob].damage })
          }
          return attack_sequence_number
        },
        0
      )
    })
  },
}
