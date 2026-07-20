import { beforeEach, describe, expect, it } from 'bun:test'

import { read_movement, reset as reset_touch, set_move } from './touch_input.js'
import { create_touch_stick_gesture } from './touch_stick_gesture.js'

const zone_rect = { left: 0, top: 400, width: 300, height: 300 }

const make_node = (matched_selector = null) => ({
  matches(selector) {
    return matched_selector === null ? false : selector.includes(matched_selector)
  },
})

const pointer_event = ({ path = [], ...overrides } = {}) => ({
  pointerId: 7,
  pointerType: 'touch',
  clientX: 120,
  clientY: 600,
  currentTarget: {
    setPointerCapture() {},
    releasePointerCapture() {},
  },
  composedPath: () => path,
  preventDefault() {},
  ...overrides,
})

const make_fixture = () => {
  const vectors = []
  const visuals = []
  const gesture = create_touch_stick_gesture({
    on_vector(vector) {
      vectors.push(vector)
      set_move(vector.forward, vector.strafe)
    },
    on_visual(visual) {
      visuals.push(visual)
    },
  })
  return { gesture, vectors, visuals }
}

beforeEach(() => reset_touch())

describe('dynamic joystick pointer fixture', () => {
  it('turns an edge push into a full forward vector and resets on release', () => {
    const { gesture, vectors, visuals } = make_fixture()
    const down = pointer_event()

    expect(gesture.pointer_down(down, zone_rect)).toBe(true)
    expect(gesture.pointer_move(pointer_event({ clientX: 120, clientY: 480 }), zone_rect)).toBe(true)
    expect(vectors.at(-1).forward).toBeCloseTo(1, 6)
    expect(vectors.at(-1).magnitude).toBe(1)
    expect(read_movement().forward).toBeCloseTo(1, 6)
    expect(read_movement().strafe).toBeCloseTo(0, 6)
    expect(read_movement().jump).toBe(false)

    expect(gesture.pointer_up(pointer_event())).toBe(true)
    expect(read_movement()).toEqual({ forward: 0, strafe: 0, jump: false })
    expect(visuals.at(-1)).toBeNull()
  })

  it.each([
    ['button', make_node('button')],
    ['panel', make_node('[role="dialog"]')],
  ])('emits zero intents when a %s owns the touch', (_label, ui_node) => {
    const { gesture, vectors, visuals } = make_fixture()
    const down = pointer_event({ path: [ui_node, make_node()] })

    expect(gesture.pointer_down(down, zone_rect)).toBe(false)
    expect(gesture.pointer_move(pointer_event({ clientX: 120, clientY: 480 }), zone_rect)).toBe(false)
    expect(vectors).toEqual([])
    expect(visuals).toEqual([])
    expect(read_movement()).toEqual({ forward: 0, strafe: 0, jump: false })
  })

  it('ignores mouse pointers so desktop input remains the sole owner', () => {
    const { gesture, vectors } = make_fixture()

    expect(gesture.pointer_down(pointer_event({ pointerType: 'mouse' }), zone_rect)).toBe(false)
    expect(vectors).toEqual([])
  })
})
