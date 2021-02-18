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

export function block_position({ x, y, z }) {
  return {
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  }
}

export function block_center_position({ x, y, z }) {
  return {
    x: Math.floor(x) + 0.5,
    y: Math.floor(y),
    z: Math.floor(z) + 0.5,
  }
}
