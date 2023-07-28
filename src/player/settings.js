export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'UPDATE_SETTINGS')
      return {
        ...state,
        settings: {
          ...state.settings,
          ...payload,
        },
      }
    return state
  },
}
