import { get_block } from '../core/chunk.js'
import logger from '../logger.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  name: 'player_block_placement',
  observe({ dispatch, client, world }) {
    client.on('block_place', ({ location }) =>
      get_block(world, location)
        .then(({ name, stateId }) => {
          if (name === 'flower_pot') {
            dispatch('RESYNC_INVENTORY')
            client.write('block_change', {
              location,
              type: stateId,
            })
          }
        })
        .catch(error => log.error(error)),
    )
  },
}
