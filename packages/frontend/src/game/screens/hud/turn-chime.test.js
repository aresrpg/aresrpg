// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// is_turn_start unit tests — the your-turn ding must fire EXACTLY on the rising edge: never for an opponent's
// turn, never twice for the same held turn (TurnBanner's 4/s-adjacent re-renders must not double-voice it).

import { describe, expect, it } from 'bun:test'

import { is_turn_start } from './turn-chime.js'

describe('is_turn_start — your-turn chime rising edge', () => {
  it('fires on the rising edge (opponent turn just ended, mine just started)', () => {
    expect(is_turn_start(false, true)).toBe(true)
  })

  it('never fires for an opponent turn (my_turn stays false)', () => {
    expect(is_turn_start(false, false)).toBe(false)
  })

  it('never re-fires on a re-poll of the SAME held turn (my_turn stays true)', () => {
    expect(is_turn_start(true, true)).toBe(false)
  })

  it('never fires on the falling edge (my turn just ended)', () => {
    expect(is_turn_start(true, false)).toBe(false)
  })
})
