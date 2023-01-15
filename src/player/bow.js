import items from '../../data/items.json' assert { type: 'json' }
import { PlayerEvent } from '../events.js'
import { to_direction } from '../math.js'
import { BASIC_ARROW_ID } from '../projectiles/basic_arrow.js'

import { Hand } from './hand.js'
import { hotbar_to_inventory_slot } from './held_item.js'

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal, get_state }) {
    client.on('use_item', ({ hand }) => {
      const { inventory, held_slot_index, position } = get_state()
      const inventory_slot = hotbar_to_inventory_slot(held_slot_index)
      const held_item = inventory[inventory_slot]
      const item_definition = items[held_item?.type]
      if (
        item_definition?.type !== 'weapon' ||
        item_definition?.weapon_type !== 'bow' ||
        hand !== Hand.MAIN_HAND
      )
        return

      events.emit(PlayerEvent.LAUNCH_PROJECTILE, {
        id: BASIC_ARROW_ID,
        forward: to_direction(position.yaw, position.pitch),
        position: { ...position, y: position.y + 1 },
      })
    })
  },
}
