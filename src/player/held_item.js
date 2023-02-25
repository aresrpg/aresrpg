import { on } from 'events'

import { aiter } from 'iterator-helper'

import { WorldRequest } from '../events.js'
import { get_held_item } from '../items.js'
import { abortable } from '../iterator.js'

const SWAP_HAND_STATUS = 6

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/held_item_slot') {
      const { slotId } = payload
      return {
        ...state,
        held_slot_index: slotId,
      }
    }
    if (type === 'packet/block_dig' && payload.status === SWAP_HAND_STATUS) {
      const { held_slot_index, inventory } = state
      const { off_hand, hotbar } = inventory

      return {
        ...state,
        inventory: {
          ...inventory,
          off_hand: get_held_item(state),
          hotbar: [
            ...hotbar.slice(0, held_slot_index),
            off_hand,
            ...hotbar.slice(held_slot_index + 1),
          ],
        },
        inventory_sequence_number: state.inventory_sequence_number + 1,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ world, client, signal }) {
    aiter(abortable(on(client, 'held_item_slot', { signal })))
      .map(([{ slotId }]) => slotId)
      .reduce((last_slot, { slotId }) => {
        if (last_slot !== slotId)
          world.events.emit(WorldRequest.RESYNC_DISPLAYED_INVENTORY, {
            uuid: client.uuid,
          })
        return slotId
      })
  },
}
