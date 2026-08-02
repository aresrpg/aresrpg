// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The day-night clock's hack-mode pin (owner ruling, 07-27): disabled cycle, fixed noon-ish daytime, no new
// flag — the SAME `world_presentation` fact every hack surface already gates on. World mode (terrain) must
// stay byte-for-byte the wall-clock cycle. Headless by construction (day_cycle.js has zero engine deps) —
// see its own header comment for why the React-bound DayNightDial.jsx cannot be imported in this suite.
//
// `mock.module` is PROCESS-global in bun and other suites already mock game/store.js (HackRadioPlayer.test.jsx,
// components/marketplace/inventory_panel.test.tsx) — this mirrors the REAL module's FULL export surface
// (useGameState + context) so a partial mock never breaks a later file needing the real one.
import { describe, expect, mock, test } from 'bun:test'

let game_state = /** @type {any} */ ({ world_presentation: 'terrain' })
mock.module('../../../store.js', () => ({
  useGameState: (/** @type {(state: any) => any} */ selector) => selector(game_state),
  context: { get_state: () => game_state },
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
