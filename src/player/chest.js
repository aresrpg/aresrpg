import { on } from 'events'

import { aiter } from 'iterator-helper'

import { empty_slot, item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }
import banks from '../../world/floor1/bank.json' assert { type: 'json' }
import { PlayerEvent, PlayerAction } from '../events.js'
import { BANK_INVENTORY_ID } from '../settings.js'
import { abortable } from '../iterator.js'

const invType = 5 // 9x6 chest

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

/*
[
    {
        "town": "thebes",
        "bank_id": 0,
        "position": {
            "x": 50,
            "y": 50,
            "z": 50
        }
    }
]
*/

const to_slot = item =>
  item ? item_to_slot(items[item.type], item.count) : empty_slot

const write_bank = ({ client, bank, bank_id }) => {
  client.write('window_items', {
    // bank
    windowId: BANK_INVENTORY_ID + bank_id,
    items: bank[bank_id].map(to_slot),
  })
}

async function open_bank({ client, bank, inventory, bank_id }) {
  const global_bank = [...bank[bank_id], ...inventory.slice(8)]
  client.write('open_window', {
    windowId: BANK_INVENTORY_ID + bank_id,
    inventoryType: invType,
    windowTitle: JSON.stringify({
      text: `Banque ${bank_id}`,
    }),
  })
  client.write('window_items', {
    windowId: BANK_INVENTORY_ID + bank_id,
    items: global_bank.map(to_slot),
  })
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    const { windowId, slot, mode } = payload
    const {
      bank_cursor,
      bank,
      bank_id,
      inventory,
      bank_cursor_index,
      bank_sequence_number,
    } = state

    switch (type) {
      case 'packet/window_click':
        if (windowId === BANK_INVENTORY_ID + bank_id) {
          if (mode === 0) {
            const drop = slot === -999
            const index = drop ? bank_cursor_index : slot
            const bank_inventory = [...bank[bank_id], ...inventory.splice(8)]

            // Put cursor at index
            const cursorToIndex = [
              ...bank_inventory.slice(0, index),
              bank_cursor,
              ...bank_inventory.slice(index + 1),
            ]

            bank[bank_id] = cursorToIndex
            return {
              ...state,
              // Resync if we drop
              bank_sequence_number: bank_sequence_number + (drop ? 1 : 0),
              bank_cursor: bank_inventory[index],
              bank_cursor_index:
                bank_cursor == null ? index : bank_cursor_index,
            }
          }
          /* Unhandled action resync inventory */
          return {
            ...state,
            bank_sequence_number: bank_sequence_number + 1,
          }
        }
        break
      case PlayerAction.RESYNC_INVENTORY:
        return {
          ...state,
          bank_sequence_number: bank_sequence_number + 1,
        }
      default:
        return {
          ...state,
        }
    }
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, get_state }) {
    client.on('block_place', ({ location }) => {
      const { bank_id } = banks.find(bank => bank.position === location)
      if (bank_id) {
        const { bank, inventory } = get_state()
        open_bank({
          client,
          bank,
          inventory,
          bank_id,
        })
      }
    })

    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal }))).reduce(
      async (
        last_sequence_number,
        [{ bank, bank_id, bank_cursor, bank_sequence_number }]
      ) => {
        if (last_sequence_number !== bank_sequence_number) {
          // mooving item to item
          write_bank({ client, bank, bank_id })

          client.write('set_slot', {
            windowId: -1,
            slot: -1,
            item: to_slot(bank_cursor),
          })
        }
        return bank_sequence_number
      },
      null
    )

    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {
        const { bank, bank_id } = get_state()
        write_bank({ client, bank, bank_id })
      }
    })
  },
}
