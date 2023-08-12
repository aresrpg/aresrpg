import { get_block } from '../core/chunk.js'
import { CATEGORY, play_sound } from '../core/sound.js'

const BELL_ACTION_ID = 1
const BELL_BLOCK_ID = 667

/** @type {import('../server').Module} */
export default {
  name: 'player_bells',
  observe(context) {
    const { client, world } = context
    client.on('block_place', async ({ location, direction }) => {
      const block = await get_block(world, location)
      if (block.name === 'bell' && direction >= 2) {
        client.write('block_action', {
          location,
          byte1: BELL_ACTION_ID,
          byte2: direction, // handle side from wich the bell is clicked (0 et 1 for up and down and other number for each side)
          blockId: BELL_BLOCK_ID,
        })
        play_sound({
          client,
          sound: 'block.bell.use',
          category: CATEGORY.AMBIENT,
          ...location,
        })
      }
    })
  },
}
