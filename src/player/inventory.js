export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/window_click') {
      const { windowId, slot } = payload
      if (windowId !== 0) return state
      const _state = {
        ...state,
        inventory: [
          ...state.inventory.slice(0, slot),
          state.cursor_item_selected,
          ...state.inventory.slice(slot + 1),
        ],
        cursor_item_selected: state.inventory[slot],
      }
      console.log(_state.inventory, _state.cursor_item_selected)
      return _state
    }
    return state
  },
}
