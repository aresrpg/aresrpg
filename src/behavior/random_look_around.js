import { SUCCESS } from '../behavior.js'

export default function random_look_around(node, state) {
  return {
    status: SUCCESS,
    state: {
      ...state,
      look_at: {
        yaw: Math.floor(Math.random() * 255) - 128,
        pitch: 0,
      },
    },
  }
}
