export default {
  reduce(state, { type, payload }) {
    if (type === 'packet/settings') {
      const { viewDistance } = payload
      return {
        ...state,
        view_distance: viewDistance,
      }
    }
    return state
  },
}
