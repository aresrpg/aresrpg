import logger from '../logger.js'

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'SWITCH_GAMEMODE') {
      const { game_mode } = payload
      log.info({ game_mode }, 'gamemode updated')

      return {
        ...state,
        game_mode,
      }
    }
    return state
  },
}
