import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { play_sound } from '../core/sound.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { abortable } from '../core/iterator.js'
import { distance3d_squared } from '../core/math.js'

/** @type {import('../server').Module} */
export default {
  name: 'entity_sound',
  observe({ events, dispatch, client, world, signal, get_state }) {
    events.on('MOB_DAMAGED', ({ mob: { type, position } }) => {
      const {
        sounds: { hurt },
      } = Entities[type]
      play_sound({
        client,
        sound: hurt,
        ...position(),
      })
    })

    events.on('MOB_DEATH', ({ mob: { type, position } }) => {
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
        world.mobs
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
