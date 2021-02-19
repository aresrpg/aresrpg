const types = ['packet/position', 'packet/position_look', 'packet/look']

export default {
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
