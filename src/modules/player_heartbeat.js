import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../core/iterator.js'
import { play_sound } from '../core/sound.js'
import logger from '../logger.js'
import { get_max_health } from '../core/characteristics.js'
import { normal_screen, red_screen } from '../core/world_border.js'

const HEALTH_THRESHOLD = 15
const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  observe({ client, events, signal, dispatch }) {
    aiter(abortable(on(events, 'STATE_UPDATED', { signal }))).reduce(
      ({ heartbeating, sound_handle }, [state]) => {
        const { health } = state
        const max_health = get_max_health(state)
        const health_percent = Math.round((100 * health) / max_health)

        if (heartbeating && health_percent > HEALTH_THRESHOLD) {
          normal_screen({ client })
          clearInterval(sound_handle)
          log.info({ health_percent }, 'disabling low life blood effect')

          return { heartbeating: false, sound_handle: undefined }
        } else if (!heartbeating && health_percent < HEALTH_THRESHOLD) {
          red_screen({ client })
          log.info({ health_percent }, 'low life blood effect')

          return {
            heartbeating: true,
            sound_handle: setInterval(() => {
              play_sound({
                client,
                sound: 'heart',
                ...state.position,
              })
            }, 1500),
          }
        }

        return { heartbeating, sound_handle }
      },
      { heartbeating: false, sound_handle: undefined },
    )
  },
}
