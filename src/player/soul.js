import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { Context, Action } from '../events.js'
import { States as BodyStates } from '../body.js'

const log = logger(import.meta)

const HOUR_1 = 3_600_000
const MINUTE_10 = 600_000
const SOUL_REGEN_PER_OFFLINE_HOUR = 5
const SOUL_REGEN_PER_ONLINE_HOUR = 12

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.BODY_STATE && payload.body_state === BodyStates.DEAD) {
      const soul = Math.max(0, state.soul - 10)
      const { username } = state

      log.info({ soul, username }, 'lost soul')

      return {
        ...state,
        soul,
      }
      // here we forbid soul regeneration when the player is a ghost
      // the player first have to get out of that ghost mode
      // before being able to gain soul in any way
    } else if (
      type === Action.REGENERATE_SOUL &&
      state.body_state !== BodyStates.GHOST
    ) {
      const { amount } = payload
      return {
        ...state,
        soul: Math.min(100, state.soul + amount),
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal, dispatch }) {
    // regenerate soul every 10 minute while online
    aiter(abortable(setInterval(MINUTE_10, { signal }))).forEach(() =>
      dispatch(Action.REGENERATE_SOUL, {
        amount: Math.round(SOUL_REGEN_PER_ONLINE_HOUR / 6),
      })
    )

    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ soul }]) => soul)
      .reduce((last_soul, soul) => {
        if (last_soul !== soul && soul === 0)
          dispatch(Action.BODY_STATE, { body_state: BodyStates.GHOST })
        return soul
      })

    events.once(
      Context.STATE,
      ({ last_connection_time, last_disconnection_time }) => {
        // when the player join, we give him the soul he regenerated while offline
        const time_offline = Math.max(
          0,
          last_connection_time - last_disconnection_time
        )
        const hours_offline = Math.round(time_offline / HOUR_1)
        dispatch(Action.REGENERATE_SOUL, {
          amount: SOUL_REGEN_PER_OFFLINE_HOUR * hours_offline,
        })
      }
    )
  },
}
