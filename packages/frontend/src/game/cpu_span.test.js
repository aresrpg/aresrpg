import { describe, expect, test } from 'bun:test'

import { instrument_cpu_callback } from './cpu_span.js'

describe('frontend CPU span bridge', () => {
  test('returns the original callback and performs no sampling when the flag is off', () => {
    let now_calls = 0
    let emit_calls = 0
    const callback = (value) => value + 1
    const wrapped = instrument_cpu_callback('scene', callback, {
      search: '',
      now: () => {
        now_calls += 1
        return 0
      },
      emit: () => {
        emit_calls += 1
      },
    })

    expect(wrapped).toBe(callback)
    expect(wrapped(2)).toBe(3)
    expect({ now_calls, emit_calls }).toEqual({ now_calls: 0, emit_calls: 0 })
  })

  test('brackets enabled callbacks without changing their return value', () => {
    const times = [10, 14]
    const spans = []
    const wrapped = instrument_cpu_callback('render', (value) => value * 2, {
      search: '?cpu=1',
      now: () => times.shift(),
      emit: (...span) => spans.push(span),
    })

    expect(wrapped(3)).toBe(6)
    expect(spans).toEqual([['render', 10, 14]])
  })
})
