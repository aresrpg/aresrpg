import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'fall_damage') {
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

  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch }) {
    aiter(on(events, 'state')).reduce(
      (
        { highest_y, was_on_ground },
        [
          {
            position: { y, onGround },
          },
        ]
      ) => {
        if (!was_on_ground && onGround) {
          const fall_distance = highest_y - y
          const raw_damage = fall_distance / 2 - 1.5
          const damage = Math.round(raw_damage * 2) / 2

          if (damage > 0) dispatch('fall_damage', { damage })
          return {
            highest_y: y,
            was_on_ground: true,
          }
        }

        return {
          highest_y: Math.max(highest_y, y),
          was_on_ground: onGround,
        }
      },
      { highest_y: 0, was_on_ground: true }
    )
  },
}
