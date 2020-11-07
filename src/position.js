const types = ['packet/position', 'packet/position_look', 'packet/look']

export function reduce_position(state, { type, payload }) {
  if (types.includes(type)) {
    const { onGround, ...position } = payload
    return {
      ...state,
      position: {
        ...state.position,
        ...position,
      },
    }
  }
  return state
}
