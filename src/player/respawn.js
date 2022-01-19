import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { overworld } from '../world/codec.js'
import { Action, Context } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'
import { GameMode } from '../gamemode.js'
import { write_title } from '../title.js'
import { Formats } from '../chat.js'
import { get_max_health } from '../player_statistics.js'
import { PLAYER_ENTITY_ID } from '../settings.js'

import { write_inventory } from './inventory.js'

const log = logger(import.meta)
const MIN_RESPAWN_TIME = 3
const MAX_RESPAWN_TIME = 10
const BLINDNESS = 15

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch, get_state }) {
    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ health, game_mode }]) => ({
        health,
        game_mode,
      }))
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

                const state = get_state()

                dispatch(Action.HEALTH, { health: get_max_health(state) })
                write_inventory({ client, inventory: state.inventory })

                client.write('entity_update_attributes', {
                  entityId: PLAYER_ENTITY_ID,
                  properties: [
                    {
                      key: 'generic.max_health',
                      value: 40,
                      modifiers: [],
                    },
                  ],
                })
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
