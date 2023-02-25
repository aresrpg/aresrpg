import { on } from 'events'

import { aiter } from 'iterator-helper'

import { get_attack_speed, send_attributes } from '../attribute.js'
import { PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import logger from '../logger.js'

const DEFAULT_ATTACK_SPEED = 5

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([state]) => state)
      .reduce(
        ({ last_attack_speed }, state) => {
          const attack_speed = get_attack_speed(state)

          if (last_attack_speed !== attack_speed) {
            log.info({ attack_speed }, 'attack speed updated')
            send_attributes(client, { attack_speed })
          }

          return { last_attack_speed: attack_speed }
        },
        {
          last_attack_speed: DEFAULT_ATTACK_SPEED,
        }
      )
  },
}
