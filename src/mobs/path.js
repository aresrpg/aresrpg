import { on } from 'events'
import { setTimeout } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { MobEvent } from '../events.js'
import logger from '../logger.js'
import { async_tail_recursive } from '../iterator.js'

const log = logger(import.meta)

export function path_ended({ path, time, start_time, speed }) {
  const current = Math.floor((time - start_time) / speed)

  return current >= path.length
}

export function path_remain_time({ path, time, start_time, speed }) {
  if ((time - start_time) / speed > path.length - 1) return 0
  return (time - start_time) % speed
}

export function path_position({
  path,
  time,
  start_time,
  speed,
  block_position = false,
}) {
  const block_traveled = Math.max(0, (time - start_time) / speed)
  const current = Math.floor(block_traveled)
  const remain = block_position ? 0 : block_traveled % 1

  const from = path[Math.min(current, path.length - 1)]
  const to = path[Math.min(current + 1, path.length - 1)]

  return {
    x: from.x + (to.x - from.x) * remain,
    y: from.y,
    z: from.z + (to.z - from.z) * remain,
  }
}

const PATH_UPDATE_MS = 50 /* 1 update each minecraft tick */

async function* raw_path_to_positions(stream, value = stream.next()) {
  const {
    value: { path, start_time, speed },
    done,
  } = await value

  if (done) return

  const next = stream.next()

  while (true) {
    const time = Date.now()

    yield {
      position: path_position({ path, time, start_time, speed }),
      target: path.at(-1),
    }

    /* End of path, wait for next path */
    if (path_ended({ path, time, start_time, speed })) break

    // gives current time with 1 path_update_ms added (more precise)
    const next_time = (Math.floor(time / PATH_UPDATE_MS) + 1) * PATH_UPDATE_MS

    const new_path = await Promise.race([
      setTimeout(next_time - time, false, { ref: false }),
      next.then(() => true),
    ])

    if (new_path) break
  }

  return {
    next_stream: raw_path_to_positions,
    parameters: [stream, next],
  }
}

export const path_to_positions = async_tail_recursive(raw_path_to_positions)

async function* raw_path_to_end(stream, value = stream.next()) {
  const {
    value: { path, start_time, speed },
    done,
  } = await value

  if (done) return

  const next = stream.next()
  const time = Date.now()

  const next_time = start_time + path.length * speed

  const path_end = await Promise.race([
    setTimeout(next_time - time, true, { ref: false }),
    next.then(() => false),
  ])

  if (path_end) yield next_time

  return {
    next_stream: raw_path_to_end,
    parameters: [stream, next],
  }
}

export const path_to_end = async_tail_recursive(raw_path_to_end)

export function path_end(mobs) {
  for (const mob of mobs) {
    const state = aiter(on(mob.events, MobEvent.STATE_UPDATED)).map(
      ([state]) => state,
    )

    const end = path_to_end(state)

    aiter(end).reduce((last_time, time) => {
      if (last_time !== time) {
        log.debug({ at: time }, 'Path Ended')
        mob.dispatch(MobEvent.END_PATH, null, time)
      }
      return time
    })
  }
}
