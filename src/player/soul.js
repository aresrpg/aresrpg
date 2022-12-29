import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { PlayerEvent, PlayerAction } from '../events.js'

const log = logger(import.meta)

const HOUR_1 = 3_600_000
const MINUTE_10 = 600_000
const SOUL_REGEN_PER_OFFLINE_HOUR = 5
const SOUL_REGEN_PER_ONLINE_HOUR = 12

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerAction.DIE) {
      const soul = Math.max(0, state.soul - 10)

      log.info({ soul }, 'lost soul')

      return {
        ...state,
        soul,
      }
      // here we forbid soul regeneration when the player is a ghost
      // the player first have to get out of that ghost mode
      // before being able to gain soul in any way
    } else if (type === PlayerAction.REGENERATE_SOUL) {
      const { amount } = payload
      return {
        ...state,
        soul: Math.min(100, state.soul + amount),
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, signal, dispatch, get_state }) {
    // regenerate soul every 10 minute while online
    aiter(abortable(setInterval(MINUTE_10, null, { signal }))).forEach(() => {
      const { soul } = get_state()
      if (soul !== 0)
        dispatch(PlayerAction.REGENERATE_SOUL, {
          amount: Math.round(SOUL_REGEN_PER_ONLINE_HOUR / 6),
        })
    })

    events.once(
      PlayerEvent.STATE_UPDATED,
      ({ last_connection_time, last_disconnection_time }) => {
        // when the player join, we give him the soul he regenerated while offline
        if (last_disconnection_time !== undefined) {
          const time_offline = Math.max(
            0,
            last_connection_time - last_disconnection_time
          )
          const hours_offline = Math.round(time_offline / HOUR_1)
          dispatch(PlayerAction.REGENERATE_SOUL, {
            amount: SOUL_REGEN_PER_OFFLINE_HOUR * hours_offline,
          })
        }
      }
    )
  },
}
