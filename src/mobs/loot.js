import { block_center_position } from '../position.js'

import { Types } from './types.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, dispatch }) {
    events.on('mob_death', ({ mob }) => {
      const position = mob.position()
      const owner = mob.get_state().first_damager

      if (owner === client.uuid) {
        for (const { chance, item } of Types[mob.mob].loots) {
          if (chance >= Math.random()) {
            dispatch('loot_item', {
              type: item,
              count: 1,
              position: block_center_position(position),
            })
          }
        }
      }
    })
  },
}
