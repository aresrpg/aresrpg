import logger from '../logger.js'
import { block_position } from '../position.js'
import { path_position } from '../mobs/path.js'
import { path_between, diagonal_distance } from '../mobs/navigation.js'
import { SUCCESS, FAILURE, RUNNING } from '../behavior.js'

const log = logger(import.meta)

export default async function goto(node, state, { world, action }) {
  const { time } = action
  const to = block_position(state.blackboard[node.getAttribute('target')])
  const from = block_position(
    path_position({
      path: state.path,
      start_time: state.start_time,
      speed: state.speed,
      time,
    })
  )

  const distance = Number(node.getAttribute('distance') ?? 0)

  if (diagonal_distance(from, to) <= distance) {
    return { status: SUCCESS, state }
  } else if (
    diagonal_distance(state.path[state.path.length - 1], to) <= distance
  ) {
    return { status: RUNNING, state }
  } else {
    const start_time = time

    log.info({ start_time, from, to }, 'Goto Block')

    const { path, open, closed } = await path_between({
      world,
      from,
      to,
      distance,
    })

    if (path != null) {
      return {
        status: RUNNING,
        state: {
          ...state,
          path,
          open,
          closed,
          start_time,
        },
      }
    } else {
      return {
        status: FAILURE,
        state,
      }
    }
  }
}
