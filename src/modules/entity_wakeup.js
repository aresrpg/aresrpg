import { on } from 'events'
import { setTimeout } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { async_tail_recursive, abortable } from '../core/iterator.js'

async function* raw_wakeup_to_end(stream, value = stream.next()) {
  const { value: { wakeup_at } = { wakeup_at: null }, done } = await value

  if (done) return

  const next = stream.next()
  const time = Date.now()

  const path_end = await Promise.race([
    setTimeout(wakeup_at - time, true, { ref: false }),
    next.then(() => false),
  ])

  if (path_end) yield wakeup_at

  return {
    next_stream: raw_wakeup_to_end,
    parameters: [stream, next],
  }
}

const wakeup_to_end = async_tail_recursive(raw_wakeup_to_end)

/** @type {import('../server').Module} */
export default {
  observe({ events }) {
    events.on('ENTITY_ENTER_VIEW', ({ mob, signal }) => {
      const time = Date.now()

      if (mob.get_state().wakeup_at <= time) mob.dispatch('WAKE_UP', null, time)

      const state = aiter(
        abortable(on(mob.events, 'STATE_UPDATED', { signal })),
      ).map(([state]) => state)

      const wakeups = wakeup_to_end(state)

      aiter(wakeups).reduce((last_time, time) => {
        if (last_time !== time) {
          mob.dispatch('WAKE_UP', null, time)
        }
        return time
      }, null)
    })
  },
}
