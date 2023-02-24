import { on } from 'events'

import { aiter } from 'iterator-helper'

import { get_max_health } from '../characteristics.js'
import { PlayerEvent, WorldRequest } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { play_sound } from '../sound.js'
import { synchronisation_payload } from '../sync.js'

const log = logger(import.meta)

export const SCOREBOARD_NAME = 'life'
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
      .map(([state]) => state)
      .reduce((last_health, state) => {
        const { position, health } = state
        if (last_health !== null && last_health !== health) {
          client.write('update_health', {
            health,
            food: 20,
            foodSaturation: 0.0,
          })

          // if just respawned, we need more information for sync
          if (last_health === 0)
            world.events.emit(
              WorldRequest.PLAYER_RESPAWNED,
              synchronisation_payload(client, state)
            )
          else
            world.events.emit(WorldRequest.PLAYER_HEALTH_UPDATE, {
              uuid: client.uuid,
              username: client.username,
              health,
            })

          if (health === 0) {
            dispatch(PlayerEvent.DIE)
            setTimeout(() => {
              // delaying to let the time of the death animation
              world.events.emit(WorldRequest.PLAYER_DIED, { uuid: client.uuid })
            }, 700)
            play_sound({
              client,
              sound: 'entity.zombie_villager.converted',
              ...position,
            })
          }
        }
        return health
      }, null)
  },
}
