import { SUCCESS } from '../core/entity_behavior.js'
import { path_position } from '../core/entity_path.js'
import { block_position } from '../core/position.js'

export default function random_block_position(node, state, { action }) {
  const { time } = action
  const position = block_position(
    path_position({
      path: state.path,
      start_time: state.start_time,
      speed: state.speed,
      time,
    }),
  )

  const x_delta = Math.floor(Math.random() * 15 - 7)
  const z_delta = Math.floor(Math.random() * 15 - 7)

  return {
    status: SUCCESS,
    state: {
      ...state,
      blackboard: {
        ...state.blackboard,
        [node.getAttribute('output')]: {
          x: position.x + x_delta,
          y: position.y,
          z: position.z + z_delta,
        },
      },
    },
  }
}
