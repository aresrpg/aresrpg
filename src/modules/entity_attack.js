import { on } from 'events'

import { aiter } from 'iterator-helper'

import Entities from '../../data/entities.json' assert { type: 'json' }
import { abortable } from '../core/iterator.js'

/** @type {import('../server').Module} */
export default {
  observe({ events, client, dispatch }) {
    events.on('ENTITY_ENTER_VIEW', ({ mob, signal }) => {
      aiter(abortable(on(mob.events, 'STATE_UPDATED', { signal }))).reduce(
        (last_attack_sequence_number, [{ attack_sequence_number, target }]) => {
          if (
            target === client.uuid &&
            attack_sequence_number !== last_attack_sequence_number
          ) {
            const { damage } = Entities[mob.type]
            events.emit('RECEIVE_DAMAGE', { damage })
          }
          return attack_sequence_number
        },
        0,
      )
    })
  },
}
