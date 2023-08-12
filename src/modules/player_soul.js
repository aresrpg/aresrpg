import { setInterval } from 'timers/promises'
import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import logger from '../logger.js'
import { set_invisible } from '../core/player.js'

const log = logger(import.meta)

const HOUR_1 = 3_600_000
const MINUTE_10 = 600_000
const SOUL_REGEN_PER_OFFLINE_HOUR = 5
const SOUL_REGEN_PER_ONLINE_HOUR = 12

/** @type {import('../server').Module} */
export default {
  name: 'player_soul',
  reduce(state, { type, payload }) {
    switch (type) {
      case 'DIE': {
        const soul = Math.max(0, state.soul - 10)
        log.info({ soul }, 'lost soul')

        return {
          ...state,
          game_state: !soul ? 'GAME:GHOST' : state.game_state,
          soul,
        }
      }
      case 'REGENERATE_SOUL': {
        const { amount } = payload
        return {
          ...state,
          soul: Math.min(100, state.soul + amount),
        }
      }
      case 'UPDATE_SOUL': {
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

  observe({ events, signal, dispatch, get_state, client }) {
    // regenerate soul every 10 minute while online
    aiter(abortable(setInterval(MINUTE_10, null, { signal }))).forEach(() => {
      const { soul } = get_state()
      if (soul !== 0)
        dispatch('REGENERATE_SOUL', {
          amount: Math.round(SOUL_REGEN_PER_ONLINE_HOUR / 6),
        })
    })

    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ soul }]) => soul)
      .reduce((last_soul, soul) => {
        // allows to leave the ghost mode
        if (soul > 0 && last_soul === 0) set_invisible(client, false)
        return soul
      }, -1)

    events.once(
      'STATE_UPDATED',
      ({ last_connection_time, last_disconnection_time }) => {
        // when the player join, we give him the soul he regenerated while offline
        if (last_disconnection_time !== undefined) {
          const time_offline = Math.max(
            0,
            last_connection_time - last_disconnection_time,
          )
          const hours_offline = Math.round(time_offline / HOUR_1)
          dispatch('REGENERATE_SOUL', {
            amount: SOUL_REGEN_PER_OFFLINE_HOUR * hours_offline,
          })
        }
      },
    )
  },
}
