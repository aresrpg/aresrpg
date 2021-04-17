import { SUCCESS } from '../behavior.js'

export default function look_at_player(node, state) {
  return {
    status: SUCCESS,
    state: {
      ...state,
      look_at: {
        player: true,
        yaw: 0,
        pitch: 0,
      },
    },
  }
}
