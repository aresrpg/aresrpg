export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'packet/settings') {
      const { viewDistance } = payload
      return {
        ...state,
        view_distance: viewDistance + 1,
      }
    }
    return state
  },
}
