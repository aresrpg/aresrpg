// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1659 — A TACKLED SEAT STILL SEES ITS WHOLE MP RANGE, GREYED. Owner ruling 2026-07-29, live: "when tackled,
// the player still sees their ENTIRE MP range — cells render grey instead of green (unreachable-because-tackled),
// not removed." The range is INFORMATION; the tackle is a STATE on it.
//
// The band uses `unavailable`: the neutral grammar shared by visible information the player cannot act on
// (the tackle-lost movement band and occupied placement cells). The per-hover "you hovered past your MP" red
// suffix that used to share the old path_blocked name is dead, so the earlier red-dominant rulings (msg 3254,
// #1195) described a semantic this channel no longer carries, and the 07-29 ruling governs it.

import { describe, expect, test } from 'bun:test'

import { CHANNELS } from '../../src/tactical/board_highlight_style.js'

const chan = (color) => ({
  r: (color >> 16) & 0xff,
  g: (color >> 8) & 0xff,
  b: color & 0xff,
})

describe('#1659 — the tackle band is GREY, and it is a band (never a hidden range)', () => {
  test('the tackle-lost channel is neutral grey — no dominant hue', () => {
    const { r, g, b } = chan(CHANNELS.unavailable.color)
    const spread = Math.max(r, g, b) - Math.min(r, g, b)
    // Grey = the three channels sit on top of each other. A generous 24/255 tolerance leaves room for the
    // house's cool cast without ever reading as a coloured wash.
    expect(spread, 'channel spread must read as grey').toBeLessThanOrEqual(24)
    // …and it is a MID grey: dark enough to sit under the green, light enough to be visibly present.
    expect(Math.min(r, g, b)).toBeGreaterThan(0x60)
    expect(Math.max(r, g, b)).toBeLessThan(0xc0)
  })

  test('grey is unmistakably NOT the green the walkable range paints', () => {
    const grey = chan(CHANNELS.unavailable.color)
    const green = chan(CHANNELS.mp_range.color)
    // The green wash is green-dominant by a wide margin; the tackle band must not be.
    expect(green.g - Math.max(green.r, green.b)).toBeGreaterThan(0x30)
    expect(grey.g - Math.max(grey.r, grey.b)).toBeLessThanOrEqual(0)
  })

  test('the band RENDERS — it is a visible state on the range, never a removal', () => {
    // Removal is the bug this row names. A zero/near-zero-opacity channel is removal by another route.
    expect(CHANNELS.unavailable.opacity).toBeGreaterThanOrEqual(0.3)
    expect(CHANNELS.unavailable.center_alpha ?? 1).toBeGreaterThan(0)
    // It sits on the base layer with the green range it splits — one paint blob per cell, same tier.
    expect(CHANNELS.unavailable.order).toBe(CHANNELS.mp_range.order)
  })
})
