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
      const held_item = hotbar[held_slot_index]

      return {
        ...state,
        inventory: {
          ...inventory,
          off_hand: held_item,
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
}
