import { on } from 'events'

import { aiter } from 'iterator-helper'

import {
  get_attack_speed,
  get_movement_speed,
  send_attack_speed,
  send_movement_speed,
} from '../core/attribute.js'
import { abortable } from '../core/iterator.js'

/** @type {import('../server').Module} */
export default {
  observe({ client, events, signal }) {
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([state]) => state)
      .reduce(
        ({ last_attack_speed, last_speed }, state) => {
          const attack_speed = get_attack_speed(state)
          const speed = get_movement_speed(state)

          if (last_attack_speed !== attack_speed)
            send_attack_speed(client, attack_speed)

          if (last_speed !== speed) send_movement_speed(client, speed)

          return { last_attack_speed: attack_speed, last_speed: speed }
        },
        {
          last_attack_speed: null,
          last_speed: null,
        },
      )
  },
}
