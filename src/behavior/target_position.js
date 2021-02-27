import { SUCCESS, RUNNING, FAILURE } from '../behavior.js'

export default function target_position(node, state) {
  if (state.target == null) {
    return {
      status: FAILURE,
      state,
    }
  } else if (state.target_position == null) {
    return {
      status: RUNNING,
      state,
    }
  } else {
    return {
      status: SUCCESS,
      state: {
        ...state,
        blackboard: {
          ...state.blackboard,
          [node.getAttribute('output')]: state.target_position,
        },
      },
    }
  }
}
