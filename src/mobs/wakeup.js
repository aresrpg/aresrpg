import { promisify } from 'util'
import { on } from 'events'

import { aiter } from 'iterator-helper'

import { async_tail_recursive, abortable } from '../iterator.js'

const setTimeoutPromise = promisify(setTimeout)

async function* raw_wakeup_to_end(stream, value = stream.next()) {
  const { value: { wakeup_at } = { wakeup_at: null }, done } = await value

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

const wakeup_to_end = async_tail_recursive(raw_wakeup_to_end)

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events }) {
    events.on('mob_spawned', ({ mob, signal }) => {
      const time = Date.now()

      if (mob.get_state().wakeup_at <= time) mob.dispatch('wakeup', null, time)

      const state = aiter(abortable(on(mob.events, 'state', { signal }))).map(
        ([state]) => state
      )

      const wakeups = wakeup_to_end(state)

      aiter(wakeups).reduce((last_time, time) => {
        if (last_time !== time) {
          mob.dispatch('wakeup', null, time)
        }
        return time
      }, null)
    })
  },
}
