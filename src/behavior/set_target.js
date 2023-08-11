import { SUCCESS } from '../core/entity_behavior.js'

export default function set_target(node, state) {
  const target = state.blackboard[node.getAttribute('input')]
  if (target === state.target) {
    return {
      status: SUCCESS,
      state,
    }
  } else {
    return {
      status: SUCCESS,
      state: {
        ...state,
        target,
        target_position: null,
      },
    }
  }
}
