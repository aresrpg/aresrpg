import { setInterval } from 'timers/promises'
import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { PlayerEvent } from '../events.js'
import { set_invisible } from '../player.js'

const log = logger(import.meta)

const HOUR_1 = 3_600_000
const MINUTE_10 = 600_000
const SOUL_REGEN_PER_OFFLINE_HOUR = 5
const SOUL_REGEN_PER_ONLINE_HOUR = 12

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    switch (type) {
      case PlayerEvent.DIE: {
        const soul = Math.max(0, state.soul - 10)
        log.info({ soul }, 'lost soul')

        return {
          ...state,
          soul,
        }
      }
      case PlayerEvent.REGENERATE_SOUL: {
        // we forbid soul regeneration when the player is a ghost
        // the player first have to get out of that ghost mode
        // before being able to gain soul in any way
        if (state.soul === 0) return state

        const { amount } = payload
        return {
          ...state,
          soul: Math.min(100, state.soul + amount),
        }
      }
      case PlayerEvent.UPDATE_SOUL: {
        const { soul } = payload
        log.info({ soul }, 'direct soul update')
        return {
          ...state,
          soul: Math.min(100, Math.max(0, soul)),
        }
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, signal, dispatch, get_state, client }) {
    // regenerate soul every 10 minute while online
    aiter(abortable(setInterval(MINUTE_10, null, { signal }))).forEach(() => {
      const { soul } = get_state()
      if (soul !== 0)
        dispatch(PlayerEvent.REGENERATE_SOUL, {
          amount: Math.round(SOUL_REGEN_PER_ONLINE_HOUR / 6),
        })
    })

    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([{ soul }]) => soul)
      .reduce((last_soul, soul) => {
        // allows to leave the fantom mode after losing all soul
        if (soul > 0 && last_soul === 0) set_invisible(client, false)
        return soul
      }, -1)

    events.once(
      PlayerEvent.STATE_UPDATED,
      ({ last_connection_time, last_disconnection_time }) => {
        // when the player join, we give him the soul he regenerated while offline
        if (last_disconnection_time !== undefined) {
          const time_offline = Math.max(
            0,
            last_connection_time - last_disconnection_time,
          )
          const hours_offline = Math.round(time_offline / HOUR_1)
          dispatch(PlayerEvent.REGENERATE_SOUL, {
            amount: SOUL_REGEN_PER_OFFLINE_HOUR * hours_offline,
          })
        }
      },
    )
  },
}
