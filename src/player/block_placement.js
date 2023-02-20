import { get_block } from '../chunk.js'
import { PlayerEvent } from '../events.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ dispatch, client, world }) {
    client.on('block_place', ({ location }) =>
      get_block(world, location)
        .then(({ name, stateId }) => {
          if (name === 'flower_pot') {
            dispatch(PlayerEvent.RESYNC_INVENTORY)
            client.write('block_change', {
              location,
              type: stateId,
            })
          }
        })
        .catch(error => log.error(error))
    )
  },
}
