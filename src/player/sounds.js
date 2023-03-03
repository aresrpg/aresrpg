import { on } from 'events'

import { aiter } from 'iterator-helper'

import { PlayerEvent } from '../events.js'
import { abortable } from '../iterator.js'
import { play_sound, stop_sound } from '../sound.js'

import { closest_stone } from './teleportation_stones.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, signal }) {
    events.once(PlayerEvent.PACK_LOAD, () => {
      aiter(
        abortable(on(events, PlayerEvent.STATE_UPDATED, { signal }))
      ).reduce(
        ({ last_played_song }, [state]) => {
          const { position } = state
          const music =
            closest_stone(world, position)?.music ?? 'aresrpg.ambient.none'
          if (music !== last_played_song) {
            stop_sound({
              client,
              sound: last_played_song,
            })

            play_sound({
              client,
              sound: music,
              ...position,
            })
          }
          return { last_played_song: music }
        },
        {
          last_played_song: undefined,
        }
      )
    })
  },
}
