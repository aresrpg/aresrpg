// AUTO-RUN steerer — proves the pure math (direction / arrive / stuck / payload normalise) and the factory
// state machine (steer → arrive → fire the same [R]/[G] prompt; manual cancel; stuck → honest toast). No DOM,
// no live prompt stack: the effects (trigger_interact / notify_blocked / clock) are injected as stubs so the
// steering brain is tested in isolation from the controller physics it drives.
import { describe, expect, test } from 'bun:test'

import { create_auto_run, is_arrived, is_stuck, normalize_target, steer_to } from './auto_run.js'

describe('steer_to — forward axis points at the target', () => {
  test('yaw makes move_direction(forward=1) aim straight at the target', () => {
    // move_direction sends forward=1 along (-sin yaw, -cos yaw); it must equal the unit dir to the target.
    for (const [tx, tz] of [
      [30, 0],
      [0, 30],
      [-12, 17],
      [-8, -8],
    ]) {
      const { yaw, dist } = steer_to(0, 0, tx, tz)
      expect(dist).toBeCloseTo(Math.hypot(tx, tz), 6)
      expect(-Math.sin(yaw)).toBeCloseTo(tx / dist, 6)
      expect(-Math.cos(yaw)).toBeCloseTo(tz / dist, 6)
    }
  })

  test('distance is measured from the live origin', () => {
    expect(steer_to(10, 10, 13, 14).dist).toBeCloseTo(5, 6) // 3-4-5
  })
})

describe('is_arrived — inside the interact radius', () => {
  test('true within, false beyond (default 2.5)', () => {
    expect(is_arrived(2.4)).toBe(true)
    expect(is_arrived(2.5)).toBe(true)
    expect(is_arrived(2.6)).toBe(false)
    expect(is_arrived(6, 6)).toBe(true) // explicit radius honoured
  })
})

describe('is_stuck — no net progress across the window', () => {
  const win = 3000
  test('false without a full window of history', () => {
    expect(is_stuck([{ t: 0, x: 0, z: 0 }], 1000)).toBe(false)
    expect(is_stuck([], 9999)).toBe(false)
  })
  test('true when a window-old sample is barely displaced', () => {
    const s = [
      { t: 0, x: 0, z: 0 },
      { t: 1500, x: 0.5, z: 0.2 },
      { t: 3200, x: 0.9, z: 0.4 }, // ~1m from the t=0 ref over >3s
    ]
    expect(is_stuck(s, 3200, win, 2)).toBe(true)
  })
  test('false when the beeline is making headway', () => {
    const s = [
      { t: 0, x: 0, z: 0 },
      { t: 1500, x: 16, z: 0 },
      { t: 3200, x: 33, z: 0 }, // ~33m from the ref — running fine
    ]
    expect(is_stuck(s, 3200, win, 2)).toBe(false)
  })
})

describe('normalize_target — flexible marker payloads', () => {
  test('accepts {x,z}, {x,y,z}, {x,y}, [x,z], [x,y,z]', () => {
    expect(normalize_target({ type: 'mob', id: 'g1', position: { x: 5, z: 9 } })).toEqual({ type: 'mob', id: 'g1', x: 5, z: 9 })
    expect(normalize_target({ type: 'resource', position: { x: 5, y: 3, z: 9 } })).toMatchObject({ x: 5, z: 9 })
    expect(normalize_target({ type: 'mob', position: { x: 5, y: 9 } })).toMatchObject({ x: 5, z: 9 }) // map: y = world Z
    expect(normalize_target({ type: 'resource', position: [5, 9] })).toMatchObject({ x: 5, z: 9 })
    expect(normalize_target({ type: 'mob', position: [5, 3, 9] })).toMatchObject({ x: 5, z: 9 })
  })
  test('rejects bad type / bad position', () => {
    expect(normalize_target(null)).toBeNull()
    expect(normalize_target({ type: 'npc', position: { x: 1, z: 2 } })).toBeNull()
    expect(normalize_target({ type: 'mob', position: { x: NaN, z: 2 } })).toBeNull()
    expect(normalize_target({ type: 'mob' })).toBeNull()
  })
})

