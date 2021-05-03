import { promisify } from 'util'
import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'

const log = logger(import.meta)

const setTimeoutPromise = promisify(setTimeout)

export function path_ended({ path, time, start_time, speed }) {
  const current = Math.floor((time - start_time) / speed)

  return current >= path.length
}

export function path_position({ path, time, start_time, speed }) {
  const t = (time - start_time) / speed
  const current = Math.floor(t)
  const remain = t % 1

  const from = path[Math.min(current, path.length - 1)]
  const to = path[Math.min(current + 1, path.length - 1)]

  return {
    x: from.x + (to.x - from.x) * remain,
    y: from.y + (to.y - from.y) * remain,
    z: from.z + (to.z - from.z) * remain,
  }
}

const PATH_UPDATE_MS = 1000 / 20 /* 1 update each minecraft tick */

export async function* path_to_positions(stream, value = stream.next()) {
  const {
    value: { path, start_time, speed },
    done,
  } = await value

  if (done) return

  const next = stream.next()

  while (true) {
    const time = Date.now()

    yield path_position({ path, time, start_time, speed })

    /* End of path, wait for next path */
    if (path_ended({ path, time, start_time, speed })) break

    const next_time = (Math.floor(time / PATH_UPDATE_MS) + 1) * PATH_UPDATE_MS

    const new_path = await Promise.race([
      setTimeoutPromise(next_time - time, false),
      next.then(() => true),
    ])

    if (new_path) break
  }

  yield* path_to_positions(stream, next)
}

export async function* path_to_end(stream, value = stream.next()) {
  const {
    value: { path, start_time, speed },
    done,
  } = await value

  if (done) return

  const next = stream.next()
  const time = Date.now()

  const next_time = start_time + path.length * speed

  const path_end = await Promise.race([
    setTimeoutPromise(next_time - time, true),
    next.then(() => false),
  ])

  if (path_end) yield next_time

  yield* path_to_end(stream, next)
}

export function path_end(mobs) {
  for (const mob of mobs) {
    const state = aiter(on(mob.events, 'state')).map(([state]) => state)

    const end = path_to_end(state)

    aiter(end).reduce((last_time, time) => {
      if (last_time !== time) {
        log.info({ at: time }, 'Path Ended')
        mob.dispatch('path_ended', null, time)
      }
      return time
    })
  }
}
