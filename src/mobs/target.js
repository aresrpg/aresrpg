import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobAction, Mob, Context } from '../events.js'
import { abortable } from '../iterator.js'

export default {
  reduce_mob(state, { type, payload }) {
    if (type === MobAction.TARGET_POSITION) {
      return {
        ...state,
        target_position: payload,
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, events }) {
    events.on(Context.MOB_SPAWNED, ({ mob, signal }) => {
      const send_position = ({ position }) =>
        mob.dispatch(MobAction.TARGET_POSITION, position)

      aiter(abortable(on(mob.events, Mob.STATE, { signal }))).reduce(
        (last_target, [{ target }]) => {
          if (last_target !== target) {
            if (target === client.uuid) events.on(Context.STATE, send_position)

            if (last_target === client.uuid)
              events.off(Context.STATE, send_position)
          }
          return target
        },
        null
      )
    })
  },
}
