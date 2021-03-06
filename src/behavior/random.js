import { SUCCESS, FAILURE } from '../behavior.js'

export default function random(node, state) {
  const chance = Number(node.getAttribute('chance'))
  const success = chance >= Math.random()
  return {
    status: success ? SUCCESS : FAILURE,
    state,
  }
}
