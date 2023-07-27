import { PlayerAction } from '../events.js'

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === PlayerAction.UPDATE_SETTINGS)
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
