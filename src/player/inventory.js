import { on } from 'events'

import { aiter } from 'iterator-helper'

import { empty_slot, item_to_slot } from '../items.js'
import { PLAYER_INVENTORY_ID } from '../index.js'

const FORBIDDEN_SLOTS = [
  0, // Craft Output
  5, // Helmet
  6, // Chestplate
  7, // Leggings
  8, // Boots
]

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/window_click') {
      const { windowId, slot, mode } = payload

      if (windowId === PLAYER_INVENTORY_ID && !FORBIDDEN_SLOTS.includes(slot)) {
        if (mode === 0) {
          const drop = slot === -999

          const index = drop ? state.inventory_cursor_index : slot

          // Put cursor at index
          const inventory = [
            ...state.inventory.slice(0, index),
            state.inventory_cursor,
            ...state.inventory.slice(index + 1),
          ]

          return {
            ...state,
            inventory,
            // Resync if we drop
            inventory_sequence_number:
              state.inventory_sequence_number + (drop ? 1 : 0),
            inventory_cursor: state.inventory[index],
            inventory_cursor_index:
              state.inventory_cursor == null
                ? index
                : state.inventory_cursor_index,
          }
        } else {
          /* Unhandled action resync inventory */
          return {
            ...state,
            inventory_sequence_number: state.inventory_sequence_number + 1,
          }
        }
      }
    }
    return state
  },
  /** @type {import('../index.js').Observer} */
  observe({ client, events, world }) {
    aiter(on(events, 'state')).reduce(
      (
        last_sequence_number,
        [{ inventory, inventory_cursor, inventory_sequence_number }]
      ) => {
        if (last_sequence_number !== inventory_sequence_number) {
          const to_slot = (item) =>
            item ? item_to_slot(world.items[item.type], item.count) : empty_slot

          client.write('window_items', {
            windowId: PLAYER_INVENTORY_ID,
            items: inventory.map(to_slot),
          })

          client.write('set_slot', {
            windowId: -1,
            slot: -1,
            item: to_slot(inventory_cursor),
          })
        }
        return inventory_sequence_number
      },
      null
    )
  },
}
