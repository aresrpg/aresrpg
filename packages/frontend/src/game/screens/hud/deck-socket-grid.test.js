// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The three-row law (#1044). The bar carries the WHOLE spell book now, and at the old fixed 6 columns a
// 20-spell character's tray wrapped into a fourth row of sockets over the board. The rule: at most three
// rows, the tray widens to fit. `rows_used` below is the CSS placement written out as arithmetic — the
// weapon anchor is `grid-row: 1 / span 2` in column 1 (hud.css `.hud-socketgrid .hud-socket.weapon`), so
// rows 1-2 hold `columns - 1` spells each and every row after that holds `columns`.

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'

import { MAX_SOCKET_ROWS, MIN_SOCKET_COLUMNS, SPELL_SLOTS, socket_columns, socket_slots } from './deck-socket-grid.js'

const rows_used = (slots, columns) => {
  const beside_weapon = columns - 1
  if (slots <= beside_weapon) return 1
  if (slots <= 2 * beside_weapon) return 2
  return 2 + Math.ceil((slots - 2 * beside_weapon) / columns)
}

describe('spell-bar socket geometry', () => {
  it('keeps the default book at the measured 5-over-4 bar', () => {
    // the floor case (weapon + 9): 6 columns, two rows — unchanged by the three-row cap
    expect(socket_slots(0)).toBe(SPELL_SLOTS)
    expect(socket_columns(0)).toBe(MIN_SOCKET_COLUMNS)
    expect(socket_columns(SPELL_SLOTS)).toBe(MIN_SOCKET_COLUMNS)
    expect(rows_used(socket_slots(SPELL_SLOTS), socket_columns(SPELL_SLOTS))).toBe(2)
  })

  it('widens instead of wrapping a full spell book past three rows', () => {
    // the reported bug: 20 spells + the weapon socket used to flow 5 / 5 / 6 / 4 at a fixed 6 columns
    expect(rows_used(20, MIN_SOCKET_COLUMNS)).toBe(4)
    expect(socket_columns(20)).toBe(8)
    expect(rows_used(socket_slots(20), socket_columns(20))).toBe(MAX_SOCKET_ROWS)
  })

  it('never exceeds three rows, and never widens further than it must', () => {
    for (let hand = 0; hand <= 64; hand++) {
      const columns = socket_columns(hand)
      const slots = socket_slots(hand)
      expect(rows_used(slots, columns)).toBeLessThanOrEqual(MAX_SOCKET_ROWS)
      // the NARROWEST grid that fits: one column less is either below the floor or a fourth row
      const narrower = columns - 1
      expect(narrower < MIN_SOCKET_COLUMNS || rows_used(slots, narrower) > MAX_SOCKET_ROWS).toBe(true)
    }
  })

  it('every socket the hand holds still gets a slot — the bar hides nothing', () => {
    for (const hand of [0, 9, 10, 20, 33, 64]) expect(socket_slots(hand)).toBeGreaterThanOrEqual(hand)
  })
})

describe('the grid CSS reads the derived column count', () => {
  const hud_css = readFileSync(new URL('./hud.css', import.meta.url), 'utf8')
  const rule = (selector) =>
    hud_css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  it('sizes its columns off --sockcols instead of a hardcoded count', () => {
    const grid = rule('.hud-socketgrid')
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(var\(--sockcols/)
    expect(grid).not.toMatch(/grid-template-columns:\s*repeat\(\d/)
  })

  it('lets the bar anchor absorb the growth so its left edge stays clear of the chat', () => {
    const bar = rule('.hud-spellbar')
    expect(bar).toMatch(new RegExp(`--sockcols:\\s*${MIN_SOCKET_COLUMNS};`))
    expect(bar).toMatch(/left:\s*calc\(50% \+ 140px \+ \(\(var\(--sockcols\) - 6\)/)
  })
})
