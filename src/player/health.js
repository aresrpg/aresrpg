import { on } from 'events'

import { aiter } from 'iterator-helper'

import { get_max_health } from '../characteristics.js'
import { PlayerEvent, WorldRequest } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { play_sound } from '../sound.js'

const log = logger(import.meta)

const SCOREBOARD_NAME = 'life'
const CREATE_OBJECTIVE_ACTION = 0
const INTEGER_TYPE = 0
const BELOW_NAME_POSITION = 2

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerEvent.UPDATE_HEALTH) {
      const max_health = get_max_health(state)
      const health = Math.max(0, Math.min(max_health, payload.health))

      log.info({ health }, 'direct health update')

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch, world }) {
    events.once(PlayerEvent.STATE_UPDATED, state => {
      client.write('scoreboard_objective', {
        name: SCOREBOARD_NAME,
        action: CREATE_OBJECTIVE_ACTION,
        displayText: JSON.stringify([{ text: 'hp', color: 'green' }]),
        type: INTEGER_TYPE,
      })

      client.write('scoreboard_display_objective', {
        name: SCOREBOARD_NAME,
        position: BELOW_NAME_POSITION,
      })
    })

    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([{ health, position }]) => ({ position, health }))
      .reduce((last_health, { position, health }) => {
        if (last_health !== health) {
          client.write('update_health', {
            health,
            food: 20,
            foodSaturation: 0.0,
          })

          world.events.emit(WorldRequest.PLAYER_HEALTH_UPDATE, {
            uuid: client.uuid,
            health,
          })

          if (health === 0) {
            dispatch(PlayerEvent.DIE)
            play_sound({
              client,
              sound: 'entity.zombie_villager.converted',
              ...position,
            })
          }
        }
        return health
      }, 0)
  },
}
