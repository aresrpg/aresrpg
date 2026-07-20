import { describe, expect, it } from 'bun:test'

import { merge_movement_intent, TOUCH_RUN_MAGNITUDE } from './movement_intent.js'

const idle_keys = () => ({ forward: 0, strafe: 0, jump: false, walk: false })

describe('merge_movement_intent', () => {
  it('maps a full joystick push to the same run intent as the keyboard path', () => {
    const joystick = merge_movement_intent(idle_keys(), { forward: 1, strafe: 0, jump: false }, true)
    const keyboard_w = { forward: 1, strafe: 0, jump: false, walk: false }

    expect(joystick).toEqual(keyboard_w)
  })

  it('uses the existing walk bit below the run threshold and clears it at the edge', () => {
    const walking = merge_movement_intent(
      idle_keys(),
      { forward: TOUCH_RUN_MAGNITUDE - 0.01, strafe: 0, jump: false },
      true
    )
    const running = merge_movement_intent({ ...idle_keys(), walk: true }, { forward: 1, strafe: 0, jump: false }, true)

    expect(walking.walk).toBe(true)
    expect(running.walk).toBe(false)
  })

  it('merges touch jump into the same held bit and preserves a stronger keyboard axis', () => {
    expect(
      merge_movement_intent(
        { forward: -1, strafe: 0, jump: false, walk: false },
        { forward: 0.5, strafe: 0.8, jump: true },
        true
      )
    ).toEqual({ forward: -1, strafe: 0.8, jump: true, walk: false })
  })

  it('returns exact keyboard values when mobile mode is false without reading touch input', () => {
    const keys = { forward: 0.625, strafe: -0.25, jump: true, walk: true }
    const unreadable_touch = {}
    Object.defineProperty(unreadable_touch, 'forward', {
      get() {
        throw new Error('desktop path read touch input')
      },
    })

    expect(merge_movement_intent(keys, unreadable_touch, false)).toEqual(keys)
  })
})
