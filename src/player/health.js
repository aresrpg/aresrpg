import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import {
  Characteristic,
  get_max_health,
  get_total_characteristic,
} from '../characteristics.js'
import { compute_damage } from '../damage.js'
import { PlayerEvent, WorldRequest } from '../events.js'
import { abortable } from '../iterator.js'
import { normalize_range } from '../math.js'
import { play_sound } from '../sound.js'
import { synchronisation_payload } from '../sync.js'

export const SCOREBOARD_NAME = 'life'
const CREATE_OBJECTIVE_ACTION = 0
const INTEGER_TYPE = 0
const BELOW_NAME_POSITION = 2
const REGENERATION_MIND_DIVIDER = 50

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerEvent.UPDATE_HEALTH) {
      const max_health = get_max_health(state)
      const health = Math.max(0, Math.min(max_health, payload.health))

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch, world, get_state }) {
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

    aiter(abortable(setInterval(1000, { signal })))
      .map(get_state)
      .filter(state => !!state)
      .forEach(({ health, inventory, characteristics }) => {
        const mind = get_total_characteristic(Characteristic.MIND, {
          inventory,
          characteristics,
        })
        const regeneration_per_second = compute_damage({
          base_damage: mind / REGENERATION_MIND_DIVIDER,
          characteristic_amount: mind,
        })
        if (health > 0)
          dispatch(PlayerEvent.UPDATE_HEALTH, {
            health: health + regeneration_per_second,
          })
      })

    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([state]) => state)
      .reduce((last_health, state) => {
        const { position, health } = state
        if (last_health !== health) {
          client.write('update_health', {
            health: normalize_range(
              health,
              { min: 0, max: get_max_health(state) },
              { min: 0, max: 40 }
            ),
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
              // allows a correct handling of the position
              dispatch(PlayerEvent.TELEPORT_TO, world.spawn_position)
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
