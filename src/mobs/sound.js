import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { Context } from '../events.js'
import { play_sound } from '../sound.js'
import Entities from '../../data/entities.json'
import { abortable } from '../iterator.js'
import { distance3d_squared } from '../math.js'

const random_percent = () => Math.floor(Math.random() * 100) + 1

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal, get_state }) {
    events.on(Context.MOB_DAMAGE, ({ mob: { type, position } }) => {
      const {
        sounds: { hurt },
      } = Entities[type]
      play_sound({
        client,
        sound: hurt,
        ...position(),
      })
    })

    events.on(Context.MOB_DEATH, ({ mob: { type, position } }) => {
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
          .filter(() => random_percent() < 6)
          .map(({ type, position }) => ({ type, position: position() }))
          .filter(
            ({ position }) =>
              distance3d_squared(position, player_position) <= 30 ** 2
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
