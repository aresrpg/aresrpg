import { RUNNING, SUCCESS } from '../core/entity_behavior.js'

export default function sleep(node, state, { action, path }) {
  const { time } = action

  if (state.wakeup_at > time) {
    return {
      status: RUNNING,
      state,
    }
  } else if (state.sleep_id === path) {
    return {
      status: SUCCESS,
      state: {
        ...state,
        sleep_id: null,
      },
    }
  } else {
    // Arm timer
    const duration = Number(node.getAttribute('time')) * 1000

    return {
      status: RUNNING,
      state: {
        ...state,
        wakeup_at: time + duration,
        sleep_id: path,
      },
    }
  }
}
