import { describe, expect, it } from 'bun:test'

import { adopt_async_resource, flush_live_callbacks } from './async_lifecycle.js'

describe('adopt_async_resource', () => {
  it('publishes a resource while its owner is live', () => {
    const resource = { dispose() {} }
    let adopted = /** @type {typeof resource | null} */ (null)

    expect(
      adopt_async_resource(
        resource,
        () => false,
        (value) => (adopted = value)
      )
    ).toBe(true)
    expect(adopted).toBe(resource)
  })

  it('disposes a resource that resolves after its owner', () => {
    let disposals = 0
    let adopted = false
    const resource = { dispose: () => (disposals += 1) }

    expect(
      adopt_async_resource(
        resource,
        () => true,
        () => (adopted = true)
      )
    ).toBe(false)
    expect(disposals).toBe(1)
    expect(adopted).toBe(false)
  })

  it('stops replay when a callback disposes its owner', () => {
    let disposed = false
    let later_calls = 0
    const completed = flush_live_callbacks([() => (disposed = true), () => (later_calls += 1)], () => disposed)

    expect(completed).toBe(1)
    expect(later_calls).toBe(0)
  })

  it('runs no deferred callbacks for an owner already disposed', () => {
    let calls = 0
    expect(flush_live_callbacks([() => (calls += 1)], () => true)).toBe(0)
    expect(calls).toBe(0)
  })
})
