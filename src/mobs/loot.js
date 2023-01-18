import { block_center_position } from '../position.js'
import { PlayerEvent, PlayerAction } from '../events.js'
import { Entities } from '../data.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, dispatch }) {
    events.on(PlayerEvent.MOB_DEATH, ({ mob }) => {
      const position = mob.position()
      const owner = mob.get_state().first_damager

      if (owner === client.uuid) {
        for (const { chance, item } of Entities[mob.type].loots) {
          if (chance >= Math.random()) {
            dispatch(PlayerAction.LOOT_ITEM, {
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
