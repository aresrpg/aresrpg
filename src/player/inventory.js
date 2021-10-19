import { on } from 'events'

import { aiter } from 'iterator-helper'

import { empty_slot, item_to_slot } from '../items.js'
import { PLAYER_INVENTORY_ID } from '../settings.js'
import { abortable } from '../iterator.js'
import { Context } from '../events.js'

const FORBIDDEN_SLOTS = [
  0, // Craft Output
  5, // Helmet
  6, // Chestplate
  7, // Leggings
  8, // Boots
]

export const USABLE_INVENTORY_START = 9
export const USABLE_INVENTORY_END = 44

const BlockDigStatus = {
  STARTED_DIGGING: 0,
  CANCELLED_DIGGING: 1,
  FINISHED_DIGGING: 2,
  DROP_ITEM_STACK: 3,
  DROP_ITEM: 4,
  SHOOT_ARROW: 5,
  FINISH_EATING: 5,
  SWAP_ITEM_IN_HAND: 6,
}

export default {
  /** @type {import('../context.js').Reducer} */
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
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, get_state, signal }) {
    const to_slot = item =>
      item ? item_to_slot(world.items[item.type], item.count) : empty_slot

    const write_inventory = inventory =>
      client.write('window_items', {
        windowId: PLAYER_INVENTORY_ID,
        items: inventory.map(to_slot),
      })

    aiter(abortable(on(events, Context.STATE, { signal }))).reduce(
      (
        last_sequence_number,
        [{ inventory, inventory_cursor, inventory_sequence_number }]
      ) => {
        if (last_sequence_number !== inventory_sequence_number) {
          write_inventory(inventory)

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

    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {
        write_inventory(get_state().inventory)
      }
    })
  },
}
