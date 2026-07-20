// One renderer-neutral fight presentation queue. Producers build every render closure before enqueueing a
// complete source-turn batch; this module only owns timing, cancellation, and strict serial playback.

const default_sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const is_timing = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0

const snapshot_events = (events) => {
  if (!Array.isArray(events)) throw new TypeError('fight render turn events must be an array')
  return events.map((event, index) => {
    if (!event || typeof event !== 'object') {
      throw new TypeError(`fight render event ${index} must be an object`)
    }
    if (typeof event.kind !== 'string' || event.kind.length === 0) {
      throw new TypeError(`fight render event ${index} kind must be a non-empty string`)
    }
    if (!is_timing(event.at)) {
      throw new TypeError(`fight render event ${index} at must be a finite nonnegative number`)
    }
    if (!is_timing(event.duration)) {
      throw new TypeError(`fight render event ${index} duration must be a finite nonnegative number`)
    }
    if (typeof event.render !== 'function') {
      throw new TypeError(`fight render event ${index} render must be a function`)
    }
    // Copy every field the runner uses. Mutating a producer's event object after enqueue cannot change playback.
    return {
      kind: event.kind,
      at: event.at,
      duration: event.duration,
      render: event.render,
      state: 'queued',
      counted: false,
      cancel_wait: null,
    }
  })
}

/**
 * Create the fight presentation's single generic render queue. Timing values are milliseconds. An event's `at`
 * is relative to the instant its source turn reaches the queue head; `duration` is a floor measured from when
 * `render()` starts. Events retain producer order even when their `at` values are equal or out of order.
 *
 * @param {{
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   on_change?: (size: number) => void,
 * }} [options]
 * @returns {{
 *   enqueue_turn: (turn: {source_turn: unknown, events: Array<{
 *     kind: string, at: number, duration: number, render: () => (void|Promise<void>)
 *   }>}) => Promise<void>,
 *   size: () => number,
 *   clear: () => void,
 *   idle: () => Promise<void>,
 * }}
 */
export function create_fight_render_queue({
  sleep = default_sleep,
  now = () => Date.now(),
  on_change = () => {},
} = {}) {
  if (typeof sleep !== 'function') throw new TypeError('fight render queue sleep must be a function')
  if (typeof now !== 'function') throw new TypeError('fight render queue now must be a function')
  if (typeof on_change !== 'function') throw new TypeError('fight render queue on_change must be a function')

  let tail = Promise.resolve()
  let outstanding = 0
  const live_slots = new Set()
  const idle_waiters = new Set()

  const announce = () => {
    // Presentation observers must not be able to wedge a queue whose renders were already accepted.
    try {
      on_change(outstanding)
    } catch {
      // Observation is best-effort; enqueue/idle remain authoritative.
    }
    if (outstanding !== 0) return
    for (const resolve of idle_waiters) resolve()
    idle_waiters.clear()
  }

  const settle_slot = (slot, should_announce = true) => {
    if (!slot.counted) return
    slot.counted = false
    if (slot.state !== 'cancelled') slot.state = 'settled'
    live_slots.delete(slot)
    outstanding--
    if (should_announce) announce()
  }

  const cancel_slot = (slot, should_announce = true) => {
    if (slot.state === 'running' || slot.state === 'settled' || slot.state === 'cancelled') return false
    slot.state = 'cancelled'
    const wake = slot.cancel_wait
    settle_slot(slot, should_announce)
    if (wake) wake()
    return true
  }

  const wait_until_due = async (slot, wait_ms) => {
    let cancel_wait
    const cancelled = new Promise((resolve) => {
      cancel_wait = () => resolve(false)
    })
    slot.cancel_wait = cancel_wait
    const due = (async () => {
      await sleep(wait_ms)
      return true
    })()
    try {
      return await Promise.race([due, cancelled])
    } finally {
      if (slot.cancel_wait === cancel_wait) slot.cancel_wait = null
    }
  }

  const run_event = async (slot, turn_started_at) => {
    if (slot.state === 'cancelled') return
    slot.state = 'waiting'
    try {
      const wait_ms = turn_started_at + slot.at - now()
      if (wait_ms > 0 && !(await wait_until_due(slot, wait_ms))) return
      if (slot.state === 'cancelled') return

      slot.state = 'running'
      const event_started_at = now()
      let render_error
      try {
        await slot.render()
      } catch (error) {
        render_error = error
      }

      const elapsed = Math.max(0, now() - event_started_at)
      if (elapsed < slot.duration) await sleep(slot.duration - elapsed)
      if (render_error) throw render_error
    } finally {
      settle_slot(slot)
    }
  }

  const run_turn = async (turn) => {
    const turn_started_at = now()
    let first_error
    for (const slot of turn.events) {
      try {
        await run_event(slot, turn_started_at)
      } catch (error) {
        if (!first_error) first_error = error
      }
    }
    if (first_error) throw first_error
  }

  return {
    enqueue_turn({ source_turn, events }) {
      // Validate and snapshot the entire turn before touching the live queue: an invalid later event can never
      // leave an earlier render partially enqueued.
      const turn = { source_turn, events: snapshot_events(events) }
      for (const slot of turn.events) {
        slot.counted = true
        live_slots.add(slot)
      }
      outstanding += turn.events.length

      const completed = tail.then(() => run_turn(turn))
      // A failed renderer rejects its own turn promise, but cannot prevent the next source turn from playing.
      tail = completed.catch(() => {})
      if (turn.events.length > 0) announce()
      return completed
    },
    size() {
      return outstanding
    },
    clear() {
      let changed = false
      for (const slot of [...live_slots]) {
        if (cancel_slot(slot, false)) changed = true
      }
      if (changed) announce()
    },
    idle() {
      if (outstanding === 0) return Promise.resolve()
      return new Promise((resolve) => idle_waiters.add(resolve))
    },
  }
}
