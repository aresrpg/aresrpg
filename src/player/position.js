const types = ['packet/position', 'packet/position_look', 'packet/look']

export function reduce_position(state, { type, payload }) {
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
}
