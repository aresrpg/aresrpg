import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobEvent, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  /** @type {import('../mobs').MobsReducer} */
  reduce_mob(state, { type, payload }) {
    if (type === MobEvent.TARGET_POSITION) {
      return {
        ...state,
        target_position: payload,
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, events }) {
    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      const send_position = ({ position }) =>
        mob.dispatch(MobEvent.TARGET_POSITION, position)

      aiter(
        abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal }))
      ).reduce((last_target, [{ target }]) => {
        if (last_target !== target) {
          if (target === client.uuid)
            events.on(PlayerEvent.STATE_UPDATED, send_position)

          if (last_target === client.uuid)
            events.off(PlayerEvent.STATE_UPDATED, send_position)
        }
        return target
      }, null)
    })
  },
}