/** A driveable steerer with injected effects + a controllable clock/position. */
function harness() {
  const state = { pos: [0, 1, 0], clock: 0, triggered: [], blocked: 0, armed: false }
  const ar = create_auto_run({
    get_pos: () => state.pos,
    trigger_interact: (type) => {
      state.triggered.push(type)
      return state.armed
    },
    notify_blocked: () => {
      state.blocked += 1
    },
    now: () => state.clock,
  })
  return { ar, state }
}

describe('create_auto_run — steer → arrive → interact', () => {
  test('runs toward the marker, plants on arrival, then fires the matching prompt', () => {
    const { ar, state } = harness()
    ar.start({ type: 'resource', id: 'node1', position: { x: 30, z: 0 } })
    expect(ar.active()).toBe(true)

    // far away → steer forward, aiming +x at the target
    let s = ar.update(1 / 60)
    expect(s.forward).toBe(1)
    expect(-Math.sin(s.yaw)).toBeCloseTo(1, 6)

    // step into arrival range → plant (forward 0), no trigger on the transition frame
    state.pos = [28.5, 1, 0] // dist 1.5 < 2.5
    state.clock += 16
    s = ar.update(1 / 60)
    expect(s.forward).toBe(0)
    expect(state.triggered.length).toBe(0)

    // prompt not armed yet → keeps trying, still active
    state.clock += 16
    s = ar.update(1 / 60)
    expect(state.triggered.at(-1)).toBe('resource')
    expect(ar.active()).toBe(true)

    // prompt arms → the next tick fires it and finishes
    state.armed = true
    state.clock += 16
    s = ar.update(1 / 60)
    expect(s).toBeNull()
    expect(ar.active()).toBe(false)
    expect(state.triggered.at(-1)).toBe('resource')
    expect(state.blocked).toBe(0)
  })

  test('mob marker fires the attack prompt', () => {
    const { ar, state } = harness()
    state.pos = [1, 1, 0]
    state.armed = true
    ar.start({ type: 'mob', id: 'grp', position: { x: 2, z: 0 } }) // already in range
    ar.update(1 / 60) // arrive-plant
    state.clock += 16
    const s = ar.update(1 / 60) // fire
    expect(s).toBeNull()
    expect(state.triggered).toContain('mob')
  })

  test('arrived but nothing arms in time → one honest toast, then stops', () => {
    const { ar, state } = harness()
    state.pos = [0, 1, 0]
    ar.start({ type: 'resource', position: { x: 1, z: 0 } }) // in range immediately
    ar.update(1 / 60) // plant
    for (let i = 0; i < 400 && ar.active(); i += 1) {
      state.clock += 16
      ar.update(1 / 60)
    }
    expect(ar.active()).toBe(false)
    expect(state.blocked).toBe(1)
  })
})

describe('create_auto_run — cancel + stuck', () => {
  test('cancel() stops driving instantly', () => {
    const { ar } = harness()
    ar.start({ type: 'resource', position: { x: 10, z: 0 } })
    expect(ar.active()).toBe(true)
    ar.cancel()
    expect(ar.active()).toBe(false)
    expect(ar.update(1 / 60)).toBeNull()
  })

  test('no net progress over the window → blocked toast + cancel', () => {
    const { ar, state } = harness()
    ar.start({ type: 'mob', position: { x: 100, z: 0 } }) // far, but the body never moves (walled)
    for (let i = 0; i < 260 && ar.active(); i += 1) {
      state.clock += 16 // ~4.1s of frames, position pinned at origin
      ar.update(1 / 60)
    }
    expect(ar.active()).toBe(false)
    expect(state.blocked).toBe(1)
  })

  test('start() retargets an in-flight run', () => {
    const { ar } = harness()
    ar.start({ type: 'resource', position: { x: 10, z: 0 } })
    ar.start({ type: 'mob', position: { x: -20, z: 5 } })
    expect(ar.target()).toMatchObject({ type: 'mob', x: -20, z: 5 })
  })
})
