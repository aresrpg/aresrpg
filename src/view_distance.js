export function reduce_view_distance(state, { type, payload }) {
  if (type === 'packet/settings') {
    const { viewDistance } = payload
    return {
      ...state,
      view_distance: viewDistance,
    }
  }
  return state
}
