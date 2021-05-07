import { on } from 'events'

import { aiter } from 'iterator-helper'
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
  observe({ client, world, events }) {
    for (const mob of world.mobs.all) {
      const send_position = ({ position }) =>
        mob.dispatch('target_position', position)

      aiter(on(mob.events, 'state')).reduce((last_target, [{ target }]) => {
        if (last_target !== target) {
          if (target === client.uuid) events.on('state', send_position)

          if (last_target === client.uuid) events.off('state', send_position)
        }
        return target
      }, null)
    }
  },
}
