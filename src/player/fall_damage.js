import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'

const log = logger(import.meta)
const nearest_half = (value) => Math.round(value * 2) / 2

export default {
  reducer(state, { type, payload }) {
    if (type !== 'fall_damage') return state
    const { damage } = payload
    const health = Math.max(0, state.health - damage)

    log.info({ damage, health }, 'Fall Damage')

    return {
      ...state,
      health,
    }
  },

  observer({ client, events, dispatch }) {
    const reducer = (
      { start_y = 0, was_on_ground = true },
      [
        {
          position: { y, onGround },
        },
      ]
    ) => {
      const just_left_ground = was_on_ground && !onGround
      const reached_groud = !was_on_ground && onGround
      const has_fallen = start_y > y

      if (reached_groud && has_fallen) {
        const fall_distance = start_y - y
        const damage = nearest_half(fall_distance * 0.5 - 1.5)

        if (damage > 0) dispatch('fall_damage', { damage })
      }

      return {
        start_y: just_left_ground ? y : start_y,
        was_on_ground: onGround,
      }
    }
    aiter(on(events, 'state')).reduce(reducer, {})
  },
}
