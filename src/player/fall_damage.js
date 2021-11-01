import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.FALL_DAMAGE) {
      const { damage } = payload
      const health = Math.max(0, state.health - damage)

      log.info({ damage, health }, 'Fall Damage')

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, signal }) {
    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      (
        { highest_y, was_on_ground, last_teleport },
        [
          {
            position: { y, onGround },
            teleport,
          },
        ]
      ) => {
        if (!was_on_ground && onGround) {
          const fall_distance = highest_y - y
          const raw_damage = fall_distance / 2 - 1.5
          const damage = Math.round(raw_damage * 2) / 2

          if (damage > 0) dispatch(Action.FALL_DAMAGE, { damage })
          return {
            highest_y: y,
            was_on_ground: true,
            last_teleport: teleport,
          }
        }

        const reset_y = last_teleport !== teleport && teleport === null // Teleport just ended

        return {
          highest_y: reset_y ? y : Math.max(highest_y, y),
          was_on_ground: onGround,
          last_teleport: teleport,
        }
      },
      { highest_y: 0, was_on_ground: true, last_teleport: null }
    )
  },
}
