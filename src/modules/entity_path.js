import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'
import { path_to_end } from '../core/entity_path.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  name: 'entity_path',
  observe_mob({ events, dispatch }) {
    const state = aiter(on(events, 'STATE_UPDATED')).map(([state]) => state)
    const end = path_to_end(state)

    aiter(end).reduce((last_time, time) => {
      if (last_time !== time) {
        log.debug({ at: time }, 'Path Ended')
        dispatch('END_PATH', null, time)
      }
      return time
    })
  },
}
