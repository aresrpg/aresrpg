import { on } from 'events'

import { aiter } from 'iterator-helper'

import { PLAYER_INVENTORY_ID } from '../settings.js'
import { abortable } from '../iterator.js'
import { PlayerEvent } from '../events.js'
import { assign_items, similar, split_item, to_vanilla_item } from '../items.js'
import { write_inventory } from '../inventory.js'
import { from_inventory_array, to_inventory_array } from '../equipments.js'

const FORBIDDEN_SLOTS = [
  0, // Craft Output
  5, // Helmet
  6, // Chestplate
  7, // Leggings
  8, // Boots
  36, // equipped weapon slot (hotbar 0)
]

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

/** Handles each type of inventory action for `mode === 0` */
function handle_cursor({ right_click, cursor_content, slot_content }) {
  if (right_click) {
    // when the slot has an item, but not the cursor
    if (slot_content && !cursor_content) {
      // index order here doesn't matter
      const [slot, cursor] = split_item(slot_content)
      // we split both
      return { slot, cursor }
    }
    // when both the slot and cursors has items
    if (slot_content && cursor_content) {
      // if the item is the same, we stack
      if (similar(slot_content, cursor_content)) {
        // first index will be the target
        const [slot, cursor] = assign_items(slot_content, cursor_content, 1)
        return { slot, cursor }
      }
      // otherwise we switch
      return { cursor: slot_content, slot: cursor_content }
    }
    // when the slot is empty but the cursor hold an item
    if (!slot_content && cursor_content) {
      const [one, rest] = split_item(cursor_content, 1)
      return { cursor: rest, slot: one }
    }
  } else {
    if (slot_content && !cursor_content) return { cursor: slot_content }
    if (slot_content && cursor_content) {
      if (similar(slot_content, cursor_content)) {
        const [slot, cursor] = assign_items(slot_content, cursor_content)
        return { slot, cursor }
      }
      return { cursor: slot_content, slot: cursor_content }
    }
    if (!slot_content && cursor_content) return { slot: cursor_content }
  }
  return {}
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    const {
      inventory_sequence_number,
      inventory_cursor_index,
      inventory_cursor,
      inventory,
    } = state

    if (type === 'packet/window_click') {
      const { windowId, slot, mode, mouseButton: right_click } = payload
      if (
        FORBIDDEN_SLOTS.includes(slot) ||
        type === PlayerEvent.RESYNC_INVENTORY
      )
        return {
          ...state,
          inventory_sequence_number: inventory_sequence_number + 1,
        }
      else if (windowId === PLAYER_INVENTORY_ID) {
        if (mode === 0) {
          const drop = slot === -999
          const index = drop ? inventory_cursor_index : slot
          const inventory_array = to_inventory_array(inventory)
          const { cursor: next_cursor_content, slot: next_slot_content } =
            handle_cursor({
              right_click,
              slot_content: inventory_array[index],
              cursor_content: inventory_cursor,
            })

          return {
            ...state,
            inventory: from_inventory_array({
              inventory,
              inventory_array: [
                ...inventory_array.slice(0, index),
                next_slot_content,
                ...inventory_array.slice(index + 1),
              ],
            }),
            inventory_cursor: next_cursor_content,
            // Resync if we drop
            inventory_sequence_number: inventory_sequence_number + +drop,
            inventory_cursor_index: inventory_cursor
              ? inventory_cursor_index
              : index,
          }
        } else {
          /* Unhandled action resync inventory */
          return {
            ...state,
            inventory_sequence_number: inventory_sequence_number + 1,
          }
        }
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, events, world, get_state, signal }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal }))).reduce(
      (
        last_sequence_number,
        [
          {
            inventory,
            inventory_cursor,
            inventory_sequence_number,
            characteristics,
          },
        ]
      ) => {
        if (last_sequence_number !== inventory_sequence_number) {
          write_inventory(client, { inventory, characteristics })

          client.write('set_slot', {
            windowId: -1,
            slot: -1,
            item: to_vanilla_item(inventory_cursor, {
              inventory,
              characteristics,
            }),
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
        write_inventory(client, get_state())
      }
    })
  },
}
