// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The day-night clock's hack-mode pin (owner ruling, 07-27): disabled cycle, fixed noon-ish daytime, no new
// flag — the SAME `world_presentation` fact every hack surface already gates on. World mode (terrain) must
// stay byte-for-byte the wall-clock cycle. Headless by construction (day_cycle.js has zero engine deps) —
// see its own header comment for why the React-bound DayNightDial.jsx cannot be imported in this suite.
//
// `mock.module` is PROCESS-global in bun and has NO unmock, so a replacement outlives this file for the whole
// run. The claim that listing `useGameState + context` "mirrors the FULL export surface" was false — store.js
// also exports useFightView/useFightVisible*/useFight, and their absence made the module unloadable for every
// later file (the #1993 board suite died on a missing `useFightVisibleMount`). Two rules keep a process-global
// replacement honest: SPREAD the real module so no export can ever go missing, and override ONLY what this file
// actually consumes — day_cycle.js reads `context.get_state()` and nothing else, so `useGameState` stays REAL
// and a later suite still gets the true hook.
import { afterAll, describe, expect, mock, test } from 'bun:test'

let game_state = /** @type {any} */ ({ world_presentation: 'terrain' })
// SNAPSHOT, not a live namespace: `mock.module` mutates the module record IN PLACE, so reading `real_store.x`
// after registering the replacement reads the REPLACEMENT (a delegating override that resolves its target
// lazily calls itself forever). Everything the passthrough needs is captured here, before the mock exists.
const real_exports = { ...(await import('../../../store.js')) }
const real_get_state = real_exports.context.get_state.bind(real_exports.context)
// `owned` is the lifetime of the replacement's LIE. While this file's tests run, `context` reports the fixture;
// once they are done it delegates to the real singleton, so the permanent registry entry becomes a transparent
// passthrough instead of a fixture every later file inherits (`useGameState` reads `context` too — overriding
// one overrides both).
let owned = true
afterAll(() => {
  owned = false
})
mock.module('../../../store.js', () => ({
  ...real_exports,
  context: { ...real_exports.context, get_state: () => (owned ? game_state : real_get_state()) },
}))

const { day_cycle_tod, game_clock, phase_key, DAY_FRAC, HACK_MODE_TOD } = await import('./day_cycle.js')

describe('the day-night clock', () => {
  test('world mode is untouched — the wall clock still drives the phase, in range and stable within a tick', () => {
    game_state = { world_presentation: 'terrain' }
    const tod = day_cycle_tod()
    expect(tod).toBeGreaterThanOrEqual(0)
    expect(tod).toBeLessThan(1)
    expect(day_cycle_tod()).toBeCloseTo(tod, 5) // deterministic within the same tick — not the pin
  })

  test('the same wall-clock read holds off the grid whatever the presentation string, only "hackgrid" pins it', () => {
    game_state = { world_presentation: undefined }
    const undef_tod = day_cycle_tod()
    game_state = { world_presentation: 'terrain' }
    expect(day_cycle_tod()).toBeCloseTo(undef_tod, 5)
  })

  test('hack mode disables the cycle and pins it at a fixed noon-ish daytime', () => {
    game_state = { world_presentation: 'hackgrid' }
    expect(day_cycle_tod()).toBe(HACK_MODE_TOD)
    expect(day_cycle_tod()).toBe(day_cycle_tod()) // pinned, not advancing — two reads are identical, not just close
    expect(game_clock(day_cycle_tod())).toBe('12:00')
    expect(phase_key(day_cycle_tod())).toBe('day')
  })

  test('the pin is the exact midpoint of the day span — genuinely noon, not a magic number', () => {
    expect(HACK_MODE_TOD).toBe(DAY_FRAC / 2)
  })

  test('leaving hack mode falls straight back to the wall clock — never a lingering pin', () => {
    game_state = { world_presentation: 'hackgrid' }
    expect(day_cycle_tod()).toBe(HACK_MODE_TOD)
    game_state = { world_presentation: 'terrain' }
    expect(day_cycle_tod()).not.toBe(HACK_MODE_TOD)
  })
})
