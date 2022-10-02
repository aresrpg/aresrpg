import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import equal from 'fast-deep-equal'

import { saved_state } from '../context.js'
import { Action } from '../events.js'
import { abortable } from '../iterator.js'
import Database from '../database.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.DATABASE_SYNC)
      return {
        ...state,
        // if we failed to fetch from the database then `payload` will be undefined
        // so it will not change anything
        ...payload,
      }

    if (type === Action.BLOCKCHAIN_SYNC)
      return {
        ...state,
        kares: payload,
      }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal, dispatch, get_state }) {
    const uuid = client.uuid.toLowerCase()

    // each time a JSON.SET operation is executed against redis,
    // thanks to keyevents we are notified that this aresrpg instance
    // should fetch and apply the new state of the player
    // this is usefull both for distribution and external update of the database
    // like linking a wallet_address on the website
    // or setting roles through an admin interface
    aiter(abortable(on(Database.emitter, uuid, { signal }))).forEach(() =>
      Database.pull(uuid.toLowerCase()).then(user =>
        dispatch(Action.DATABASE_SYNC, user)
      )
    )

    // here we regularly save the state
    // it was previously a debounced save
    // but it's too messy as the state is update continuously
    aiter(abortable(setInterval(10000, undefined, { signal }))).reduce(
      (last_state, state = get_state() ?? { no_state: true }) => {
        if (!last_state.first_iteration && !state.no_state) {
          const redis_state = saved_state(state)
          const last_redis_state = saved_state(last_state)

          if (!equal(redis_state, last_redis_state))
            Database.push(client.uuid.toLowerCase(), redis_state).catch(error =>
              log.error(error, 'unable to save the state in redis')
            )
        }
        return state
      },
      { first_iteration: true }
    )
  },
}
