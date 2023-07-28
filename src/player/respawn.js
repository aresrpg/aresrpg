import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { overworld } from '../world/codec.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { GameMode } from '../gamemode.js'
import { write_title } from '../title.js'
import { Formats } from '../chat.js'
import { get_max_health } from '../characteristics.js'
import { write_inventory } from '../inventory.js'
import {
  get_attack_speed,
  get_movement_speed,
  send_attack_speed,
  send_movement_speed,
} from '../attribute.js'
import { set_invisible, set_on_fire } from '../player.js'

const log = logger(import.meta)
const MIN_RESPAWN_TIME = 3
const MAX_RESPAWN_TIME = 10
const BLINDNESS = 15

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch, get_state, world }) {
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ health, game_mode }]) => ({ health, game_mode }))
      .reduce((last_health, { health, game_mode }) => {
        if (last_health !== health && health === 0) {
          const respawn_in =
            Math.floor(Math.random() * (MAX_RESPAWN_TIME - MIN_RESPAWN_TIME)) +
            MIN_RESPAWN_TIME

          client.write('entity_effect', {
            entityId: client.uuid,
            effectId: BLINDNESS,
            amplifier: 1,
            duration: respawn_in * 20,
            hideParticles: true,
          })

          aiter(abortable(setInterval(1000, null, { signal })))
            .take(respawn_in + 1)
            .asIndexedPairs()
            // invert
            .map(([index]) => respawn_in - index)
            .forEach(remaining => {
              if (remaining === 0) {
                log.info({ player: client.username }, 'respawning..')
                client.write('respawn', {
                  dimension: overworld,
                  worldName: 'minecraft:overworld',
                  hashedSeed: [0, 0],
                  gamemode: GameMode.ADVENTURE,
                  previousGamemode: GameMode.ADVENTURE,
                  isDebug: false,
                  isFlat: false,
                  copyMetadata: false,
                })

                set_on_fire(client, false)

                const state = get_state()
                // respawn with 5% life
                const respawn_health = Math.min(
                  1,
                  Math.floor(get_max_health(state) * 0.05),
                )

                dispatch('UPDATE_HEALTH', { health: respawn_health })

                write_inventory(client, state)
                send_attack_speed(client, get_attack_speed(state))
                send_movement_speed(client, get_movement_speed(state))

                // if the player became a ghost, he must become invisible
                if (state.soul === 0) set_invisible(client)
              } else {
                log.info({ remaining }, 'respawning in seconds')
                write_title({
                  client,
                  times: {
                    fade_in: 0,
                    fade_out: 0,
                    stay: 1.2,
                  },
                  title: [
                    {
                      text: 'respawn in ',
                      ...Formats.BASE,
                    },
                    {
                      text: remaining,
                      ...Formats.INFO,
                    },
                  ],
                })
              }
            })
        }
        return health
      }, 0)
  },
}
