const OFF_HAND_SLOT = 45
const SWAP_HAND_STATUS = 6
const hotbar_to_inventory_slot = (slot_id) => slot_id + 36

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/held_item_slot') {
      const { slotId } = payload
      return {
        ...state,
        held_slot_index: slotId,
      }
    }
    if (type === 'packet/block_dig' && payload.status === SWAP_HAND_STATUS) {
      const { held_slot_index } = state
      const inventory_slot = hotbar_to_inventory_slot(held_slot_index)
      const inventory = [...state.inventory]
      ;[inventory[OFF_HAND_SLOT], inventory[inventory_slot]] = [
        inventory[inventory_slot],
        inventory[OFF_HAND_SLOT],
      ]
      return {
        ...state,
        inventory,
        inventory_sequence_number: state.inventory_sequence_number + 1,
      }
    }
    return state
  },
}
