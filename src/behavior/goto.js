import logger from '../logger.js'
import { block_center_position } from '../position.js'
import { path_position, path_remain_time } from '../mobs/path.js'
import {
  path_between,
  diagonal_distance,
  horizontal_diagonal_distance,
} from '../mobs/navigation.js'
import { SUCCESS, FAILURE, RUNNING } from '../behavior.js'

const log = logger(import.meta)

export default async function goto(node, state, { world, action }) {
  const { time } = action
  const to = block_center_position(
    state.blackboard[node.getAttribute('target')]
  )
  const from = path_position({
    path: state.path,
    start_time: state.start_time,
    speed: state.speed,
    time,
    block_position: true,
  })
  const remaining_time = path_remain_time({
    path: state.path,
    start_time: state.start_time,
    speed: state.speed,
    time,
  })

  const distance = Number(node.getAttribute('distance') ?? 0)
  const distance_fn = node.hasAttribute('ignore_y')
    ? horizontal_diagonal_distance
    : diagonal_distance

  if (distance_fn(from, to) <= distance) {
    return { status: SUCCESS, state }
  } else if (distance_fn(state.path[state.path.length - 1], to) <= distance) {
    return { status: RUNNING, state }
  } else {
    const start_time = time - remaining_time

    const { path, open, closed } = await path_between({
      world,
      from,
      to,
      distance,
      distance_fn,
    })

    if (path != null) {
      log.debug({ start_time, from, to }, 'Goto Block')
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
      log.debug({ start_time, from, to }, 'Failed Goto Block')
      return {
        status: FAILURE,
        state,
      }
    }
  }
}
