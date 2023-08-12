/** @type {import('../server').Module} */
export default {
  name: 'player_settings',
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
