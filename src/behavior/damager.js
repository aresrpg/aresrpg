import { SUCCESS, FAILURE } from '../behavior.js'

export default function get_biggest_damager(node, state) {
  if (state.last_damager == null) {
    return {
      status: FAILURE,
      state,
    }
  } else {
    return {
      status: SUCCESS,
      state: {
        ...state,
        blackboard: {
          ...state.blackboard,
          [node.getAttribute('output')]: state.last_damager,
        },
      },
    }
  }
}
