import { block_center_position } from '../core/position.js'
import Entities from '../../data/entities.json' assert { type: 'json' }

/** @type {import('../server').Module} */
export default {
  name: 'entity_loot',
  observe({ client, events, dispatch }) {
    events.on('ENTITY_DIED_IN_VIEW', ({ mob }) => {
      const position = mob.position()
      const owner = mob.get_state().first_damager

      if (owner === client.uuid) {
        for (const { chance, item } of Entities[mob.type].loots) {
          if (chance >= Math.random()) {
            dispatch('LOOT_ITEM', {
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
