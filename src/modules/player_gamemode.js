import logger from '../logger.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
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
