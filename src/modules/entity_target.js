import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'

/** @type {import('../server').Module} */
export default {
  name: 'entity_target',
  async reduce_mob(state, { type, payload }) {
    if (type === 'TARGET_POSITION') {
      return {
        ...state,
        target_position: payload,
      }
    }
    if (type === 'FORGET_TARGET') {
      return {
        ...state,
        target: null,
      }
    }
    return state
  },
  observe({ client, events, get_state }) {
    events.on('ENTITY_ENTER_VIEW', ({ mob, signal }) => {
      const send_position = ({ position, health }) =>
        mob.dispatch('TARGET_POSITION', position)

      aiter(abortable(on(mob.events, 'STATE_UPDATED', { signal }))).reduce(
        (last_target, [{ target }]) => {
          // the mob can't keep targetting a dead player
          if (target === client.uuid) {
            const { health } = get_state()
            if (health === 0) mob.dispatch('FORGET_TARGET')
          }

          if (last_target !== target) {
            if (target === client.uuid)
              events.on('STATE_UPDATED', send_position)

            if (last_target === client.uuid)
              events.off('STATE_UPDATED', send_position)
          }
          return target
        },
        null,
      )
    })
  },
}
