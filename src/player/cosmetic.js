import { Action } from '../events.js'
import logger from '../logger.js'
import Animations from '../player/spells/animations.json' assert { type: 'json' }

const log = logger(import.meta)

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.COSMETIC) {
      const { category, effect } = payload

      log.info({ category, effect }, 'cosmetic update')
      const cosmetics = {
        ...state.cosmetics,
        sweep_attack: Animations[category][effect]
      }


      return {
        ...state,
        cosmetics
      }
    }
    return state
  },
}