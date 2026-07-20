import { describe, expect, it, mock } from 'bun:test'

import { create_travel_recovery, is_travel_too_far } from './travel_recovery.js'

const TOO_FAR = { module: 'checkpoint', code: 102 }

function harness() {
  let next_id = 40
  const added = []
  const removed = []
  const failures = []
  const recovery = create_travel_recovery({
    parse_abort: (error) => error,
    translate: (key) => `t:${key}`,
    add_persistent: (message, type, action) => {
      const id = next_id++
      added.push({ id, message, type, action })
      return id
    },
    remove: (id) => removed.push(id),
    on_failure: (error) => failures.push(error),
  })
  return { recovery, added, removed, failures }
}

describe('travel recovery — checkpoint::102 one-click resync', () => {
  it('classifies only the exact checkpoint abort', () => {
    expect(is_travel_too_far(TOO_FAR, (error) => error)).toBe(true)
    expect(is_travel_too_far({ module: 'checkpoint', code: 101 }, (error) => error)).toBe(false)
    expect(is_travel_too_far({ module: 'fight', code: 102 }, (error) => error)).toBe(false)
  })

  it('offers a persistent localized action and ignores every unrelated tx failure', () => {
    const h = harness()
    expect(h.recovery.offer({ module: 'fight', code: 102 })).toBe(false)
    expect(h.added).toHaveLength(0)

    expect(h.recovery.offer(TOO_FAR)).toBe(true)
    expect(h.added).toHaveLength(1)
    expect(h.added[0]).toMatchObject({
      id: 40,
      message: 't:errors.travel_too_far',
      type: 'error',
    })
    expect(h.added[0].action.label).toBe('t:errors.travel_resync_action')
  })

  it('click re-runs the registered checkpoint resolver/body move once, then removes that exact toast', async () => {
    const h = harness()
    let release
    const moved = mock(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    h.recovery.register(moved)
    h.recovery.offer(TOO_FAR)

    const first = h.added[0].action.onClick()
    const second = h.added[0].action.onClick()
    expect(first).toBe(second) // double-click shares the one in-flight read/teleport
    await Promise.resolve() // the recovery deliberately enters the registered target through a guarded microtask
    expect(moved).toHaveBeenCalledTimes(1)
    release(true)

    await expect(first).resolves.toBe(true)
    expect(h.removed).toEqual([40])
  })

  it('a failed resync stays actionable and is reported without retrying itself', async () => {
    const h = harness()
    const error = new Error('checkpoint read unavailable')
    const moved = mock(() => Promise.reject(error))
    h.recovery.register(moved)
    h.recovery.offer(TOO_FAR)

    await expect(h.added[0].action.onClick()).resolves.toBe(false)
    expect(moved).toHaveBeenCalledTimes(1)
    expect(h.removed).toEqual([])
    expect(h.failures).toEqual([error])
  })

  it('a repeated abort replaces the prior action toast instead of stacking duplicates', () => {
    const h = harness()
    h.recovery.offer(TOO_FAR)
    h.recovery.offer(TOO_FAR)

    expect(h.added.map((toast) => toast.id)).toEqual([40, 41])
    expect(h.removed).toEqual([40])
  })
})
