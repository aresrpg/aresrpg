// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TOOLTIP ANCHOR derivation (fixes the hover card sitting to the right instead of anchoring like a tooltip of
// the spell itself). The spell-bar hover readout anchors ABOVE its slot via this pure derivation — the SAME
// math the house Tooltip primitive uses (ONE positioning home): slot rect in → viewport-clamped {left, top} out,
// edge-flipped when the preferred side clips. RED at HEAD: tooltip_anchor is not yet extracted.

import { describe, expect, test } from 'bun:test'

import { tooltip_anchor, GAP, MARGIN } from './tooltip_anchor.js'

const viewport = { width: 1000, height: 800 }
const card = { width: 200, height: 100 }

describe('tooltip_anchor — slot rect → viewport-clamped anchor (top placement)', () => {
  test('sits the card ABOVE the slot, horizontally centered on it', () => {
    const slot = { left: 480, top: 600, bottom: 640, width: 40, height: 40 }
    const a = tooltip_anchor({ trigger: slot, card, viewport })
    expect(a.top).toBe(600 - 100 - GAP) // trigger.top − card.height − gap
    expect(a.left).toBe(500 - 100) // slot center (500) − half the card
  })

  test('a slot near the TOP edge flips the card BELOW it (no clip off-screen top)', () => {
    const slot = { left: 100, top: 4, bottom: 44, width: 40, height: 40 }
    const a = tooltip_anchor({ trigger: slot, card, viewport })
    expect(a.top).toBe(44 + GAP) // flipped to trigger.bottom + gap
  })

  test('a slot near the RIGHT edge clamps the card fully on-screen', () => {
    const slot = { left: 980, top: 400, bottom: 440, width: 40, height: 40 }
    const a = tooltip_anchor({ trigger: slot, card, viewport })
    expect(a.left).toBe(viewport.width - card.width - MARGIN) // 1000 − 200 − 8 = 792
  })

  test('a slot at the LEFT edge clamps to the left margin', () => {
    const slot = { left: 0, top: 400, bottom: 440, width: 20, height: 40 }
    const a = tooltip_anchor({ trigger: slot, card, viewport })
    expect(a.left).toBe(MARGIN)
  })
})
