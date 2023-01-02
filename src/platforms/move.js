import { PlatformAction } from '../events.js'

export default {
  reduce_platform(state, { type, payload }, context) {
    if (type === PlatformAction.MOVE) {
      const { up } = payload
      return {
        ...state,
        position: {
          ...state.position,
          y: state.position.y + (up ? +0.1 : -0.1),
        },
      }
    }
    return state
  },
}
