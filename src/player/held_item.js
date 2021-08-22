const OFF_HAND_SLOT = 45
const SWAP_HAND_STATUS = 6
const hotbar_to_inventory_slot = (slot_id) => slot_id + 36

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/block_dig' && payload.status === SWAP_HAND_STATUS) {
      const held_item_slot = hotbar_to_inventory_slot(state.held_slot_index)
      const inventory = [...state.inventory]
      ;[inventory[OFF_HAND_SLOT], inventory[held_item_slot]] = [
        inventory[held_item_slot],
        inventory[OFF_HAND_SLOT],
      ]
      return {
        ...state,
        inventory,
      }
    }
    return state
  },
}
