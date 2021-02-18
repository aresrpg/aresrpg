const types = ['packet/position', 'packet/position_look', 'packet/look']

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (types.includes(type)) {
      return {
        ...state,
        position: {
          ...state.position,
          ...payload,
        },
      }
    }
    return state
  },
}
