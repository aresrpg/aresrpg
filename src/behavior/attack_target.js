import { SUCCESS, RUNNING, FAILURE } from '../core/entity_behavior.js'

export default function attack_target(node, state) {
  if (!state.target) {
    return {
      status: FAILURE,
      state,
    }
  } else if (!state.target_position) {
    return {
      status: RUNNING,
      state,
    }
  } else {
    return {
      status: SUCCESS,
      state: {
        ...state,
        attack_sequence_number: state.attack_sequence_number + 1,
      },
    }
  }
}
