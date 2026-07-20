import { describe, expect, test } from 'bun:test'

import { latching_single_flight } from './single_flight.js'

// Regression tests for the character-create double-submit / double-sponsor guard (money-class bug).
describe('latching_single_flight', () => {
  test('double-fire while in flight runs the action exactly ONCE', async () => {
    const flight = latching_single_flight()
    let calls = 0
    let release
    const gate = new Promise((r) => {
      release = r
    })
    const action = async () => {
      calls += 1
      await gate // stay in flight
    }
    // fire twice in the same tick (double-click / Enter+click race)
    const p1 = flight.run(action)
    const p2 = flight.run(action)
    expect(flight.busy).toBe(true)
    release()
    await Promise.all([p1, p2])
    expect(calls).toBe(1) // second call was a no-op
  })

  test('SUCCESS latches — a later run() never fires again (no second sponsor)', async () => {
    const flight = latching_single_flight()
    let calls = 0
    await flight.run(async () => {
      calls += 1
    })
    expect(flight.busy).toBe(true) // latched, NOT re-enabled on success
    await flight.run(async () => {
      calls += 1
    })
    expect(calls).toBe(1) // repeat click after success is a no-op
  })

  test('FAILURE re-arms — the user can retry, and it can then succeed once', async () => {
    const flight = latching_single_flight()
    let calls = 0
    await expect(
      flight.run(async () => {
        calls += 1
        throw new Error('tx aborted')
      })
    ).rejects.toThrow('tx aborted')
    expect(flight.busy).toBe(false) // re-armed after failure
    await flight.run(async () => {
      calls += 1
    })
    expect(calls).toBe(2) // retry ran
    expect(flight.busy).toBe(true) // then latched on the successful retry
  })
})
