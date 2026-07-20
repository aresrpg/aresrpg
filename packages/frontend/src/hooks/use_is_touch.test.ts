// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// USE_IS_TOUCH — the capability hook's pure core, proven against a device matrix and CONTRASTED with
// `use_is_mobile`'s width query (the §3.1 ruling: touch-capability ≠ viewport-width). bun:test has no
// DOM, so we drive `detect_touch` with fake windows and exercise `subscribe`'s reactive plumbing via a
// swapped-in global `window`. The iPad-landscape case (coarse pointer, desktop width) is asserted
// explicitly as `is_touch && !is_mobile`.

import { afterEach, describe, expect, it } from 'bun:test'

import { detect_touch, subscribe } from './use_is_touch'

// `use_is_mobile.ts:3` — replicated here to assert the CONTRAST (it exports no predicate; we must not
// modify it). A fake window answers BOTH query families so one object models a whole device.
const MOBILE_QUERY = '(max-width: 1023px)'

function make_win({ coarse, touch_points, width }: { coarse: boolean; touch_points: number; width: number }) {
  return {
    matchMedia: (q: string) => ({
      matches: q.includes('pointer') ? coarse : q.includes('max-width') ? width <= 1023 : false,
    }),
    navigator: { maxTouchPoints: touch_points },
  }
}

// The is_mobile predicate exactly as use_is_mobile.ts computes it — for the contrast assertions.
const is_mobile = (win: ReturnType<typeof make_win>) => win.matchMedia(MOBILE_QUERY).matches

describe('detect_touch — capability matrix vs use_is_mobile width matrix', () => {
  const matrix = [
    // device                 coarse touchpts width   is_touch is_mobile
    ['phone portrait', true, 5, 390, true, true],
    ['iphone landscape', true, 5, 844, true, true],
    ['ipad landscape', true, 5, 1194, true, false], // ← the §3.1 ruling case
    ['ipad-as-mac (fine primary, touch belt)', false, 5, 1194, true, false], // maxTouchPoints belt catches it
    ['touchscreen laptop (any-pointer coarse)', true, 10, 1440, true, false],
    ['narrow desktop window', false, 0, 800, false, true], // is_mobile && !is_touch
    ['wide desktop', false, 0, 1920, false, false],
  ] as const

  for (const [name, coarse, touch_points, width, exp_touch, exp_mobile] of matrix) {
    it(`${name}: touch=${exp_touch} mobile=${exp_mobile}`, () => {
      const win = make_win({ coarse, touch_points, width })
      expect(detect_touch(win)).toBe(exp_touch)
      expect(is_mobile(win)).toBe(exp_mobile)
    })
  }

  it('iPad landscape is the divergence case: is_touch && !is_mobile', () => {
    const ipad = make_win({ coarse: true, touch_points: 5, width: 1194 })
    expect(detect_touch(ipad)).toBe(true)
    expect(is_mobile(ipad)).toBe(false)
  })

  it('narrow desktop is the inverse: is_mobile && !is_touch', () => {
    const win = make_win({ coarse: false, touch_points: 0, width: 800 })
    expect(detect_touch(win)).toBe(false)
    expect(is_mobile(win)).toBe(true)
  })
})

describe('detect_touch — signal fallbacks', () => {
  it('undefined window → false (SSR-safe)', () => {
    expect(detect_touch(undefined)).toBe(false)
  })

  it('no matchMedia, no touch points → false', () => {
    expect(detect_touch({ navigator: { maxTouchPoints: 0 } })).toBe(false)
    expect(detect_touch({})).toBe(false)
  })

  it('maxTouchPoints belt alone (matchMedia absent) → true', () => {
    expect(detect_touch({ navigator: { maxTouchPoints: 2 } })).toBe(true)
  })

  it('coarse media query alone (maxTouchPoints absent) → true', () => {
    expect(detect_touch({ matchMedia: () => ({ matches: true }) })).toBe(true)
  })
})

describe('subscribe — reactive plumbing', () => {
  const orig = (globalThis as any).window
  afterEach(() => {
    ;(globalThis as any).window = orig
  })

  it('wires a change listener and its cleanup removes it', () => {
    const events: string[] = []
    let listener: (() => void) | null = null
    ;(globalThis as any).window = {
      matchMedia: () => ({
        matches: false,
        addEventListener: (type: string, fn: () => void) => {
          events.push(`add:${type}`)
          listener = fn
        },
        removeEventListener: (type: string) => events.push(`remove:${type}`),
      }),
    }

    const cb = () => {}
    const cleanup = subscribe(cb)
    expect(events).toEqual(['add:change'])
    expect(listener).toBe(cb as any) // the exact callback is wired

    cleanup()
    expect(events).toEqual(['add:change', 'remove:change'])
  })

  it('no window / no matchMedia → no-op cleanup, never throws', () => {
    ;(globalThis as any).window = undefined
    const cleanup = subscribe(() => {})
    expect(() => cleanup()).not.toThrow()
  })
})
