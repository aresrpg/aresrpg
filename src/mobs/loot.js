import { block_center_position } from '../position.js'
import { Context, Action } from '../events.js'

import { Types } from './types.js'

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events, dispatch }) {
    events.on(Context.MOB_DEATH, ({ mob }) => {
      const position = mob.position()
      const owner = mob.get_state().first_damager

      if (owner === client.uuid) {
        const { loots = [] } = Types[mob.mob]
        for (const { chance, item } of loots) {
          if (chance >= Math.random()) {
            dispatch(Action.LOOT_ITEM, {
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
