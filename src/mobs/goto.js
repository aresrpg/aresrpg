import logger from '../logger.js'
import { block_position } from '../position.js'
import { MobEvent } from '../events.js'

import { path_position } from './path.js'
import { path_between } from './navigation.js'

const log = logger(import.meta)

export default {
  /** @type {import('../mobs').MobsReducer} */
  async reduce_mob(state, { type, payload, time }, { world }) {
    if (type === MobEvent.GOTO) {
      const { position } = payload

      const to = block_position(position)

      const from = block_position(
        path_position({
          path: state.path,
          start_time: state.start_time,
          speed: state.speed,
          time,
        }),
      )

      const start_time = time

      log.info({ start_time, from, to }, 'Goto')

      const { path, open, closed } = await path_between({ world, from, to })

      if (path != null) {
        return {
          ...state,
          path,
          open,
          closed,
          start_time,
        }
      } else {
        log.info(
          {
            start_time,
            from,
            to,
          },
          'No Path Found',
        )
        return {
          ...state,
          path: [from],
          open,
          closed,
          start_time,
        }
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world }) {
    const right_click = 2

    client.on('use_entity', ({ target, mouse, hand }) => {
      if (mouse === right_click && hand === 0) {
        const mob = world.mobs.by_entity_id(target)
        if (mob) {
          setTimeout(() => {
            const { position } = get_state()
            mob.dispatch(MobEvent.GOTO, {
              position,
            })
          }, 5000).unref()
        }
      }
    })
  },
}
