import { on } from 'events'

import { aiter } from 'iterator-helper'

import { Context, Action } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.DEATH) {
      const { dead } = payload
      const { username } = state

      log.info({ dead, username }, 'rip')

      return {
        ...state,
        dead,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch }) {
    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ health }]) => health)
      .reduce((last_health, health) => {
        if (last_health !== health) {
          client.write('update_health', {
            health,
            food: 20,
            foodSaturation: 0.0,
          })

          if (health === 0) {
            dispatch(Action.DEATH, { dead: true })
          }
        }
        return health
      }, 0)
  },
}
