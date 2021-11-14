import { get_block } from '../chunk.js'
import { Action } from '../events.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ dispatch, client, world }) {
    client.on('block_place', ({ location }) =>
      get_block(world, location)
        .then(({ name, stateId }) => ({ name, stateId }))
        .catch(error => {
          log.error(error)
          return {}
        })
        .then(({ name, stateId }) => {
          if (name === 'flower_pot') {
            dispatch(Action.RESYNC_INVENTORY)
            client.write('block_change', {
              location,
              type: stateId,
            })
          }
        })
    )
  },
}
