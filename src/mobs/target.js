import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobAction, MobEvent, PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  /** @type {import('../mobs').MobsReducer} */
  reduce_mob(state, { type, payload }) {
    if (type === MobAction.TARGET_POSITION) {
      return {
        ...state,
        target_position: payload,
      }
    }
    if (type === MobAction.FORGET_TARGET) {
      return {
        ...state,
        target: null,
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, events, get_state }) {
    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      const send_position = ({ position, health }) =>
        mob.dispatch(MobAction.TARGET_POSITION, position)

      aiter(
        abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal })),
      ).reduce((last_target, [{ target }]) => {
        // the mob can't keep targetting a dead player
        if (target === client.uuid) {
          const { health } = get_state()
          if (health === 0) mob.dispatch(MobAction.FORGET_TARGET)
        }

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
