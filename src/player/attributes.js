import { on } from 'events'

import { aiter } from 'iterator-helper'

import { delay_to_generic_attack_speed } from '../attribute.js'
import { get_attack_delay, get_haste } from '../characteristics.js'
import { PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import logger from '../logger.js'

const DEFAULT_ATTACK_SPEED = 5

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([state]) => state)
      .reduce(
        ({ last_attack_speed }, { inventory, characteristics }) => {
          const haste = get_haste({ inventory, characteristics })
          const delay = get_attack_delay(haste)
          const attack_speed = delay_to_generic_attack_speed(delay)

          if (last_attack_speed !== attack_speed) {
            log.info({ attack_speed, delay }, 'attack speed updated')

            client.write('entity_update_attributes', {
              entityId: PLAYER_ENTITY_ID,
              properties: [
                {
                  key: 'generic.max_health',
                  value: 40,
                  modifiers: [],
                },
                {
                  key: 'generic.attack_speed',
                  value: attack_speed,
                  modifiers: [],
                },
              ],
            })
          }

          return { last_attack_speed: attack_speed }
        },
        {
          last_attack_speed: DEFAULT_ATTACK_SPEED,
        }
      )
  },
}
