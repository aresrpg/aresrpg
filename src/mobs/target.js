import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'

export default {
  reduce_mob(state, { type, payload }) {
    if (type === 'target_position') {
      return {
        ...state,
        target_position: payload,
      }
    }
    return state
  },
  /** @type {import('../index.js').Observer} */
  observe({ client, world, events, signal }) {
    for (const mob of world.mobs.all) {
      const send_position = ({ position }) =>
        mob.dispatch('target_position', position)

      aiter(abortable(on(mob.events, 'state', { signal }))).reduce(
        (last_target, [{ target }]) => {
          if (last_target !== target) {
            if (target === client.uuid) events.on('state', send_position)

            if (last_target === client.uuid) events.off('state', send_position)
          }
          return target
        },
        null
      )
    }
  },
}
