import { promisify } from 'util'

import { async_tail_recursive } from '../iterator.js'

const setTimeoutPromise = promisify(setTimeout)

async function* raw_wakeup_to_end(stream, value = stream.next()) {
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

  return [raw_wakeup_to_end, stream, next]
}

export const wakeup_to_end = async_tail_recursive(raw_wakeup_to_end)
