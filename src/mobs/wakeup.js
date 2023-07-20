import { on } from 'events'
import { setTimeout } from 'timers/promises'

import { aiter } from 'iterator-helper'

import { MobEvent, PlayerEvent } from '../events.js'
import { async_tail_recursive, abortable } from '../iterator.js'

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

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events }) {
    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      const time = Date.now()

      if (mob.get_state().wakeup_at <= time)
        mob.dispatch(MobEvent.WAKE_UP, null, time)

      const state = aiter(
        abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal })),
      ).map(([state]) => state)

      const wakeups = wakeup_to_end(state)

      aiter(wakeups).reduce((last_time, time) => {
        if (last_time !== time) {
          mob.dispatch(MobEvent.WAKE_UP, null, time)
        }
        return time
      }, null)
    })
  },
}
