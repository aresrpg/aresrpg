export default {
  /** @type {import('../index.js').Reducer} */
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
