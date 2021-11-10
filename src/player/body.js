import { Action } from '../events.js'
import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.BODY_STATE) {
      const { username } = state
      const { body_state } = payload

      log.info({ username, body_state }, '👻💀❤️')

      return {
        ...state,
        body_state,
      }
    }
    return state
  },
}
