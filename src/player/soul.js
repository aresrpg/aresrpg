import { Action } from '../events.js'

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.DEATH) {
      return {
        ...state,
        soul: state.soul - 10,
      }
    }
    return state
  },
}
