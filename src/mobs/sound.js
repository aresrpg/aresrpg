import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { PlayerEvent } from '../events.js'
import { play_sound } from '../sound.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { abortable } from '../iterator.js'
import { distance3d_squared } from '../math.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal, get_state }) {
    events.on(PlayerEvent.MOB_DAMAGED, ({ mob: { type, position } }) => {
      const {
        sounds: { hurt },
      } = Entities[type]
      play_sound({
        client,
        sound: hurt,
        ...position(),
      })
    })

    events.on(PlayerEvent.MOB_DEATH, ({ mob: { type, position } }) => {
      const {
        sounds: { death },
      } = Entities[type]
      play_sound({
        client,
        sound: death,
        ...position(),
      })
    })

    aiter(abortable(setInterval(1000, null, { signal }))).forEach(() => {
      const { position: player_position } = get_state() ?? {}
      if (player_position)
        world.mobs.all
          .filter(() => Math.random() < 0.05)
          .map(({ type, position }) => ({ type, position: position() }))
          .filter(
            ({ position }) =>
              distance3d_squared(position, player_position) <= 30 ** 2,
          )
          .forEach(({ type, position }) => {
            const {
              sounds: { ambient },
            } = Entities[type]
            play_sound({
              client,
              sound: ambient,
              ...position,
            })
          })
    })
  },
}
