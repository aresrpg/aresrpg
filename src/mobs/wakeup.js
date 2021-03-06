import { promisify } from 'util'

import { flatten } from '../iterator.js'

const setTimeoutPromise = promisify(setTimeout)

export const wakeup_to_end = flatten(async function* (
  stream,
  value = stream.next()
) {
  const {
    value: { wakeup_at },
    done,
  } = await value

  if (done) return

  const next = stream.next()
  const time = Date.now()

  const path_end = await Promise.race([
    setTimeoutPromise(wakeup_at - time, true),
    next.then(() => false),
  ])

  if (path_end) yield wakeup_at

  return wakeup_to_end(stream, next)
})
